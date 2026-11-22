"""生成工作进程：加载模型、挂 LoRA、出图。

网页服务（app/main.py）不直接碰 PyTorch，而是把任务发给这个独立进程：
- 换模型、换 Z-Image 的 LoRA 时，主进程直接结束旧进程、开新进程加载，内存由系统整块收回。
  之前在同一进程里反复加载 32GB 的 Z-Image，会在读取权重时触发 0xC0000005 访问冲突，把整个服务带崩。
- 万一工作进程崩溃，网页服务还活着，只会提示“再生成一次”。

主进程与工作进程之间用 multiprocessing.Pipe 传字典消息：
  主 → 工作：{"cmd": "generate", "job": {...}} / {"cmd": "exit"}
  工作 → 主：{"type": "loaded", "state": {...}} / {"type": "progress", "step": n}
             {"type": "done", "torch_memory": {...}} / {"type": "error", "status": 4xx/5xx, "detail": "..."}
"""

from __future__ import annotations

import json
import struct
import traceback
from pathlib import Path
from typing import Any

from app import catalog

ROOT_DIR = Path(__file__).resolve().parent.parent
LORA_DIR = ROOT_DIR / "loras"
DEFAULT_MODEL = "Tongyi-MAI/Z-Image-Turbo"


class EngineError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class LoadedPipeline:
    pipe: Any | None = None
    model_key: str | None = None
    lora_key: str | None = None
    lora_scale: float | None = None
    memory_mode: str | None = None
    img2img: Any | None = None  # 图生图管线，和 pipe 共用同一套权重，第一次用到时才建
    on_gpu: bool = False  # 整个模型常驻显存（SD 1.5 / SDXL）；Z-Image 靠 offload，空闲时本来就在内存里
    parked: bool = False  # 已经把显存让给本地 LLM，下次出图前要搬回显卡


loaded = LoadedPipeline()


def state() -> dict[str, Any]:
    return {
        "model_key": loaded.model_key,
        "lora_key": loaded.lora_key,
        "lora_scale": loaded.lora_scale,
        "memory_mode": loaded.memory_mode,
    }


def _import_torch_and_diffusers() -> tuple[Any, Any]:
    try:
        import torch
        from diffusers import AutoPipelineForText2Image
    except ImportError as exc:
        raise EngineError(503, "依赖尚未安装完整。请先在虚拟环境中安装 requirements.txt 以及带 CUDA 的 PyTorch。") from exc
    return torch, AutoPipelineForText2Image


def _resolve_user_path(raw_path: str) -> Path:
    path = Path(raw_path.strip().strip('"'))
    if not path.is_absolute():
        path = ROOT_DIR / path
    try:
        return path.resolve()
    except OSError as exc:
        raise EngineError(400, f"路径无效：{raw_path}") from exc


def torch_memory_snapshot(torch: Any) -> dict[str, Any]:
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
        with open(model_path, "rb") as f:
            header_size = struct.unpack("<Q", f.read(8))[0]
            header = json.loads(f.read(header_size))
        return any(key.startswith("conditioner.embedders.1") for key in header)
    except (OSError, ValueError, struct.error):
        return False


def _model_source(model_key: str) -> str:
    """内置模型从 models/ 目录加载；其他的按路径或 Hugging Face ID 处理。"""
    preset = catalog.model_by_id(model_key)
    if preset:
        if not catalog.model_installed(preset):
            hint = "先在「模型库」里下载。" if preset.get("downloadable") else "文件不在 models/ 目录里。"
            raise EngineError(400, f"{preset['label']} 还没下载。{hint}")
        return str(catalog.model_path(preset))
    model_path = _resolve_user_path(model_key)
    return str(model_path) if model_path.exists() else model_key


def _resolve_lora_path(lora_key: str) -> Path:
    resolved = _resolve_user_path(lora_key)
    if resolved.exists():
        return resolved
    # 旧图片记录里的路径（例如 loras/xxx.safetensors）在整理目录后换了位置，按文件名再找一次
    name = Path(lora_key).name
    matches = [p for p in LORA_DIR.rglob(name) if p.is_file()]
    if matches:
        return matches[0]
    raise EngineError(400, f"LoRA 文件不存在：{lora_key}。可能已被删除，可以在 LoRA 库里重新下载。")


