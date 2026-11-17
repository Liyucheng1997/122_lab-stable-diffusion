from __future__ import annotations

import json
import os
import subprocess
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

from app import catalog, prompt_ai


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

OUTPUT_DIR.mkdir(exist_ok=True)
LORA_DIR.mkdir(exist_ok=True)
MODEL_DIR.mkdir(exist_ok=True)
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


class ClaudeKeyRequest(BaseModel):
    api_key: str = Field(min_length=1, max_length=400)


class DownloadRequest(BaseModel):
    id: str = Field(min_length=1, max_length=200)


class PromptOptimizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    style: str = Field(default="", max_length=500)
    target_model: str = Field(default="", max_length=300)  # 模型 ID，用来判断提示词格式


class LoadedPipeline:
    pipe: Any | None = None
    model_key: str | None = None
    lora_key: str | None = None
    lora_scale: float | None = None
    memory_mode: str | None = None


loaded = LoadedPipeline()
generation_lock = Lock()
latest_generation_metrics: dict[str, Any] | None = None
# 当前生成进度：phase = idle / loading / denoising / saving
progress: dict[str, Any] = {"phase": "idle", "step": 0, "total": 0, "started": None}


def _import_torch_and_diffusers() -> tuple[Any, Any]:
    try:
        import torch
        from diffusers import AutoPipelineForText2Image
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "依赖尚未安装完整。请先在虚拟环境中安装 requirements.txt "
                "以及带 CUDA 的 PyTorch。"
            ),
        ) from exc
    return torch, AutoPipelineForText2Image


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


def _torch_memory_snapshot(torch: Any) -> dict[str, Any]:
    if not torch.cuda.is_available():
        return {"available": False}
    return {
        "available": True,
        "allocated_mb": round(torch.cuda.memory_allocated() / 1024 / 1024, 1),
        "reserved_mb": round(torch.cuda.memory_reserved() / 1024 / 1024, 1),
        "max_allocated_mb": round(torch.cuda.max_memory_allocated() / 1024 / 1024, 1),
        "max_reserved_mb": round(torch.cuda.max_memory_reserved() / 1024 / 1024, 1),
    }


def _is_sdxl_single_file(model_path: Path) -> bool:
    if model_path.suffix.lower() != ".safetensors":
        return False
    try:
        import json
        import struct

        with open(model_path, "rb") as f:
            header_size = struct.unpack("<Q", f.read(8))[0]
            header = json.loads(f.read(header_size))
        return any(key.startswith("conditioner.embedders.1") for key in header)
    except (OSError, ValueError, struct.error):
        return False


def _unload_current_pipeline() -> None:
    """把当前模型从显存和内存里卸掉。"""
    import gc

    old_pipe = loaded.pipe
    loaded.pipe = None
    loaded.model_key = None
    loaded.lora_key = None
    loaded.lora_scale = None
    loaded.memory_mode = None
    if old_pipe is None:
        return
    if hasattr(old_pipe, "remove_all_hooks"):
        old_pipe.remove_all_hooks()
    try:
        old_pipe.to("cpu")
    except Exception:  # noqa: BLE001 - 已经 offload 的管线可能不允许 .to()
        pass
    del old_pipe
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def _model_source(model_key: str) -> str:
    """内置模型从 models/ 目录加载；其他的按路径或 Hugging Face ID 处理。"""
    preset = catalog.model_by_id(model_key)
    if preset:
        if not catalog.model_installed(preset):
            hint = "先在「模型库」里下载。" if preset.get("downloadable") else "文件不在 models/ 目录里。"
            raise HTTPException(status_code=400, detail=f"{preset['label']} 还没下载。{hint}")
        return str(catalog.model_path(preset))
    model_path = _resolve_user_path(model_key)
    return str(model_path) if model_path.exists() else model_key


