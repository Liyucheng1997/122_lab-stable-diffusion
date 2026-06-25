from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "static"
OUTPUT_DIR = ROOT_DIR / "outputs"
LORA_DIR = ROOT_DIR / "loras"
MODEL_DIR = ROOT_DIR / "models"
HF_CACHE_DIR = ROOT_DIR / "hf_cache"

DEFAULT_MODEL = "stable-diffusion-v1-5/stable-diffusion-v1-5"
DEEPSEEK_API_BASE = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-v4-flash"
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
HF_CACHE_DIR.mkdir(exist_ok=True)
os.environ.setdefault("HF_HOME", str(HF_CACHE_DIR))
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
    width: int = Field(default=512, ge=256, le=1536, multiple_of=8)
    height: int = Field(default=512, ge=256, le=1536, multiple_of=8)
    steps: int = Field(default=25, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=0.0, le=30.0)
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)


class PromptOptimizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    style: str = Field(default="", max_length=500)
    target_model: str = Field(default="Stable Diffusion 1.5", max_length=120)


class LoadedPipeline:
    pipe: Any | None = None
    model_key: str | None = None
    lora_key: str | None = None
    lora_scale: float | None = None


loaded = LoadedPipeline()
generation_lock = Lock()
latest_generation_metrics: dict[str, Any] | None = None


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


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise HTTPException(status_code=502, detail="DeepSeek 没有返回可解析的 JSON。")
        value = json.loads(cleaned[start : end + 1])
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="DeepSeek 返回格式无效。")
    return value


def _optimize_prompt_with_deepseek(request: PromptOptimizeRequest) -> dict[str, Any]:
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="未配置 DEEPSEEK_API_KEY。请在项目 .env 文件或系统环境变量中设置。",
        )

    base_url = os.environ.get("DEEPSEEK_API_BASE", DEEPSEEK_API_BASE).rstrip("/")
    model = os.environ.get("DEEPSEEK_MODEL", DEEPSEEK_MODEL).strip() or DEEPSEEK_MODEL
    system_prompt = (
        "You are a professional Stable Diffusion prompt engineer. "
        "Convert Chinese image descriptions into high-quality English prompts for text-to-image generation. "
        "Optimize for Stable Diffusion composition, subject clarity, lighting, camera, materials, atmosphere, "
        "and style tags. Keep the user's intent, but do not add explicit sexual content, minors in sexualized contexts, "
        "or illegal content. Return only valid JSON with keys: prompt, negative_prompt, notes. "
        "The prompt should be a single English comma-separated prompt. "
        "The negative_prompt should be a concise English comma-separated list."
    )
    user_prompt = (
        f"Chinese description:\n{request.text}\n\n"
        f"Preferred style or extra requirements:\n{request.style or 'None'}\n\n"
        f"Target image model:\n{request.target_model}\n\n"
        "Return JSON only."
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "response_format": {"type": "json_object"},
        "max_tokens": 900,
        "temperature": 0.4,
        "thinking": {"type": "disabled"},
    }

    try:
        with httpx.Client(timeout=45) as client:
            response = client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"DeepSeek 请求失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"DeepSeek API 错误：{response.text[:800]}")

    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = _extract_json_object(content)
    prompt = str(parsed.get("prompt", "")).strip()
    negative_prompt = str(parsed.get("negative_prompt", "")).strip()
    notes = str(parsed.get("notes", "")).strip()
    if not prompt:
        raise HTTPException(status_code=502, detail="DeepSeek 没有返回 prompt。")

    return {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "notes": notes,
        "model": model,
    }


def _load_pipeline(model: str, lora_path: str, lora_scale: float) -> tuple[Any, Any]:
    torch, AutoPipelineForText2Image = _import_torch_and_diffusers()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    model_key = model.strip() or DEFAULT_MODEL
    lora_key = lora_path.strip()

    if loaded.pipe is None or loaded.model_key != model_key:
        if loaded.pipe is not None:
            loaded.pipe.to("cpu")
            del loaded.pipe
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        model_path = _resolve_user_path(model_key) if any(sep in model_key for sep in ("/", "\\")) else None
        load_kwargs = {
            "torch_dtype": dtype,
            "use_safetensors": True,
        }
        if model_path and model_path.exists() and model_path.is_file():
            pipe = AutoPipelineForText2Image.from_single_file(str(model_path), **load_kwargs)
        else:
            source = str(model_path) if model_path and model_path.exists() else model_key
            if device == "cuda":
                load_kwargs["variant"] = "fp16"
            try:
                pipe = AutoPipelineForText2Image.from_pretrained(source, **load_kwargs)
            except (OSError, ValueError):
                load_kwargs.pop("variant", None)
                pipe = AutoPipelineForText2Image.from_pretrained(source, **load_kwargs)

        pipe.to(device)
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
            resolved_lora = _resolve_user_path(lora_key)
            if not resolved_lora.exists():
                raise HTTPException(status_code=400, detail=f"LoRA 文件不存在：{resolved_lora}")
            loaded.pipe.load_lora_weights(str(resolved_lora), adapter_name="local_lora")
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


def _lora_records() -> list[dict[str, Any]]:
    extensions = {".safetensors", ".pt", ".bin", ".ckpt"}
    records: list[dict[str, Any]] = []
    for lora_path in sorted(LORA_DIR.rglob("*"), key=lambda p: str(p).lower()):
        if "disabled" in lora_path.relative_to(LORA_DIR).parts:
            continue
        if not lora_path.is_file() or lora_path.suffix.lower() not in extensions:
            continue
        relative_path = lora_path.relative_to(ROOT_DIR).as_posix()
        records.append(
            {
                "name": lora_path.name,
                "display_name": LORA_DISPLAY_NAMES.get(lora_path.name, _fallback_lora_display_name(lora_path)),
                "path": relative_path,
                "size_mb": round(lora_path.stat().st_size / 1024 / 1024, 2),
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
    }


@app.get("/api/images")
def images() -> dict[str, list[dict[str, str]]]:
    return {"images": _image_records()}


@app.get("/api/loras")
def loras() -> dict[str, list[dict[str, Any]]]:
    return {"loras": _lora_records()}


@app.post("/api/prompt/optimize")
def optimize_prompt(request: PromptOptimizeRequest) -> dict[str, Any]:
    return _optimize_prompt_with_deepseek(request)


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
    global latest_generation_metrics

    started = time.time()
    with generation_lock:
        before_load_gpu = _gpu_snapshot()
        pipe, torch = _load_pipeline(request.model, request.lora_path, request.lora_scale)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        seed = request.seed if request.seed is not None else torch.seed() % (2**32)
        generator = torch.Generator(device=device).manual_seed(seed)
        after_load_gpu = _gpu_snapshot()

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()

        sampler = GpuSampler()
        sampler.start()

        try:
            result = pipe(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt or None,
                width=request.width,
                height=request.height,
                num_inference_steps=request.steps,
                guidance_scale=request.guidance_scale,
                generator=generator,
            )
        except RuntimeError as exc:
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

    return {
        "url": f"/outputs/{image_name}",
        "path": str(image_path),
        "seed": safe_seed,
        "seconds": round(time.time() - started, 2),
        "gpu_metrics": gpu_metrics,
        "images": _image_records(),
    }
