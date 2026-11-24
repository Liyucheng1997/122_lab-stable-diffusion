from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import os
import random
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import catalog, local_llm, poses, prompt_ai
from app.local_llm import llm
from app.worker_client import GenerationWorker, WorkerCrashed, crash_detail, raise_for_error


ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "static"
OUTPUT_DIR = ROOT_DIR / "outputs"
LORA_DIR = ROOT_DIR / "loras"
MODEL_DIR = ROOT_DIR / "models"

DEFAULT_MODEL = "Tongyi-MAI/Z-Image-Turbo"
LORA_DISPLAY_NAMES = {
    "pytorch_lora_weights.safetensors": "自定义 LoRA",
    "style_anime_character_sd15.safetensors": "动漫角色风格",
    "style_architecture_sd15.safetensors": "建筑空间设计风格",
    "style_car_design_sd15.safetensors": "汽车工业设计风格",
    "style_anime_landscape_sd15.safetensors": "动漫风景风格",
    "style_impressionism_monet_sd15.safetensors": "莫奈印象派风格",
    "style_pencil_sketch_sd15.safetensors": "铅笔素描风格",
    "style_realistic_photo_sd15.safetensors": "写实摄影增强",
}

REF_DIR = OUTPUT_DIR / "refs"  # 图生图用过的参考图

OUTPUT_DIR.mkdir(exist_ok=True)
LORA_DIR.mkdir(exist_ok=True)
MODEL_DIR.mkdir(exist_ok=True)
poses.POSE_DIR.mkdir(exist_ok=True)
load_dotenv(ROOT_DIR / ".env")

