"""姿势参考库：1439 张多角度人体姿势（白模线稿 + 深度图），出图时用 ControlNet 控制人物的动作。

来源：https://github.com/anhao/ai-pose-gallery-zh （在线版 https://ai-pose-gallery.anhao.app/poses）
图片原作者ギア（@giaaibusi），版权归原作者，只供个人学习和创作，不再分发，所以 poses/ 不进 git，
第一次用时在网页上点「下载姿势库」或运行 scripts/download_poses.py。

    poses/poses.json         姿势列表（中文元数据）
    poses/thumbs/<id>.jpg    缩略图 300 × 400（姿势库里看的）
    poses/depth/<id>.webp    深度图 900 × 1200（出图时从它提取轮廓当控制图）
    poses/img/<id>.png       白模线稿原图 900 × 1200（可选，出图用不到，下载时加 --full）
"""

from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

ROOT_DIR = Path(__file__).resolve().parent.parent
POSE_DIR = ROOT_DIR / "poses"
INDEX_PATH = POSE_DIR / "poses.json"

REPO = "anhao/ai-pose-gallery-zh"
REF = "ec7a81e11fd599406ad60796be70ac693e5b6340"  # 固定到核对过的版本

# 体系和视角按原站的顺序排
SYSTEMS = ["全身单人・标准系", "全身单人・性感系", "上半身单人", "双人缠绵"]
ANGLES = ["正面", "斜侧", "侧面", "俯视", "仰视"]

# 控制图用「轮廓」：从深度图提取的人物外轮廓和四肢交叠处的边，衣服、脸、背景照提示词画。实测排除了：
#   深度图直接用：强度够让人物摆出姿势时，画出来就是一个没脸的白模
#   白模线稿：关节圆圈和身体分割线会画成白色紧身衣
# 强度（Lite 版，同一提示词同一 seed）：0.7 基本不跟姿势；0.8～0.9 动作准、衣服自然；1.0 衣服贴着身体轮廓
DEFAULT_SCALE = 0.85

# ControlNet：Z-Image Turbo 官方 Union 控制网的 Lite 版（2602，8 步蒸馏）：3 个控制层，约 1B 参数，bf16 直接放显卡。
# 不用完整版（15 个控制层，3.3B）：16GB 显卡上它要 fp8 存权重，每层算时临时转回 bf16，显存反复申请释放，
# 实占比实用多 4～5GB，峰值 14.8GB，会爆显存，也拖累内存；Lite 版峰值 9.7GB，每张还快 30%（实测）。
CONTROLNET = {
    "id": "zimage-controlnet-union-lite",
    "label": "Z-Image Turbo ControlNet Union 2.1 Lite",
    "repo": "alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1",
    "file": "Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps.safetensors",
    "folder": "Z-Image-Turbo-ControlNet-Union-2.1-lite-2602",
    "size_gb": 2.02,
    "license": "Apache-2.0",
    "control_layers_places": [0, 10, 20],  # 挂在 transformer 的第几层，照官方 z_image_control_2.1_lite.yaml
}
CONTROLNET_PATH = ROOT_DIR / "models" / "controlnet" / CONTROLNET["file"]
# 下载的是单文件；下载完转成 diffusers 目录（之后直接按目录加载，内存映射），再删掉单文件
CONTROLNET_DIR = ROOT_DIR / "models" / "controlnet" / CONTROLNET["folder"]

# 配置照官方 VideoX-Fun 的 config/z_image/z_image_control_2.1*.yaml 写，不让 diffusers 按权重去猜：
# Lite 版它猜不对（会当成 1.0 版），而且猜的时候还要联网下载配置
CONTROLNET_CONFIG = {
    "_class_name": "ZImageControlNetModel",
    "add_control_noise_refiner": "control_noise_refiner",
    "all_f_patch_size": [1],
    "all_patch_size": [2],
    "control_in_dim": 33,
    "control_refiner_layers_places": [0, 1],
    "dim": 3840,
    "n_heads": 30,
    "n_kv_heads": 30,
    "n_refiner_layers": 2,
    "norm_eps": 1e-05,
    "qk_norm": True,
}


def controlnet_converted() -> bool:
    return (CONTROLNET_DIR / "config.json").is_file() and any(CONTROLNET_DIR.glob("*.safetensors"))


def controlnet_installed() -> bool:
    return controlnet_converted() or CONTROLNET_PATH.is_file()