def _load_zimage(model_key: str, torch: Any, device: str) -> Any:
    """Z-Image Turbo：6B DiT + Qwen3 文本编码器，bf16 约 20GB，16GB 显卡要靠 offload。

    LoRA 不在这里处理，而是由 RuntimeLora 以“外挂层”方式挂上，换 LoRA 不用重新加载模型。
    """
    from diffusers import ZImagePipeline

    source = _model_source(model_key)
    pipe = ZImagePipeline.from_pretrained(source, torch_dtype=torch.bfloat16)
    if device != "cuda":
        loaded.memory_mode = "CPU"
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


class RuntimeLora:
    """把 LoRA 当作外挂层挂在 transformer 的线性层上：输出 = 原输出 + scale × B(A(x))。

    Z-Image 的权重为了省显存以 fp8 存储，PEFT 挂 LoRA 时会把 LoRA 层也建成 fp8（CUDA 不支持 fp8 矩阵乘，
    会报 addmm_cuda 错误）。这里 LoRA 权重单独以 bf16 放在显卡上计算，不改动模型本身：
    换 LoRA 只是摘掉旧挂件、挂上新挂件，改权重只是改一个系数，都不需要重新加载 32GB 的模型。
    """

    def __init__(self) -> None:
        self.handles: list[Any] = []
        self.scale = 1.0

    def clear(self) -> None:
        for handle in self.handles:
            handle.remove()
        self.handles = []
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    def apply(self, pipe: Any, torch: Any, path: Path, scale: float) -> None:
        from diffusers import ZImagePipeline

        self.clear()
        result = ZImagePipeline.lora_state_dict(str(path))
        state_dict = result[0] if isinstance(result, tuple) else result
        pairs: dict[str, dict[str, Any]] = {}
        for key, tensor in state_dict.items():
            if not key.startswith("transformer.") or ".lora_" not in key:
                continue
            name, kind = key[len("transformer.") :].rsplit(".lora_", 1)
            pairs.setdefault(name, {})[kind.split(".")[0]] = tensor
        if not pairs:
            raise EngineError(400, "这个 LoRA 里没有可用于 Z-Image 的权重，可能是给别的模型用的。")

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        functional = torch.nn.functional
        handles = []
        try:
            for name, weights in pairs.items():
                if "A" not in weights or "B" not in weights:
                    continue
                module = pipe.transformer.get_submodule(name)
                if not isinstance(module, torch.nn.Linear):
                    raise EngineError(400, f"LoRA 层 {name} 不是线性层，暂不支持这种 LoRA。")
                lora_a = weights["A"].to(device=device, dtype=torch.bfloat16)
                lora_b = weights["B"].to(device=device, dtype=torch.bfloat16)
                if lora_a.shape[1] != module.in_features or lora_b.shape[0] != module.out_features:
                    raise EngineError(400, f"LoRA 层 {name} 的尺寸和 Z-Image 不一致，可能是给别的模型用的。")

                def hook(_module: Any, inputs: tuple[Any, ...], output: Any, a: Any = lora_a, b: Any = lora_b) -> Any:
                    x = inputs[0]
                    delta = functional.linear(functional.linear(x.to(device=a.device, dtype=a.dtype), a), b)
                    return output + (delta * self.scale).to(dtype=output.dtype, device=output.device)

                handles.append(module.register_forward_hook(hook))
        except AttributeError as exc:
            for handle in handles:
                handle.remove()
            raise EngineError(400, f"LoRA 和 Z-Image 的结构对不上，可能是给别的模型用的：{str(exc)[:120]}") from exc
        except Exception:
            for handle in handles:
                handle.remove()
            raise
        self.handles = handles
        self.scale = scale


runtime_lora = RuntimeLora()