def _load_zimage(model_key: str, torch: Any, device: str, lora_key: str, lora_scale: float) -> Any:
    """Z-Image Turbo：6B DiT + Qwen3 文本编码器，bf16 约 20GB，16GB 显卡要靠 offload。

    LoRA 在这里先“合并”进 bf16 权重，再决定要不要转 fp8 存储。
    如果先转 fp8 再挂 LoRA，PEFT 新建的 LoRA 层也会是 fp8，CUDA 矩阵乘不支持，会报
    "addmm_cuda not implemented for Float8_e4m3fn"。代价是换 LoRA 或权重要重新加载模型。
    """
    from diffusers import ZImagePipeline

    source = _model_source(model_key)
    pipe = ZImagePipeline.from_pretrained(source, torch_dtype=torch.bfloat16)
    if lora_key:
        resolved_lora = _resolve_lora_path(lora_key)
        try:
            pipe.load_lora_weights(str(resolved_lora), adapter_name="local_lora")
            pipe.fuse_lora(lora_scale=lora_scale)
            pipe.unload_lora_weights()  # 去掉 LoRA 层，合并后的权重保留
        except Exception as exc:  # noqa: BLE001
            del pipe
            raise HTTPException(
                status_code=400,
                detail=f"LoRA 加载失败，多半是它和 Z-Image 模型不匹配。原始错误：{str(exc)[:200]}",
            ) from exc
    loaded.lora_key = lora_key or None
    loaded.lora_scale = lora_scale if lora_key else None
    if device != "cuda":
        return pipe

    free_bytes, _ = torch.cuda.mem_get_info()
    # 显存不够整块放下 12GB 的 transformer 时，用 fp8 存权重、bf16 计算，显存占用减半，画质几乎无损。
    if free_bytes < 15 * 1024**3 and hasattr(pipe.transformer, "enable_layerwise_casting"):
        pipe.transformer.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.bfloat16)
        loaded.memory_mode = "fp8 权重 + CPU offload"
    else:
        loaded.memory_mode = "CPU offload"
    pipe.enable_model_cpu_offload()
    return pipe


def _resolve_lora_path(lora_key: str) -> Path:
    resolved = _resolve_user_path(lora_key)
    if resolved.exists():
        return resolved
    # 旧图片记录里的路径（例如 loras/xxx.safetensors）在整理目录后换了位置，按文件名再找一次
    name = Path(lora_key).name
    matches = [p for p in LORA_DIR.rglob(name) if p.is_file()]
    if matches:
        return matches[0]
    raise HTTPException(status_code=400, detail=f"LoRA 文件不存在：{lora_key}。可能已被删除，可以在 LoRA 库里重新下载。")


