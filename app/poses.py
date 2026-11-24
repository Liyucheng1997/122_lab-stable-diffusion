"""姿势参考库：1439 张多角度人体姿势（白模线稿 + 深度图），出图时用 ControlNet 控制人物的动作。

来源：https://github.com/anhao/ai-pose-gallery-zh （在线版 https://ai-pose-gallery.anhao.app/poses）
图片原作者ギア（@giaaibusi），版权归原作者，只供个人学习和创作，不再分发，所以 poses/ 不进 git，
第一次用时在网页上点「下载姿势库」或运行 scripts/download_poses.py。

    poses/poses.json         姿势列表（中文元数据）
    poses/thumbs/<id>.jpg    缩略图 300 × 400
    poses/img/<id>.png       白模线稿 900 × 1200
    poses/depth/<id>.webp    深度图 900 × 1200
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

# 出图时拿什么当控制图（实测见 README）：
#   outline 轮廓：从深度图提取的人物外轮廓和四肢交叠处的边，没有白模的关节圆圈、分割线，衣服和脸都不受影响
#   line    线稿：白模原图的线稿，动作更准，但关节圆圈和身体分割线容易变成紧身衣上的花纹
# 深度图本身不直接用：强度够让人物摆出姿势时，画出来的就是一个没脸的白模
CONTROL_MODES = {"outline": "轮廓", "line": "线稿"}

# ControlNet：Z-Image Turbo 官方的 Union 控制网（Canny / Depth / Pose / HED / Scribble…），8 步蒸馏版
CONTROLNET = {
    "id": "zimage-controlnet-union",
    "label": "Z-Image Turbo ControlNet Union 2.1",
    "repo": "alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1",
    "file": "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors",
    "size_gb": 6.71,
    "license": "Apache-2.0",
}
CONTROLNET_PATH = ROOT_DIR / "models" / "controlnet" / CONTROLNET["file"]
# 下载的是 fp32 单文件（6.7GB）；第一次加载时转成 bf16 的 diffusers 目录（3.4GB，之后秒开、不用联网），再删掉单文件
CONTROLNET_DIR = ROOT_DIR / "models" / "controlnet" / "Z-Image-Turbo-ControlNet-Union-2.1-2602"


def controlnet_converted() -> bool:
    return (CONTROLNET_DIR / "config.json").is_file() and any(CONTROLNET_DIR.glob("*.safetensors"))


def controlnet_installed() -> bool:
    return controlnet_converted() or CONTROLNET_PATH.is_file()


def convert_controlnet() -> None:
    """fp32 单文件 → bf16 diffusers 目录，成功后删掉单文件。第一次要联网读一个很小的配置文件。

    峰值内存约 10GB，所以下载完就在单独的进程里做（见 main.py），不等到 Z-Image 已经占着 20GB 内存时再做。
    """
    if controlnet_converted():
        return
    import shutil

    import torch
    from diffusers import ZImageControlNetModel

    tmp = CONTROLNET_DIR.with_name(CONTROLNET_DIR.name + ".part")
    shutil.rmtree(tmp, ignore_errors=True)
    model = ZImageControlNetModel.from_single_file(str(CONTROLNET_PATH), torch_dtype=torch.bfloat16)
    model.save_pretrained(str(tmp))
    del model
    shutil.rmtree(CONTROLNET_DIR, ignore_errors=True)
    tmp.rename(CONTROLNET_DIR)
    CONTROLNET_PATH.unlink(missing_ok=True)


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
    if kind == "line":
        return POSE_DIR / "img" / f"{pose_id}.png"
    if kind == "depth":
        return POSE_DIR / "depth" / f"{pose_id}.webp"
    return POSE_DIR / "thumbs" / f"{pose_id}.jpg"


def library() -> dict[str, Any]:
    items, _ = _load()
    have_line = (POSE_DIR / "img").is_dir()
    return {
        "installed": bool(items) and (POSE_DIR / "depth").is_dir(),
        "count": len(items),
        "items": items,
        "has_line": have_line,
        "systems": [s for s in SYSTEMS if any(p["system"] == s for p in items)],
        "angles": ANGLES,
        "modes": CONTROL_MODES,
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


def download_all(full: bool = True, workers: int = 16, on_progress: Any = None) -> tuple[int, list[str]]:
    """下载姿势列表、缩略图、深度图，full=True 时连同白模线稿。已有的文件跳过。返回 (文件数, 失败列表)。"""
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
                tasks.append((f"img/{pid}.png", file_path(pid, "line")))
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


def control_image(pose_id: str, mode: str, width: int, height: int) -> Any:
    """按出图尺寸准备控制图：黑底白线（和 ControlNet 训练用的 HED / Scribble 一致）。

    整个人物都保留，不裁切：比例和姿势图（3:4）不一样时，在两侧或上下补黑边。
    """
    from PIL import Image, ImageOps

    if mode == "outline":
        image = outline_image(pose_id)
    elif mode == "line":
        with Image.open(file_path(pose_id, "line")) as source:
            image = ImageOps.invert(source.convert("RGB"))
    else:
        raise ValueError(f"不支持的控制方式：{mode}")
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