def _apply_zimage_lora(lora_key: str, lora_scale: float, torch: Any) -> None:
    if lora_key == (loaded.lora_key or ""):
        if lora_key and lora_scale != loaded.lora_scale:
            runtime_lora.scale = lora_scale  # 只改权重：改个系数就行
            loaded.lora_scale = lora_scale
        return
    runtime_lora.clear()
    loaded.lora_key = None
    loaded.lora_scale = None
    if not lora_key:
        return
    runtime_lora.apply(loaded.pipe, torch, _resolve_lora_path(lora_key), lora_scale)
    loaded.lora_key = lora_key
    loaded.lora_scale = lora_scale


def _load_sd(model_key: str, torch: Any, auto_pipeline: Any, device: str) -> Any:
    dtype = torch.float16 if device == "cuda" else torch.float32
    source_str = _model_source(model_key)
    model_path = Path(source_str) if Path(source_str).exists() else None
    load_kwargs: dict[str, Any] = {"torch_dtype": dtype, "use_safetensors": True}
    if model_path and model_path.is_file():
        from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline

        pipeline_cls = StableDiffusionXLPipeline if _is_sdxl_single_file(model_path) else StableDiffusionPipeline
        pipe = pipeline_cls.from_single_file(str(model_path), **load_kwargs)
    else:
        source = str(model_path) if model_path else model_key
        if device == "cuda":
            load_kwargs["variant"] = "fp16"
        try:
            pipe = auto_pipeline.from_pretrained(source, **load_kwargs)
        except (OSError, ValueError):
            load_kwargs.pop("variant", None)
            pipe = auto_pipeline.from_pretrained(source, **load_kwargs)
    pipe.to(device)
    loaded.on_gpu = device == "cuda"
    loaded.memory_mode = "全部在显存" if device == "cuda" else "CPU"
    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    return pipe


def _apply_sd_lora(model_key: str, lora_key: str, lora_scale: float) -> None:
    """SD 1.5 / SDXL 的 LoRA 可以动态挂载和卸下，不需要重新加载模型。"""
    if lora_key == (loaded.lora_key or "") and (not lora_key or lora_scale == loaded.lora_scale):
        return
    if loaded.lora_key and hasattr(loaded.pipe, "unload_lora_weights"):
        loaded.pipe.unload_lora_weights()
    loaded.lora_key = None
    loaded.lora_scale = None
    if not lora_key:
        return
    resolved_lora = _resolve_lora_path(lora_key)
    try:
        loaded.pipe.load_lora_weights(str(resolved_lora), adapter_name="local_lora")
    except Exception as exc:  # noqa: BLE001
        try:
            loaded.pipe.unload_lora_weights()
        except Exception:  # noqa: BLE001
            pass
        family = catalog.family_of_model(model_key)
        raise EngineError(
            400,
            f"LoRA 加载失败，多半是它和当前 {catalog.FAMILY_LABELS.get(family, family)} 模型不匹配。原始错误：{str(exc)[:200]}",
        ) from exc
    if hasattr(loaded.pipe, "set_adapters"):
        loaded.pipe.set_adapters(["local_lora"], adapter_weights=[lora_scale])
    loaded.lora_key = lora_key
    loaded.lora_scale = lora_scale


def load_pipeline(model: str, lora_path: str, lora_scale: float) -> tuple[Any, Any]:
    torch, auto_pipeline = _import_torch_and_diffusers()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model_key = model.strip() or DEFAULT_MODEL
    lora_key = lora_path.strip()
    family = catalog.family_of_model(model_key)

    if loaded.pipe is not None and loaded.model_key != model_key:
        # 正常情况下主进程会为新模型开新进程，这里只是兜底
        raise EngineError(500, "工作进程里已经有别的模型，请重试。")

    if loaded.pipe is None:
        if family == "zimage":
            loaded.pipe = _load_zimage(model_key, torch, device)
        else:
            loaded.pipe = _load_sd(model_key, torch, auto_pipeline, device)
        loaded.model_key = model_key
    elif loaded.parked:
        loaded.pipe.to("cuda")
        loaded.parked = False

    if family == "zimage":
        _apply_zimage_lora(lora_key, lora_scale, torch)
    else:
        _apply_sd_lora(model_key, lora_key, lora_scale)
    return loaded.pipe, torch