app = FastAPI(title="Local Stable Diffusion Web UI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:7860", "http://localhost:7860"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.mount("/poses", StaticFiles(directory=poses.POSE_DIR), name="poses")


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = ""
    model: str = DEFAULT_MODEL
    lora_path: str = ""
    lora_scale: float = Field(default=0.8, ge=-4.0, le=4.0)
    # 默认按 Z-Image Turbo 的推荐参数：1024 × 1024、9 步、CFG 0
    width: int = Field(default=1024, ge=256, le=1536, multiple_of=8)
    height: int = Field(default=1024, ge=256, le=1536, multiple_of=8)
    steps: int = Field(default=9, ge=1, le=100)
    guidance_scale: float = Field(default=0.0, ge=0.0, le=30.0)
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    # 图生图：init_image 是 data URL（新上传的图）或 /outputs/ 下的图片地址；留空就是文生图
    init_image: str = Field(default="", max_length=40_000_000)
    strength: float = Field(default=0.6, ge=0.05, le=1.0)
    # 参考姿势：姿势库里的 id，用 ControlNet 控制人物动作（只支持 Z-Image），和图生图二选一
    pose: str = Field(default="", max_length=80, pattern=r"^[A-Za-z0-9_-]*$")
    pose_mode: str = Field(default="outline", pattern=r"^(outline|line)$")
    pose_scale: float = Field(default=0.7, ge=0.3, le=1.2)
    # 一次生成多张时，前端给这几张同一个批次号，历史里据此折叠成一组
    batch: str = Field(default="", max_length=40, pattern=r"^[A-Za-z0-9_-]*$")


class DownloadRequest(BaseModel):
    id: str = Field(min_length=1, max_length=200)


class AgentMessage(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(default="", max_length=8000)  # 用户说的话
    turn: dict[str, Any] | None = None  # 助手那一轮返回的完整结果（提示词和参数）
    image: str = Field(default="", max_length=400)  # 用户这句话附的参考图（/outputs/ 下的地址）
    image_mode: str = Field(default="", pattern=r"^(ref|describe|)$")  # 参考图用法：ref 图生图 / describe 只提取提示词


class ImageBatchRequest(BaseModel):
    batch: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    names: list[str] = Field(min_length=1, max_length=400)


class RefImageRequest(BaseModel):
    image: str = Field(min_length=1, max_length=40_000_000)  # data URL，或 /outputs/ 下的图片地址


class AgentChatRequest(BaseModel):
    messages: list[AgentMessage] = Field(min_length=1, max_length=200)
    target_model: str = Field(default="", max_length=300)  # 模型 ID，用来判断提示词写法和参数范围
    pose: str = Field(default="", max_length=80)  # 参数面板里选着的参考姿势，助手写提示词时要照着它写人物动作


# 模型加载和出图都在独立的工作进程里（app/engine.py），这里只管调度
worker = GenerationWorker()
generation_lock = Lock()
latest_torch_memory: dict[str, Any] = {"available": False}
latest_generation_metrics: dict[str, Any] | None = None
# 当前生成进度：phase = idle / loading / denoising / saving
progress: dict[str, Any] = {"phase": "idle", "step": 0, "total": 0, "started": None}


@app.on_event("startup")
def _start_local_llm() -> None:
    """网页服务一启动就把本地 LLM 拉起来（后台加载，不挡住网页）。"""
    if not local_llm.autostart_enabled():
        return

    def run() -> None:
        # 和出图共用一把锁：万一用户抢先点了生成，就不再和生图模型抢显存
        with generation_lock:
            if worker.state.get("model_key") is None:
                try:
                    llm.start()
                except HTTPException:
                    pass  # 模型文件不在；网页上会显示原因

    Thread(target=run, daemon=True, name="llm-autostart").start()


@app.on_event("shutdown")
def _stop_background_processes() -> None:
    llm.stop()
    worker.stop()


def _resolve_user_path(raw_path: str) -> Path:
    path = Path(raw_path.strip().strip('"'))
    if not path.is_absolute():
        path = ROOT_DIR / path
    try:
        path = path.resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"路径无效：{raw_path}") from exc
    return path


def _to_number(value: str) -> float | int | None:
    value = value.strip()
    if not value or value == "N/A":
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def _gpu_snapshot() -> dict[str, Any]:
    try:
        output = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=3,
            # 桌面版用 pythonw 启动、没有控制台，不加这个每次轮询都会弹出一个黑窗口
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return {
            "available": False,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "message": "nvidia-smi 不可用。",
        }

    line = output.splitlines()[0] if output else ""
    parts = [part.strip() for part in line.split(",")]
    if len(parts) < 6:
        return {
            "available": False,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "message": "无法解析 nvidia-smi 输出。",
        }

    memory_used = _to_number(parts[2])
    memory_total = _to_number(parts[3])
    memory_percent = None
    if isinstance(memory_used, (int, float)) and isinstance(memory_total, (int, float)) and memory_total:
        memory_percent = round(memory_used / memory_total * 100, 1)

    return {
        "available": True,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "name": parts[0],
        "utilization_percent": _to_number(parts[1]),
        "memory_used_mb": memory_used,
        "memory_total_mb": memory_total,
        "memory_percent": memory_percent,
        "temperature_c": _to_number(parts[4]),
        "power_w": _to_number(parts[5]),
    }


def _peak_sample(samples: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
    valid = [sample for sample in samples if isinstance(sample.get(key), (int, float))]
    return max(valid, key=lambda sample: sample[key]) if valid else None


class GpuSampler:
    def __init__(self, interval: float = 0.25) -> None:
        self.interval = interval
        self.samples: list[dict[str, Any]] = []
        self._stop = Event()
        self._thread = Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.samples.append(_gpu_snapshot())
        self._thread.start()

    def stop(self) -> list[dict[str, Any]]:
        self._stop.set()
        self._thread.join(timeout=2)
        self.samples.append(_gpu_snapshot())
        return self.samples

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            self.samples.append(_gpu_snapshot())


LEGACY_GROUP_GAP = 90  # 秒：没有批次号的旧图，提示词相同且相隔不超过这么久就算同一次生成


def _image_records() -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    newest = sorted(OUTPUT_DIR.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)[:60]
    previous: dict[str, Any] | None = None  # 上一张（更新的那张）没有批次号的旧图
    for image_path in newest:
        metadata_path = image_path.with_suffix(".json")
        meta: dict[str, Any] = {}
        if metadata_path.exists():
            try:
                loaded_meta = json.loads(metadata_path.read_text(encoding="utf-8"))
                meta = loaded_meta if isinstance(loaded_meta, dict) else {}
            except (OSError, json.JSONDecodeError):
                meta = {}
        prompt = str(meta.get("prompt") or "")
        mtime = image_path.stat().st_mtime
        if "batch" in meta:
            group = str(meta["batch"] or "")
            previous = None
        else:
            # 加批次号之前生成的图：按“提示词相同、时间挨着”推断
            same = previous is not None and bool(prompt) and previous["prompt"] == prompt and previous["mtime"] - mtime <= LEGACY_GROUP_GAP
            group = previous["group"] if same else f"legacy-{image_path.stem}"
            previous = {"prompt": prompt, "mtime": mtime, "group": group}
        records.append(
            {
                "name": image_path.name,
                "url": f"/outputs/{image_path.name}",
                "prompt": prompt,
                "group": group,
                "created_at": datetime.fromtimestamp(mtime).isoformat(timespec="seconds"),
            }
        )
    # 同一组（同一段对话，或同一次手动生成）的图收在一起，哪怕中间穿插出过别的图：
    # 各组之间按组里最新的那张排，新的在前；组内按出图的先后排（第 1 张在最前），和对话里看到的顺序一致
    members: dict[str, list[dict[str, str]]] = {}
    for record in records:
        if record["group"]:
            members.setdefault(record["group"], []).append(record)
    ordered: list[dict[str, str]] = []
    placed: set[str] = set()
    for record in records:
        group = record["group"]
        if not group:
            ordered.append(record)
        elif group not in placed:
            placed.add(group)
            ordered.extend(reversed(members[group]))
    return ordered


def _guess_lora_family(lora_path: Path) -> str | None:
    parts = lora_path.relative_to(LORA_DIR).parts
    if len(parts) > 1 and parts[0] in catalog.FAMILY_LABELS:
        return parts[0]
    detected = catalog.detect_lora_family(lora_path)
    if detected:
        return detected
    lowered = lora_path.name.lower()
    if "sd15" in lowered or "sd_15" in lowered or "sd-1-5" in lowered:
        return "sd15"
    if "sdxl" in lowered or "_xl" in lowered:
        return "sdxl"
    if "zimage" in lowered or "z_image" in lowered or "z-image" in lowered:
        return "zimage"
    return None


def _lora_records() -> list[dict[str, Any]]:
    extensions = {".safetensors", ".pt", ".bin", ".ckpt"}
    known = catalog.catalog_by_relpath()
    records: list[dict[str, Any]] = []
    for lora_path in sorted(LORA_DIR.rglob("*"), key=lambda p: str(p).lower()):
        parts = lora_path.relative_to(LORA_DIR).parts
        if "disabled" in parts or any(part.startswith(".") for part in parts):
            continue
        if not lora_path.is_file() or lora_path.suffix.lower() not in extensions:
            continue
        relative_path = lora_path.relative_to(ROOT_DIR).as_posix()
        item = known.get(relative_path)
        local_info = catalog.LOCAL_LORA_INFO.get(lora_path.name, {})
        records.append(
            {
                "name": lora_path.name,
                "display_name": item["name"]
                if item
                else local_info.get("name") or LORA_DISPLAY_NAMES.get(lora_path.name, _fallback_lora_display_name(lora_path)),
                "desc": item["desc"] if item else local_info.get("desc", ""),
                "path": relative_path,
                "size_mb": round(lora_path.stat().st_size / 1024 / 1024, 2),
                "family": item["family"] if item else _guess_lora_family(lora_path),
                "catalog_id": item["id"] if item else None,
                "trigger": item["trigger"] if item else "",
                "weight": item["weight"] if item else None,
                "in_use": worker.state.get("lora_key") == relative_path,
            }
        )
    return records


def _fallback_lora_display_name(path: Path) -> str:
    name = path.stem
    for prefix in ("style_", "lora_", "sd15_", "sd_15_"):
        if name.startswith(prefix):
            name = name[len(prefix) :]
    name = name.replace("_sd15", "").replace("_sd_15", "")
    return name.replace("_", " ").replace("-", " ").title()


def _resolve_output_image(name: str) -> Path:
    if Path(name).name != name:
        raise HTTPException(status_code=400, detail="图片名称无效。")
    if not name.lower().endswith(".png"):
        raise HTTPException(status_code=400, detail="只能删除 outputs 目录里的 PNG 图片。")

    image_path = (OUTPUT_DIR / name).resolve()
    output_root = OUTPUT_DIR.resolve()
    if output_root not in image_path.parents:
        raise HTTPException(status_code=400, detail="图片路径越界。")
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在。")
    if not image_path.is_file():
        raise HTTPException(status_code=400, detail="目标不是文件。")
    return image_path


def _store_init_image(raw: str) -> Path:
    """把参考图存到 outputs/refs/（按内容命名，同一张图只存一份），返回文件路径。"""
    from PIL import Image, ImageOps, UnidentifiedImageError

    raw = raw.strip()
    output_root = OUTPUT_DIR.resolve()
    if raw.startswith("/outputs/"):
        source = (OUTPUT_DIR / raw[len("/outputs/") :].split("?", 1)[0]).resolve()
        if output_root not in source.parents or not source.is_file():
            raise HTTPException(status_code=400, detail="参考图已经不存在，请重新选择。")
        if source.parent == REF_DIR.resolve():
            return source
        data = source.read_bytes()
    elif raw.startswith("data:image/") and ";base64," in raw:
        try:
            data = base64.b64decode(raw.split(";base64,", 1)[1], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=400, detail="参考图数据损坏，请重新选择。") from exc
    else:
        raise HTTPException(status_code=400, detail="参考图格式不支持。")

    target = REF_DIR / f"{hashlib.sha1(data).hexdigest()[:20]}.png"
    if target.exists():
        return target
    try:
        with Image.open(io.BytesIO(data)) as source_image:
            image = ImageOps.exif_transpose(source_image).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="参考图不是可识别的图片。") from exc
    image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
    REF_DIR.mkdir(exist_ok=True)
    image.save(target)
    return target


@app.get("/")
def index() -> FileResponse:
    # 首页每次都要向服务器确认：不然桌面版的 WebView2 会按修改时间自己估一个缓存期，
    # 更新代码后重开窗口还是旧页面（旧页面又引用旧版本号的 app.js / styles.css）
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/api/status")
def status() -> dict[str, Any]:
    try:
        import torch
    except ImportError:
        return {
            "ready": False,
            "device": "missing",
            "message": "PyTorch 未安装。",
            "default_model": DEFAULT_MODEL,
        }

    gpu_metrics = _gpu_snapshot()
    cuda = bool(torch.version.cuda) and gpu_metrics.get("available", False)
    return {
        "ready": True,
        "device": "cuda" if cuda else "cpu",
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": gpu_metrics.get("name", "") if cuda else "",
        "default_model": DEFAULT_MODEL,
        "loaded_model": worker.state.get("model_key"),
        "loaded_lora": worker.state.get("lora_key"),
        "memory_mode": worker.state.get("memory_mode"),
        "worker_alive": worker.alive(),
        "gpu_metrics": gpu_metrics,
        "latest_generation_metrics": latest_generation_metrics,
        "safety_mode": "diffusers_default",
    }


@app.get("/api/gpu")
def gpu() -> dict[str, Any]:
    return {
        "gpu": _gpu_snapshot(),
        "torch_memory": latest_torch_memory if worker.alive() else {"available": False},
        "latest_generation_metrics": latest_generation_metrics,
        "progress": progress,
    }


@app.get("/api/images")
def images() -> dict[str, list[dict[str, str]]]:
    return {"images": _image_records()}


@app.get("/api/loras")
def loras() -> dict[str, list[dict[str, Any]]]:
    return {"loras": _lora_records()}


@app.post("/api/agent/chat")
def agent_chat(request: AgentChatRequest) -> dict[str, Any]:
    model_id = request.target_model.strip() or DEFAULT_MODEL
    preset = catalog.model_by_id(model_id)
    label = preset["label"] if preset else model_id
    messages: list[dict[str, Any]] = []
    for m in request.messages:
        if m.role == "assistant":
            messages.append({"role": "assistant", "content": prompt_ai.turn_as_history(m.turn) if m.turn else m.content})
            continue
        image_path: Path | None = None
        missing = False
        if m.image.startswith("/outputs/"):
            try:
                image_path = _store_init_image(m.image)
            except HTTPException:
                missing = True  # 参考图已经被删掉：告诉模型这里曾有图，对话照常继续
        messages.append({"role": "user", "content": m.content, "image": image_path, "image_mode": m.image_mode, "image_missing": missing})
    # 和出图互斥：LLM 和生图模型同时算会把 16GB 显存挤爆。先让生图模型把显存让出来（权重留在内存里，不用重新加载）
    pose = poses.pose_by_id(request.pose) if request.pose else None
    with generation_lock:
        worker.park()
        return prompt_ai.chat(messages, catalog.family_of_model(model_id), label, pose=poses.describe(pose) if pose else "")


@app.post("/api/images/batch")
def set_image_batch(request: ImageBatchRequest) -> dict[str, Any]:
    """把几张已有的图归到同一组（网页用它把旧对话里出的图补归到各自的对话下）。"""
    changed = 0
    for name in request.names:
        try:
            metadata_path = _resolve_output_image(name).with_suffix(".json")
        except HTTPException:
            continue  # 图已经删了
        try:
            meta = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        except (OSError, json.JSONDecodeError):
            meta = {}
        if not isinstance(meta, dict) or meta.get("batch") == request.batch:
            continue
        meta["batch"] = request.batch
        metadata_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        changed += 1
    return {"changed": changed, "images": _image_records()}


@app.post("/api/refs")
def upload_ref(request: RefImageRequest) -> dict[str, str]:
    """把对话里附的参考图存到 outputs/refs/，返回它的地址（对话历史里只记地址，不存图片数据）。"""
    return {"url": f"/outputs/refs/{_store_init_image(request.image).name}"}


@app.get("/api/settings")
def settings() -> dict[str, Any]:
    return {"llm": prompt_ai.settings_view()}


@app.get("/api/models")
def models() -> dict[str, Any]:
    jobs = catalog.downloads.snapshot()
    return {
        "models": [
            {
                **{k: v for k, v in model.items() if k != "allow_patterns"},
                "installed": catalog.model_installed(model),
                "disk_gb": round(catalog.model_disk_bytes(model) / 1e9, 2),
                "path": catalog.model_relpath(model),
                "in_use": worker.state.get("model_key") == model["id"],
                "defaults": catalog.FAMILY_DEFAULTS[model["family"]],
                "page": None if model.get("local") else f"https://huggingface.co/{model['id']}",
                "job": jobs.get(model["id"]),
            }
            for model in catalog.MODELS
        ],
        "family_defaults": catalog.FAMILY_DEFAULTS,
        "storage": catalog.storage_summary(),
        "disk_free_gb": catalog.disk_free_gb(),
    }


@app.delete("/api/models")
def delete_model(id: str) -> dict[str, Any]:  # noqa: A002 - 与前端参数名保持一致
    model = catalog.model_by_id(id)
    if not model:
        raise HTTPException(status_code=404, detail="不是内置模型，不能在这里删除。")
    job = catalog.downloads.snapshot().get(id)
    if job and job["status"] == "downloading":
        raise HTTPException(status_code=409, detail="正在下载，等下载结束再删除。")
    if not generation_lock.acquire(timeout=1):
        raise HTTPException(status_code=409, detail="正在生成图片，等生成结束再删除。")
    try:
        if worker.state.get("model_key") == id:
            worker.stop()
        freed = catalog.model_disk_bytes(model)
        removed = catalog.delete_model_files(model)
    finally:
        generation_lock.release()
    return {"removed": removed, "freed_gb": round(freed / 1e9, 2)}


@app.post("/api/models/download")
def download_model(request: DownloadRequest) -> dict[str, Any]:
    model = catalog.model_by_id(request.id)
    if not model or not model.get("downloadable"):
        raise HTTPException(status_code=404, detail="这个模型不支持在线下载。")
    if catalog.model_installed(model):
        return {"status": "done"}
    need_gb = model.get("size_gb", 0) + 2
    if catalog.disk_free_gb() < need_gb:
        raise HTTPException(status_code=400, detail=f"磁盘剩余 {catalog.disk_free_gb()} GB，不够下载（约需 {need_gb} GB）。")
    return catalog.downloads.start_model(model)


@app.get("/api/poses")
def pose_library() -> dict[str, Any]:
    data = poses.library()
    data["controlnet"]["job"] = catalog.downloads.snapshot().get(poses.CONTROLNET["id"])
    return data


@app.post("/api/poses/download")
def download_poses() -> dict[str, Any]:
    if catalog.disk_free_gb() < 1:
        raise HTTPException(status_code=400, detail=f"磁盘剩余 {catalog.disk_free_gb()} GB，不够下载姿势库（约 0.7 GB）。")
    return poses.downloader.start()


@app.post("/api/controlnet/download")
def download_controlnet() -> dict[str, Any]:
    if poses.controlnet_installed():
        return {"status": "done"}
    need_gb = poses.CONTROLNET["size_gb"] * 2 + 1  # 转换成 diffusers 目录时会短暂同时存在两份
    if catalog.disk_free_gb() < need_gb:
        raise HTTPException(status_code=400, detail=f"磁盘剩余 {catalog.disk_free_gb()} GB，不够下载（约需 {need_gb:.0f} GB）。")

    def convert() -> None:
        # 转换要加载 PyTorch、峰值约 10GB 内存：放进单独的进程，网页服务本身不碰 PyTorch
        result = subprocess.run(
            [sys.executable, "-c", "from app.poses import convert_controlnet; convert_controlnet()"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0:
            last = (result.stderr or "").strip().splitlines()[-1:] or ["未知错误"]
            raise RuntimeError(f"格式转换失败：{last[0]}")

    return catalog.downloads.start_file(
        poses.CONTROLNET["id"],
        catalog.hf_file_url(poses.CONTROLNET["repo"], poses.CONTROLNET["file"]),
        poses.CONTROLNET_PATH,
        after=convert,
    )


@app.get("/api/loras/catalog")
def lora_catalog() -> dict[str, Any]:
    jobs = catalog.downloads.snapshot()
    return {
        "storage": catalog.storage_summary(),
        "items": [
            {
                **item,
                "installed": catalog.lora_target(item).exists(),
                "path": catalog.lora_relpath(item),
                "page": f"https://huggingface.co/{item['repo']}",
                "job": jobs.get(item["id"]),
            }
            for item in catalog.LORA_CATALOG
        ],
        "families": catalog.FAMILY_LABELS,
    }


@app.post("/api/loras/download")
def download_lora(request: DownloadRequest) -> dict[str, Any]:
    item = catalog.CATALOG_BY_ID.get(request.id)
    if not item:
        raise HTTPException(status_code=404, detail="LoRA 不在内置目录里。")
    if catalog.lora_target(item).exists():
        return {"status": "done"}
    return catalog.downloads.start_lora(item)


@app.delete("/api/loras/file")
def delete_lora_file(path: str) -> dict[str, Any]:
    target = _resolve_user_path(path)
    lora_root = LORA_DIR.resolve()
    if lora_root not in target.parents or target.suffix.lower() not in {".safetensors", ".pt", ".bin", ".ckpt"}:
        raise HTTPException(status_code=400, detail="只能删除 loras 目录里的 LoRA 文件。")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在。")
    if not generation_lock.acquire(timeout=1):
        raise HTTPException(status_code=409, detail="正在生成图片，等生成结束再删除。")
    try:
        relative = target.relative_to(ROOT_DIR).as_posix()
        if worker.state.get("lora_key") == relative:
            # LoRA 可能已合并进权重，直接结束工作进程最干净
            worker.stop()
        size = target.stat().st_size
        target.unlink()
    finally:
        generation_lock.release()
    return {"removed": True, "freed_mb": round(size / 1e6, 1), "loras": _lora_records()}


@app.get("/api/loras/catalog/{item_id}/preview")
def lora_preview(item_id: str) -> FileResponse:
    item = catalog.CATALOG_BY_ID.get(item_id)
    if not item or not item.get("preview"):
        raise HTTPException(status_code=404, detail="没有预览图。")
    try:
        path = catalog.ensure_preview(item)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="预览图下载失败。") from exc
    if not path:
        raise HTTPException(status_code=404, detail="没有预览图。")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=604800"})


@app.delete("/api/images/{name}")
def delete_image(name: str) -> dict[str, Any]:
    image_path = _resolve_output_image(name)
    metadata_path = image_path.with_suffix(".json")
    deleted = [image_path.name]

    image_path.unlink()
    if metadata_path.exists() and metadata_path.is_file():
        metadata_path.unlink()
        deleted.append(metadata_path.name)

    return {
        "deleted": deleted,
        "images": _image_records(),
    }


@app.post("/api/generate")
def generate(request: GenerateRequest) -> dict[str, Any]:
    try:
        return _generate(request)
    finally:
        progress.update(phase="idle")


def _generate(request: GenerateRequest) -> dict[str, Any]:
    global latest_generation_metrics, latest_torch_memory

    init_path: Path | None = None
    init_url = ""
    total_steps = request.steps
    pose = None
    if request.pose:
        pose = poses.pose_by_id(request.pose)
        if not pose:
            raise HTTPException(status_code=400, detail="姿势库里没有这个姿势，可能还没下载姿势库。")
        if catalog.family_of_model(request.model.strip() or DEFAULT_MODEL) != "zimage":
            raise HTTPException(status_code=400, detail="参考姿势只支持 Z-Image Turbo，请先把模型换成 Z-Image Turbo，或者移除姿势。")
        if not poses.controlnet_installed():
            raise HTTPException(status_code=400, detail="姿势控制模型（ControlNet）还没下载，先在「参考姿势」里点下载。")
        if request.init_image.strip():
            raise HTTPException(status_code=400, detail="参考姿势和图生图不能同时用，请移除其中一个。")
    elif request.init_image.strip():
        # 图生图跳过开头的 步数 × (1 − 重绘幅度) 步（向下取整），只跑剩下的；和 diffusers 的 get_timesteps 一致
        total_steps = request.steps - int(max(request.steps - request.steps * request.strength, 0))
        init_path = _store_init_image(request.init_image)
        init_url = f"/outputs/refs/{init_path.name}"

    with generation_lock:
        # 从拿到锁开始计时，排队等待的时间不算进耗时
        started = time.time()
        # 出图前结束本地 LLM，把它占的显存整块还给生图模型；下次「转写」时会自动再启动
        llm.stop()
        model_key = request.model.strip() or DEFAULT_MODEL
        lora_key = request.lora_path.strip()
        needs_load = worker.needs_fresh_process(model_key, lora_key, request.lora_scale) or worker.state.get("model_key") is None
        progress.update(phase="loading" if needs_load else "denoising", step=0, total=total_steps, started=started)

        seed = request.seed if request.seed is not None else random.randrange(2**32)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        image_name = f"{timestamp}_seed-{int(seed)}.png"
        image_path = OUTPUT_DIR / image_name
        job = {
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "model": model_key,
            "lora_path": lora_key,
            "lora_scale": request.lora_scale,
            "width": request.width,
            "height": request.height,
            "steps": request.steps,
            "guidance_scale": request.guidance_scale,
            "seed": int(seed),
            "image_path": str(image_path),
            "init_image_path": str(init_path) if init_path else "",
            "strength": request.strength,
            "pose_id": request.pose if pose else "",
            "pose_mode": request.pose_mode,
            "pose_scale": request.pose_scale,
        }

        before_load_gpu = _gpu_snapshot()
        timing: dict[str, Any] = {"after_load": None, "sampler": None}

        def on_message(message: dict[str, Any]) -> None:
            if message["type"] == "loaded":
                progress.update(phase="denoising", step=0)
                timing["after_load"] = _gpu_snapshot()
                timing["sampler"] = GpuSampler()
                timing["sampler"].start()
            elif message["type"] == "progress":
                progress.update(step=message["step"])

        try:
            reply = worker.generate(job, on_message)
        except WorkerCrashed as exc:
            if timing["sampler"]:
                timing["sampler"].stop()
            latest_generation_metrics = {"ok": False, "seconds": round(time.time() - started, 2), "error": "worker crashed"}
            raise HTTPException(status_code=500, detail=crash_detail(exc.args[0] if exc.args else None)) from exc

        samples = timing["sampler"].stop() if timing["sampler"] else []
        after_load_gpu = timing["after_load"] or before_load_gpu
        if reply["type"] == "error":
            latest_generation_metrics = {
                "ok": False,
                "seconds": round(time.time() - started, 2),
                "before_load": before_load_gpu,
                "after_load": after_load_gpu,
                "peak_memory": _peak_sample(samples, "memory_used_mb"),
                "peak_utilization": _peak_sample(samples, "utilization_percent"),
                "error": reply.get("detail"),
            }
            raise_for_error(reply)

        after_gpu = _gpu_snapshot()
        torch_memory = reply.get("torch_memory") or {"available": False}
        latest_torch_memory = torch_memory
        peak_memory_sample = _peak_sample(samples, "memory_used_mb")
        peak_util_sample = _peak_sample(samples, "utilization_percent")
        peak_power_sample = _peak_sample(samples, "power_w")
        peak_temp_sample = _peak_sample(samples, "temperature_c")

        memory_delta_mb = None
        if (
            peak_memory_sample
            and isinstance(peak_memory_sample.get("memory_used_mb"), (int, float))
            and isinstance(after_load_gpu.get("memory_used_mb"), (int, float))
        ):
            memory_delta_mb = round(peak_memory_sample["memory_used_mb"] - after_load_gpu["memory_used_mb"], 1)

        gpu_metrics = {
            "ok": True,
            "seconds": round(time.time() - started, 2),
            "sample_count": len(samples),
            "before_load": before_load_gpu,
            "after_load": after_load_gpu,
            "after": after_gpu,
            "peak_memory": peak_memory_sample,
            "peak_utilization": peak_util_sample,
            "peak_power": peak_power_sample,
            "peak_temperature": peak_temp_sample,
            "memory_delta_from_loaded_mb": memory_delta_mb,
            "torch_memory": torch_memory,
        }
        latest_generation_metrics = gpu_metrics
        progress.update(phase="saving")

        safe_seed = int(seed)
        metadata_path = image_path.with_suffix(".json")
        metadata_path.write_text(
            json.dumps(
                {
                    "prompt": request.prompt,
                    "negative_prompt": request.negative_prompt,
                    "model": request.model,
                    "lora_path": request.lora_path,
                    "lora_scale": request.lora_scale,
                    "width": request.width,
                    "height": request.height,
                    "steps": request.steps,
                    "guidance_scale": request.guidance_scale,
                    "seed": safe_seed,
                    "init_image": init_url,
                    "strength": request.strength if init_url else None,
                    "pose": request.pose if pose else "",
                    "pose_name": poses.describe(pose) if pose else "",
                    "pose_mode": request.pose_mode if pose else None,
                    "pose_scale": request.pose_scale if pose else None,
                    "batch": request.batch,
                    "seconds": round(time.time() - started, 2),
                    "gpu_metrics": gpu_metrics,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        progress.update(phase="idle")

    return {
        "url": f"/outputs/{image_name}",
        "path": str(image_path),
        "seed": safe_seed,
        "init_image": init_url,
        "pose": request.pose if pose else "",
        "seconds": round(time.time() - started, 2),
        "gpu_metrics": gpu_metrics,
        "images": _image_records(),
    }