def _load_pipeline(model: str, lora_path: str, lora_scale: float) -> tuple[Any, Any]:
    torch, AutoPipelineForText2Image = _import_torch_and_diffusers()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    model_key = model.strip() or DEFAULT_MODEL
    lora_key = lora_path.strip()

    family = catalog.family_of_model(model_key)
    zimage_lora_changed = family == "zimage" and (
        (lora_key or None) != loaded.lora_key or (bool(lora_key) and lora_scale != loaded.lora_scale)
    )
    if loaded.pipe is None or loaded.model_key != model_key or zimage_lora_changed:
        if loaded.pipe is not None:
            _unload_current_pipeline()

        if family == "zimage":
            loaded.pipe = _load_zimage(model_key, torch, device, lora_key, lora_scale)
            loaded.model_key = model_key
    if family == "zimage":
        # LoRA 已在加载时合并，不走下面的动态挂载
        return loaded.pipe, torch

    if loaded.pipe is None or loaded.model_key != model_key:
        source_str = _model_source(model_key)
        model_path = Path(source_str) if Path(source_str).exists() else None
        load_kwargs = {
            "torch_dtype": dtype,
            "use_safetensors": True,
        }
        if model_path and model_path.is_file():
            from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline

            pipeline_cls = (
                StableDiffusionXLPipeline
                if _is_sdxl_single_file(model_path)
                else StableDiffusionPipeline
            )
            pipe = pipeline_cls.from_single_file(str(model_path), **load_kwargs)
        else:
            source = str(model_path) if model_path else model_key
            if device == "cuda":
                load_kwargs["variant"] = "fp16"
            try:
                pipe = AutoPipelineForText2Image.from_pretrained(source, **load_kwargs)
            except (OSError, ValueError):
                load_kwargs.pop("variant", None)
                pipe = AutoPipelineForText2Image.from_pretrained(source, **load_kwargs)

        pipe.to(device)
        loaded.memory_mode = "全部在显存" if device == "cuda" else "CPU"
        if hasattr(pipe, "enable_attention_slicing"):
            pipe.enable_attention_slicing()
        if hasattr(pipe, "enable_vae_slicing"):
            pipe.enable_vae_slicing()

        loaded.pipe = pipe
        loaded.model_key = model_key
        loaded.lora_key = None
        loaded.lora_scale = None

    if loaded.pipe is None:
        raise HTTPException(status_code=500, detail="模型加载失败。")

    lora_changed = lora_key != loaded.lora_key or (bool(lora_key) and lora_scale != loaded.lora_scale)
    if lora_changed:
        if loaded.lora_key and hasattr(loaded.pipe, "unload_lora_weights"):
            loaded.pipe.unload_lora_weights()
        if lora_key:
            resolved_lora = _resolve_lora_path(lora_key)
            try:
                loaded.pipe.load_lora_weights(str(resolved_lora), adapter_name="local_lora")
            except Exception as exc:  # noqa: BLE001
                loaded.lora_key = None
                try:
                    loaded.pipe.unload_lora_weights()
                except Exception:  # noqa: BLE001
                    pass
                family = catalog.family_of_model(model_key)
                raise HTTPException(
                    status_code=400,
                    detail=f"LoRA 加载失败，多半是它和当前 {catalog.FAMILY_LABELS.get(family, family)} 模型不匹配。原始错误：{str(exc)[:200]}",
                ) from exc
            if hasattr(loaded.pipe, "set_adapters"):
                loaded.pipe.set_adapters(["local_lora"], adapter_weights=[lora_scale])
        loaded.lora_key = lora_key
        loaded.lora_scale = lora_scale if lora_key else None

    return loaded.pipe, torch


def _image_records() -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for image_path in sorted(OUTPUT_DIR.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True):
        metadata_path = image_path.with_suffix(".json")
        prompt = ""
        if metadata_path.exists():
            try:
                prompt = json.loads(metadata_path.read_text(encoding="utf-8")).get("prompt", "")
            except (OSError, json.JSONDecodeError):
                prompt = ""
        records.append(
            {
                "name": image_path.name,
                "url": f"/outputs/{image_path.name}",
                "prompt": prompt,
                "created_at": datetime.fromtimestamp(image_path.stat().st_mtime).isoformat(timespec="seconds"),
            }
        )
    return records[:60]


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
                "in_use": loaded.lora_key == relative_path,
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


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


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

    cuda = torch.cuda.is_available()
    return {
        "ready": True,
        "device": "cuda" if cuda else "cpu",
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0) if cuda else "",
        "default_model": DEFAULT_MODEL,
        "loaded_model": loaded.model_key,
        "loaded_lora": loaded.lora_key,
        "memory_mode": loaded.memory_mode,
        "gpu_metrics": _gpu_snapshot(),
        "latest_generation_metrics": latest_generation_metrics,
        "safety_mode": "diffusers_default",
    }


@app.get("/api/gpu")
def gpu() -> dict[str, Any]:
    try:
        import torch
    except ImportError:
        return {
            "gpu": _gpu_snapshot(),
            "torch_memory": {"available": False},
            "latest_generation_metrics": latest_generation_metrics,
        }

    return {
        "gpu": _gpu_snapshot(),
        "torch_memory": _torch_memory_snapshot(torch),
        "latest_generation_metrics": latest_generation_metrics,
        "progress": progress,
    }


@app.get("/api/images")
def images() -> dict[str, list[dict[str, str]]]:
    return {"images": _image_records()}