def _img2img_pipeline(pipe: Any, model_key: str) -> Any:
    """图生图管线直接复用已加载的各个部件（权重、offload、LoRA 挂件都是同一份），不额外占内存。"""
    if loaded.img2img is None:
        if catalog.family_of_model(model_key) == "zimage":
            from diffusers import ZImageImg2ImgPipeline

            loaded.img2img = ZImageImg2ImgPipeline(**pipe.components)
        else:
            from diffusers import AutoPipelineForImage2Image

            loaded.img2img = AutoPipelineForImage2Image.from_pipe(pipe)
    return loaded.img2img


def _load_init_image(path: str, width: int, height: int) -> Any:
    """参考图按输出尺寸居中裁剪并缩放，出图尺寸始终等于用户选的尺寸。"""
    from PIL import Image, ImageOps

    try:
        with Image.open(path) as source:
            image = source.convert("RGB")
    except (OSError, ValueError) as exc:
        raise EngineError(400, "参考图读取失败，请重新选择参考图。") from exc
    return ImageOps.fit(image, (width, height), Image.Resampling.LANCZOS)


def _handle_generate(conn: Any, job: dict[str, Any]) -> None:
    pipe, torch = load_pipeline(job["model"], job["lora_path"], job["lora_scale"])
    conn.send({"type": "loaded", "state": state()})

    extra: dict[str, Any] = {}
    if job.get("init_image_path"):
        extra["image"] = _load_init_image(job["init_image_path"], job["width"], job["height"])
        extra["strength"] = job["strength"]
        pipe = _img2img_pipeline(pipe, job["model"])

    device = "cuda" if torch.cuda.is_available() else "cpu"
    generator = torch.Generator(device=device).manual_seed(int(job["seed"]))
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    def on_step_end(_pipe: Any, step: int, _timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
        conn.send({"type": "progress", "step": step + 1})
        return callback_kwargs

    # Turbo 这类 CFG=0 的蒸馏模型不用反向提示词
    use_negative = bool(job["negative_prompt"]) and job["guidance_scale"] > 1.0
    try:
        result = pipe(
            prompt=job["prompt"],
            negative_prompt=job["negative_prompt"] if use_negative else None,
            width=job["width"],
            height=job["height"],
            num_inference_steps=job["steps"],
            guidance_scale=job["guidance_scale"],
            generator=generator,
            callback_on_step_end=on_step_end,
            **extra,
        )
    except RuntimeError as exc:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise EngineError(500, str(exc)) from exc

    result.images[0].save(job["image_path"])
    conn.send({"type": "done", "torch_memory": torch_memory_snapshot(torch)})


def _handle_park() -> None:
    """把显存让给本地 LLM：常驻显存的模型搬到内存，再清掉 PyTorch 留着不还的显存缓存。"""
    if loaded.pipe is None:
        return
    import gc

    import torch

    if not torch.cuda.is_available():
        return
    if loaded.on_gpu and not loaded.parked:
        loaded.pipe.to("cpu")
        loaded.parked = True
    gc.collect()
    torch.cuda.empty_cache()


def worker_main(conn: Any) -> None:
    """工作进程入口：一直等主进程发任务，直到收到 exit 或管道关闭。"""
    while True:
        try:
            message = conn.recv()
        except (EOFError, OSError):
            return
        if message.get("cmd") == "exit":
            return
        if message.get("cmd") == "park":
            try:
                _handle_park()
            except Exception:  # noqa: BLE001 - 让不出来也要回话，主进程会改为直接结束本进程
                traceback.print_exc()
                conn.send({"type": "park_failed"})
            else:
                conn.send({"type": "parked"})
            continue
        if message.get("cmd") != "generate":
            continue
        try:
            _handle_generate(conn, message["job"])
        except EngineError as exc:
            conn.send({"type": "error", "status": exc.status, "detail": exc.detail, "state": state()})
        except Exception as exc:  # noqa: BLE001 - 任何异常都回报给主进程，而不是让进程退出
            traceback.print_exc()
            conn.send({"type": "error", "status": 500, "detail": str(exc)[:500], "state": state()})