def convert_controlnet(source: Path | None = None, target: Path | None = None, places: list[int] | None = None) -> None:
    """单文件 → bf16 diffusers 目录，成功后删掉单文件。不用联网。

    完整版峰值内存约 10GB，所以下载完就在单独的进程里做（见 main.py），不等到 Z-Image 已经占着 20GB 内存时再做。
    """
    source = source or CONTROLNET_PATH
    target = target or CONTROLNET_DIR
    places = places or CONTROLNET["control_layers_places"]
    if (target / "config.json").is_file() and any(target.glob("*.safetensors")):
        return
    import shutil
    import tempfile

    import torch
    from diffusers import ZImageControlNetModel

    tmp = target.with_name(target.name + ".part")
    shutil.rmtree(tmp, ignore_errors=True)
    with tempfile.TemporaryDirectory() as config_dir:
        Path(config_dir, "config.json").write_text(json.dumps({**CONTROLNET_CONFIG, "control_layers_places": places}), encoding="utf-8")
        model = ZImageControlNetModel.from_single_file(str(source), config=config_dir, torch_dtype=torch.bfloat16)
    model.save_pretrained(str(tmp))
    del model
    shutil.rmtree(target, ignore_errors=True)
    tmp.rename(target)
    source.unlink(missing_ok=True)


def raw_url(path: str) -> str:
    base = os.environ.get("POSE_MIRROR", "https://raw.githubusercontent.com").rstrip("/")
    return f"{base}/{REPO}/{REF}/{path}"


# ---------------------------------------------------------------------------
# 姿势列表
# ---------------------------------------------------------------------------

_cache: dict[str, Any] = {"mtime": None, "items": [], "by_id": {}}
_cache_lock = threading.Lock()


def _load() -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    try:
        mtime = INDEX_PATH.stat().st_mtime
    except OSError:
        return [], {}
    with _cache_lock:
        if _cache["mtime"] != mtime:
            try:
                raw = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raw = []
            items = [
                {
                    "id": p["id"],
                    "system": p.get("体系", ""),
                    "number": p.get("姿势编号", ""),
                    "category": p.get("分类", ""),
                    "name": p.get("姿势名称", ""),
                    "angle": p.get("角度", ""),
                }
                for p in raw
                if isinstance(p, dict) and isinstance(p.get("id"), str)
            ]
            rank = {name: i for i, name in enumerate(SYSTEMS)}
            angle_rank = {name: i for i, name in enumerate(ANGLES)}
            items.sort(key=lambda p: (rank.get(p["system"], 99), p["number"], angle_rank.get(p["angle"], 99)))
            _cache.update(mtime=mtime, items=items, by_id={p["id"]: p for p in items})
        return _cache["items"], _cache["by_id"]


def pose_by_id(pose_id: str) -> dict[str, Any] | None:
    return _load()[1].get(pose_id)


def describe(pose: dict[str, Any]) -> str:
    """给助手看的一句话：体系 / 分类 / 姿势名称（视角）。"""
    return f"{pose['system']} · {pose['category']} · {pose['name']}（{pose['angle']}视角）"


def file_path(pose_id: str, kind: str) -> Path:
    if kind == "full":
        return POSE_DIR / "img" / f"{pose_id}.png"
    if kind == "depth":
        return POSE_DIR / "depth" / f"{pose_id}.webp"
    return POSE_DIR / "thumbs" / f"{pose_id}.jpg"


def library() -> dict[str, Any]:
    items, _ = _load()
    return {
        "installed": bool(items) and (POSE_DIR / "depth").is_dir(),
        "count": len(items),
        "items": items,
        "systems": [s for s in SYSTEMS if any(p["system"] == s for p in items)],
        "angles": ANGLES,
        "default_scale": DEFAULT_SCALE,
        "source": "https://ai-pose-gallery.anhao.app/poses",
        "job": downloader.snapshot(),
        "controlnet": {
            **CONTROLNET,
            "installed": controlnet_installed(),
            "path": (CONTROLNET_DIR if controlnet_converted() else CONTROLNET_PATH).relative_to(ROOT_DIR).as_posix(),
        },
    }


# ---------------------------------------------------------------------------
# 下载姿势库（网页上的「下载姿势库」和 scripts/download_poses.py 共用）
# ---------------------------------------------------------------------------