@app.get("/api/loras")
def loras() -> dict[str, list[dict[str, Any]]]:
    return {"loras": _lora_records()}


@app.post("/api/prompt/optimize")
def optimize_prompt(request: PromptOptimizeRequest) -> dict[str, Any]:
    model_id = request.target_model.strip() or DEFAULT_MODEL
    preset = catalog.model_by_id(model_id)
    label = preset["label"] if preset else model_id
    return prompt_ai.optimize(request.text, request.style, catalog.family_of_model(model_id), label)


@app.get("/api/settings")
def settings() -> dict[str, Any]:
    return {"claude": prompt_ai.settings_view()}


@app.post("/api/settings/claude")
def save_claude_key(request: ClaudeKeyRequest) -> dict[str, Any]:
    return {"claude": prompt_ai.save_key(ROOT_DIR, request.api_key)}


@app.delete("/api/settings/claude")
def delete_claude_key() -> dict[str, Any]:
    return {"claude": prompt_ai.delete_key(ROOT_DIR)}


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
                "in_use": loaded.model_key == model["id"],
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
        if loaded.model_key == id and loaded.pipe is not None:
            _unload_current_pipeline()
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
        if loaded.lora_key == relative and loaded.pipe is not None:
            # Z-Image 的 LoRA 已合并进权重，卸不掉，只能整个模型卸载
            _unload_current_pipeline()
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
    global latest_generation_metrics

    with generation_lock:
        # 从拿到锁开始计时，排队等待的时间不算进耗时
        started = time.time()
        model_key = request.model.strip() or DEFAULT_MODEL
        needs_load = loaded.model_key != model_key or (
            catalog.family_of_model(model_key) == "zimage"
            and ((request.lora_path.strip() or None) != loaded.lora_key or request.lora_scale != (loaded.lora_scale or request.lora_scale))
        )
        progress.update(phase="loading" if needs_load else "denoising", step=0, total=request.steps, started=started)
        before_load_gpu = _gpu_snapshot()
        try:
            pipe, torch = _load_pipeline(request.model, request.lora_path, request.lora_scale)
        except Exception:
            progress.update(phase="idle")
            raise
        progress.update(phase="denoising", step=0)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        seed = request.seed if request.seed is not None else torch.seed() % (2**32)
        generator = torch.Generator(device=device).manual_seed(seed)
        after_load_gpu = _gpu_snapshot()

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()

        sampler = GpuSampler()
        sampler.start()

        def on_step_end(_pipe: Any, step: int, _timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
            progress.update(step=step + 1)
            return callback_kwargs

        # Turbo 这类 CFG=0 的蒸馏模型不用反向提示词
        use_negative = bool(request.negative_prompt) and request.guidance_scale > 1.0
        try:
            result = pipe(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt if use_negative else None,
                width=request.width,
                height=request.height,
                num_inference_steps=request.steps,
                guidance_scale=request.guidance_scale,
                generator=generator,
                callback_on_step_end=on_step_end,
            )
        except RuntimeError as exc:
            progress.update(phase="idle")
            samples = sampler.stop()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            peak_memory_sample = _peak_sample(samples, "memory_used_mb")
            peak_util_sample = _peak_sample(samples, "utilization_percent")
            latest_generation_metrics = {
                "ok": False,
                "seconds": round(time.time() - started, 2),
                "before_load": before_load_gpu,
                "after_load": after_load_gpu,
                "peak_memory": peak_memory_sample,
                "peak_utilization": peak_util_sample,
                "error": str(exc),
            }
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        samples = sampler.stop()
        after_gpu = _gpu_snapshot()
        torch_memory = _torch_memory_snapshot(torch)
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

        image = result.images[0]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_seed = int(seed)
        image_name = f"{timestamp}_seed-{safe_seed}.png"
        image_path = OUTPUT_DIR / image_name
        metadata_path = image_path.with_suffix(".json")
        image.save(image_path)
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
        "seconds": round(time.time() - started, 2),
        "gpu_metrics": gpu_metrics,
        "images": _image_records(),
    }