def _fetch(client: httpx.Client, path: str, target: Path) -> str | None:
    if target.exists() and target.stat().st_size > 0:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    error = ""
    for _ in range(3):
        try:
            response = client.get(raw_url(path))
            response.raise_for_status()
            tmp.write_bytes(response.content)
            tmp.replace(target)
            return None
        except (httpx.HTTPError, OSError) as exc:
            error = f"{path}: {exc}"
    return error


def download_all(full: bool = False, workers: int = 16, on_progress: Any = None) -> tuple[int, list[str]]:
    """下载姿势列表、缩略图、深度图（约 55MB），full=True 时连同白模线稿原图（约 640MB）。已有的文件跳过。

    返回 (文件数, 失败列表)。
    """
    POSE_DIR.mkdir(exist_ok=True)
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        response = client.get(raw_url("data/pose-zh.json"))
        response.raise_for_status()
        poses = response.json()
        tasks: list[tuple[str, Path]] = []
        for pose in poses:
            pid = pose["id"]
            tasks.append((f"thumbs/{pid}.jpg", file_path(pid, "thumb")))
            tasks.append((f"img/depth/{pid}.webp", file_path(pid, "depth")))
            if full:
                tasks.append((f"img/{pid}.png", file_path(pid, "full")))
        errors: list[str] = []
        done = 0
        with ThreadPoolExecutor(workers) as pool:
            for error in pool.map(lambda task: _fetch(client, *task), tasks):
                done += 1
                if error:
                    errors.append(error)
                if on_progress:
                    on_progress(done, len(tasks), len(errors))
    # 列表最后写：网页看到 poses.json 就认为图片都在了
    tmp = INDEX_PATH.with_suffix(".json.part")
    tmp.write_text(json.dumps(poses, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(INDEX_PATH)
    return len(tasks), errors


class PoseDownloader:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.job: dict[str, Any] | None = None

    def snapshot(self) -> dict[str, Any] | None:
        with self._lock:
            return dict(self.job) if self.job else None

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self.job and self.job["status"] == "downloading":
                return dict(self.job)
            self.job = {"status": "downloading", "done": 0, "total": 0, "failed": 0, "error": "", "started": time.time()}
        threading.Thread(target=self._run, daemon=True, name="pose-download").start()
        return self.snapshot() or {}

    def _update(self, **fields: Any) -> None:
        with self._lock:
            if self.job:
                self.job.update(fields)

    def _run(self) -> None:
        try:
            total, errors = download_all(on_progress=lambda done, total, failed: self._update(done=done, total=total, failed=failed))
            if errors:
                self._update(status="error", error=f"{len(errors)} / {total} 个文件下载失败，再点一次会接着下载。")
            else:
                self._update(status="done")
        except Exception as exc:  # noqa: BLE001 - 失败原因告诉前端
            text = str(exc) or type(exc).__name__
            if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
                text = "连不上 GitHub（raw.githubusercontent.com）。可以在 .env 里设置 POSE_MIRROR 换成镜像地址后重启。"
            self._update(status="error", error=text[:300])


downloader = PoseDownloader()


# ---------------------------------------------------------------------------
# 控制图
# ---------------------------------------------------------------------------


def control_image(pose_id: str, width: int, height: int) -> Any:
    """按出图尺寸准备控制图：人物轮廓，黑底白线（和 ControlNet 训练用的 HED / Scribble 一致）。

    整个人物都保留，不裁切：比例和姿势图（3:4）不一样时，在两侧或上下补黑边。
    """
    from PIL import Image

    image = outline_image(pose_id)
    scale = min(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    if resized.size == (width, height):
        return resized
    canvas = Image.new("RGB", (width, height), (0, 0, 0))
    canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return canvas


def outline_image(pose_id: str) -> Any:
    """从深度图提取轮廓：深度突变的地方就是人物外沿和四肢交叠处；背景、地面是平缓的渐变，不会出线。"""
    import numpy as np
    from PIL import Image, ImageFilter

    with Image.open(file_path(pose_id, "depth")) as source:
        depth = source.convert("L").filter(ImageFilter.GaussianBlur(2))
    values = np.asarray(depth, dtype=np.float32)
    gx = np.zeros_like(values)
    gy = np.zeros_like(values)
    gx[:, 1:-1] = values[:, 2:] - values[:, :-2]
    gy[1:-1, :] = values[2:, :] - values[:-2, :]
    edges = (np.hypot(gx, gy) > 6).astype(np.uint8) * 255
    return Image.fromarray(edges).filter(ImageFilter.MaxFilter(3)).convert("RGB")
