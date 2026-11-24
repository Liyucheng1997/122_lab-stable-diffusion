"""内置模型 / LoRA 目录，以及从 Hugging Face 下载它们的后台任务。

LoRA 目录里的条目都已核对过：仓库公开、文件名和大小与 Hugging Face 上一致。
设置环境变量 HF_ENDPOINT（例如 https://hf-mirror.com）即可改用镜像站。
"""

from __future__ import annotations

import fnmatch
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

ROOT_DIR = Path(__file__).resolve().parent.parent
LORA_DIR = ROOT_DIR / "loras"
MODEL_DIR = ROOT_DIR / "models"
PREVIEW_DIR = LORA_DIR / ".previews"
COMPLETE_MARKER = ".aigen_complete"

FAMILY_LABELS = {"sd15": "SD 1.5", "sdxl": "SDXL", "zimage": "Z-Image"}

# ---------------------------------------------------------------------------
# 模型：全部放在项目的 models/ 目录
#   models/Z-Image-Turbo/                     diffusers 目录
#   models/stable-diffusion-xl-base-1.0/
#   models/stable-diffusion-v1-5/
#   models/waiREALCN_v150.safetensors         单文件
# ---------------------------------------------------------------------------

MODELS: list[dict[str, Any]] = [
    {
        "id": "Tongyi-MAI/Z-Image-Turbo",
        "label": "Z-Image Turbo",
        "family": "zimage",
        "badge": "推荐",
        "folder": "Z-Image-Turbo",
        "note": "阿里通义 2025 年发布的 6B 模型，写实人像和光影明显强于 SD 系列；能直接看懂中文提示词，9 步出图。",
        "author": "阿里巴巴通义实验室（Tongyi-MAI）",
        "released": "2025 年 11 月",
        "params": "6B 扩散 Transformer + Qwen3-4B 文本编码器",
        "pros": [
            "写实人像的皮肤、毛发和光影自然，AI 塑料感明显少",
            "直接理解中文提示词，也能在画面里写中文字",
            "蒸馏加速版，9 步就能出 1024 分辨率的图",
        ],
        "cons": [
            "下载约 32.8 GB（权重以 fp32 存储），加载比 SD 慢",
            "16GB 显存要靠 CPU offload 运行，单张比 SD 1.5 慢",
            "不支持反向提示词，LoRA 生态还在成长",
        ],
        "best_for": "写实人像、产品摄影、带中文字的海报",
        "settings": "1024 × 1024 左右 · 9 步 · CFG 0",
        "size_gb": 32.8,
        "downloadable": True,
        "allow_patterns": [
            "model_index.json",
            "scheduler/*",
            "text_encoder/*",
            "tokenizer/*",
            "transformer/*",
            "vae/*",
        ],
        "license": "Apache-2.0（可商用）",
    },
    {
        "id": "models/waiREALCN_v150.safetensors",
        "label": "WAI-REAL_CN v15",
        "family": "sdxl",
        "badge": "本地",
        "note": "基于 SDXL 的写实微调模型，偏亚洲人像。",
        "author": "Civitai 社区作者",
        "released": "",
        "params": "SDXL 架构（约 3.5B）单文件",
        "pros": [
            "比 SDXL 底模更写实，亚洲面孔表现好",
            "能用所有 SDXL LoRA",
        ],
        "cons": [
            "SDXL 的老问题还在：手指、文字容易出错",
            "需要写较长的英文提示词调教",
            "这里不能重新下载，删除前请确认有备份",
        ],
        "best_for": "亚洲人像写真",
        "settings": "1024 × 1024 · 30 步 · CFG 5～6",
        "local": True,
        "license": "见 Civitai 原页面",
    },
    {
        "id": "stabilityai/stable-diffusion-xl-base-1.0",
        "label": "Stable Diffusion XL 1.0",
        "family": "sdxl",
        "folder": "stable-diffusion-xl-base-1.0",
        "note": "2023 年的 SDXL 底模，通用但写实一般，主要用来配合 SDXL LoRA。",
        "author": "Stability AI",
        "released": "2023 年 7 月",
        "params": "约 3.5B（UNet 2.6B + 两个文本编码器）",
        "pros": [
            "LoRA 和社区资源最多，风格化效果稳定",
            "1024 分辨率，构图比 SD 1.5 好很多",
        ],
        "cons": [
            "底模本身写实一般，人像偏“AI 味”",
            "手指、文字经常出错",
        ],
        "best_for": "配合 SDXL LoRA 做插画、像素、3D 等风格图",
        "settings": "1024 × 1024 · 30 步 · CFG 5～7",
        "size_gb": 6.9,
        "downloadable": True,
        "allow_patterns": [
            "model_index.json",
            "scheduler/*",
            "text_encoder/config.json",
            "text_encoder/model.fp16.safetensors",
            "text_encoder_2/config.json",
            "text_encoder_2/model.fp16.safetensors",
            "tokenizer/*",
            "tokenizer_2/*",
            "unet/config.json",
            "unet/diffusion_pytorch_model.fp16.safetensors",
            "vae/config.json",
            "vae/diffusion_pytorch_model.fp16.safetensors",
        ],
        "license": "CreativeML Open RAIL++-M",
    },
    {
        "id": "stable-diffusion-v1-5/stable-diffusion-v1-5",
        "label": "Stable Diffusion 1.5",
        "family": "sd15",
        "badge": "较旧",
        "folder": "stable-diffusion-v1-5",
        "note": "2022 年的老模型，512 分辨率，手和脸容易崩，写实效果明显过时。",
        "author": "Runway / Stability AI",
        "released": "2022 年 10 月",
        "params": "约 1B（UNet 0.86B）",
        "pros": [
            "快，显存占用小（4GB 就能跑）",
            "老 LoRA 最多",
        ],
        "cons": [
            "原生只有 512 分辨率，细节少",
            "写实人像很假，手和脸经常崩",
        ],
        "best_for": "快速试构图、用老的 SD 1.5 LoRA",
        "settings": "512 × 512 · 25 步 · CFG 7.5",
        "size_gb": 2.6,
        "downloadable": True,
        "allow_patterns": [
            "model_index.json",
            "feature_extractor/*",
            "safety_checker/config.json",
            "safety_checker/model.fp16.safetensors",
            "scheduler/*",
            "text_encoder/config.json",
            "text_encoder/model.fp16.safetensors",
            "tokenizer/*",
            "unet/config.json",
            "unet/diffusion_pytorch_model.fp16.safetensors",
            "vae/config.json",
            "vae/diffusion_pytorch_model.fp16.safetensors",
        ],
        "license": "CreativeML Open RAIL-M",
    },
]

FAMILY_DEFAULTS = {
    "sd15": {"steps": 25, "guidance_scale": 7.5},
    "sdxl": {"steps": 30, "guidance_scale": 6.0},
    "zimage": {"steps": 9, "guidance_scale": 0.0},
}

# ---------------------------------------------------------------------------
# LoRA
# ---------------------------------------------------------------------------

LORA_CATALOG: list[dict[str, Any]] = [
    # ---- Z-Image Turbo ----
    {
        "id": "zit-awportrait",
        "name": "AWPortrait-Z 人像增强",
        "family": "zimage",
        "repo": "Shakker-Labs/AWPortrait-Z",
        "file": "AWPortrait-Z.safetensors",
        "size_mb": 680.3,
        "license": "Apache-2.0",
        "trigger": "",
        "weight": 0.8,
        "tags": ["人像", "写实"],
        "desc": "Shakker Labs 出品的人像 LoRA：改善皮肤纹理、光影和五官细节，减少“塑料皮肤”的 AI 感。",
        "preview": "images/cover.png",
    },
    {
        "id": "zit-realism",
        "name": "Realism 写实摄影",
        "family": "zimage",
        "repo": "suayptalha/Z-Image-Turbo-Realism-LoRA",
        "file": "pytorch_lora_weights.safetensors",
        "size_mb": 85.1,
        "license": "Apache-2.0",
        "trigger": "Realism",
        "weight": 0.8,
        "tags": ["写实", "摄影"],
        "desc": "让画面更像真实相机拍摄：自然的光线、色彩和景深。",
        "preview": "images/H5bKsoLB0XN94M3DSehKA.png",
    },
    {
        "id": "zit-lenovo-ultrareal",
        "name": "UltraReal 随手拍质感",
        "family": "zimage",
        "repo": "Danrisi/Lenovo_UltraReal_Z_Image",
        "file": "lenovo_z.safetensors",
        "size_mb": 85.1,
        "license": "Apache-2.0",
        "trigger": "",
        "weight": 0.8,
        "tags": ["写实", "生活照"],
        "desc": "模仿手机随手拍的生活照质感，弱化过度精致的棚拍感，适合“看起来像真照片”的场景。",
        "preview": "",
    },
    {
        "id": "zit-dejpeg",
        "name": "DeJPEG 细节清晰",
        "family": "zimage",
        "repo": "wcde/Z-Image-Turbo-DeJPEG-Lora",
        "file": "dejpeg_detailed.safetensors",
        "size_mb": 170.1,
        "license": "未注明",
        "trigger": "",
        "weight": 0.6,
        "tags": ["画质", "细节"],
        "desc": "去掉压缩感和涂抹感，补充细节，让画面更清晰锐利。",
        "preview": "",
    },
    {
        "id": "zit-technically-color",
        "name": "特艺彩色复古电影",
        "family": "zimage",
        "repo": "renderartist/Technically-Color-Z-Image-Turbo",
        "file": "Technically_Color_Z_Image_Turbo_v1_renderartist_2000.safetensors",
        "size_mb": 255.2,
        "license": "Apache-2.0",
        "trigger": "t3chnic4lly",
        "weight": 0.9,
        "tags": ["电影", "复古"],
        "desc": "上世纪 50 年代特艺彩色（Technicolor）电影的浓郁饱和色彩与胶片质感。",
        "preview": "",
    },
    {
        "id": "zit-classic-painting",
        "name": "古典油画",
        "family": "zimage",
        "repo": "renderartist/Classic-Painting-Z-Image-Turbo-LoRA",
        "file": "Classic_Painting_Z_Image_Turbo_v1_renderartist_1750.safetensors",
        "size_mb": 170.1,
        "license": "Apache-2.0",
        "trigger": "",
        "weight": 0.9,
        "tags": ["油画", "艺术"],
        "desc": "博物馆藏画质感的古典油画，厚涂笔触、柔和明暗。",
        "preview": "",
    },
    {
        "id": "zit-pixel-art",
        "name": "像素画",
        "family": "zimage",
        "repo": "tarn59/pixel_art_style_lora_z_image_turbo",
        "file": "pixel_art_style_z_image_turbo.safetensors",
        "size_mb": 170.1,
        "license": "Apache-2.0",
        "trigger": "Pixel art style.",
        "weight": 1.0,
        "tags": ["像素", "游戏"],
        "desc": "复古像素游戏画风，适合角色、场景和图标。",
        "preview": "images/ComfyUI_00273_.png",
    },
    {
        "id": "zit-saturday-morning",
        "name": "周六早晨卡通",
        "family": "zimage",
        "repo": "renderartist/Saturday-Morning-Z-Image-Turbo",
        "file": "Saturday_Morning_Z_Image_Turbo_v1_renderartist_1500.safetensors",
        "size_mb": 74.5,
        "license": "Apache-2.0",
        "trigger": "saturd4ym0rning",
        "weight": 0.9,
        "tags": ["卡通", "插画"],
        "desc": "美式周六早晨动画片风格：粗线条、明快配色。",
        "preview": "images/Saturday_Morning_Z_05.png",
    },
    {
        "id": "zit-mmorpg-3d",
        "name": "3D 网游 CG",
        "family": "zimage",
        "repo": "DK9/3D_MMORPG_style_z-image-turbo_lora",
        "file": "lostark_v1.safetensors",
        "size_mb": 170.1,
        "license": "Apache-2.0",
        "trigger": "",
        "weight": 0.9,
        "tags": ["3D", "游戏"],
        "desc": "大型 3D 网游宣传 CG 的角色与场景风格。",
        "preview": "images/01_with_lora.png",
    },
    {
        "id": "zit-coloring-book",
        "name": "填色本线稿",
        "family": "zimage",
        "repo": "renderartist/Coloring-Book-Z-Image-Turbo-LoRA",
        "file": "Coloring_Book_Z_Image_Turbo_v1_renderartist_2000.safetensors",
        "size_mb": 31.9,
        "license": "Apache-2.0",
        "trigger": "c0l0ringb00k",
        "weight": 0.9,
        "tags": ["线稿", "黑白"],
        "desc": "干净的黑白填色本线稿，适合打印给孩子涂色。",
        "preview": "images/CBZ_00247_.png",
    },
    {
        "id": "zit-childrens-drawings",
        "name": "儿童蜡笔画",
        "family": "zimage",
        "repo": "ostris/z_image_turbo_childrens_drawings",
        "file": "z_image_turbo_childrens_drawings.safetensors",
        "size_mb": 170.1,
        "license": "Apache-2.0",
        "trigger": "",
        "weight": 1.0,
        "tags": ["童趣", "手绘"],
        "desc": "像小朋友用蜡笔画出来的稚拙画风。",
        "preview": "images/1764433587842__000003000_1.jpg",
    },
    {
        "id": "zit-pornmaster",
        "name": "Pornmaster 成人内容",
        "family": "zimage",
        "repo": "RomixERR/Pornmaster_v1-Z-Images-Turbo",
        "file": "Pornmaster_v1_000044700.safetensors",
        "size_mb": 340.2,
        "license": "Apache-2.0",
        "trigger": "pronmstr",
        "weight": 0.8,
        "tags": ["成人", "NSFW"],
        "desc": "解锁 Z-Image 的成人（NSFW）内容。作者标注为测试版，效果不太稳定；建议强度 0.7～0.85，效果不够时把步数加到 16 左右。仅用于虚构的成年人。",
        "preview": "",  # 不显示预览图，避免在 LoRA 库里出现成人图片
    },
    # ---- SDXL（也适用于 WAI-REAL_CN 等 SDXL 微调模型）----
    {
        "id": "sdxl-pixel-art",
        "name": "Pixel Art XL 像素画",
        "family": "sdxl",
        "repo": "nerijs/pixel-art-xl",
        "file": "pixel-art-xl.safetensors",
        "size_mb": 170.5,
        "license": "OpenRAIL-M",
        "trigger": "pixel art",
        "weight": 1.0,
        "tags": ["像素", "游戏"],
        "desc": "SDXL 上最知名的像素画 LoRA 之一。",
        "preview": "",
    },
    {
        "id": "sdxl-little-tinies",
        "name": "Little Tinies 手绘童书",
        "family": "sdxl",
        "repo": "alvdansen/littletinies",
        "file": "Little_Tinies.safetensors",
        "size_mb": 228.5,
        "license": "OpenRAIL-M",
        "trigger": "",
        "weight": 0.9,
        "tags": ["插画", "童书"],
        "desc": "柔和的手绘小清新插画，像童书里的配图。",
        "preview": "images/227DE29148BC8798591C0EF99A41B71C44C0CAB5A16B976EFCC387C08D748DC0.jpeg",
    },
    {
        "id": "sdxl-3d-render",
        "name": "3D 渲染卡通",
        "family": "sdxl",
        "repo": "goofyai/3d_render_style_xl",
        "file": "3d_render_style_xl.safetensors",
        "size_mb": 85.5,
        "license": "Apache-2.0",
        "trigger": "3d style, 3d render",
        "weight": 0.9,
        "tags": ["3D", "卡通"],
        "desc": "皮克斯式的 3D 卡通渲染风格。",
        "preview": "3d_style_1.jpeg",
    },
    {
        "id": "sdxl-papercut",
        "name": "Papercut 剪纸",
        "family": "sdxl",
        "repo": "TheLastBen/Papercut_SDXL",
        "file": "papercut.safetensors",
        "size_mb": 340.8,
        "license": "OpenRAIL-M",
        "trigger": "papercut",
        "weight": 1.0,
        "tags": ["剪纸", "艺术"],
        "desc": "层叠纸艺 / 剪纸立体风格。",
        "preview": "images/pc (1).webp",
    },
    {
        "id": "sdxl-bw-manga",
        "name": "黑白漫画",
        "family": "sdxl",
        "repo": "alvdansen/BandW-Manga",
        "file": "BW-000014.safetensors",
        "size_mb": 228.5,
        "license": "OpenRAIL-M",
        "trigger": "",
        "weight": 0.9,
        "tags": ["漫画", "黑白"],
        "desc": "日式黑白漫画线稿风格。",
        "preview": "images/BW_e000014_00_20240610214140.jpeg",
    },
    {
        "id": "sdxl-ikea",
        "name": "宜家说明书",
        "family": "sdxl",
        "repo": "ostris/ikea-instructions-lora-sdxl",
        "file": "ikea_instructions_xl_v1_5.safetensors",
        "size_mb": 185.7,
        "license": "其他（见仓库）",
        "trigger": "",
        "weight": 1.0,
        "tags": ["趣味", "线稿"],
        "desc": "把任何东西画成宜家组装说明书的样子，很有梗。",
        "preview": "2709929.jpeg",
    },
    {
        "id": "sdxl-stickers",
        "name": "贴纸",
        "family": "sdxl",
        "repo": "artificialguybr/StickersRedmond",
        "file": "StickersRedmond.safetensors",
        "size_mb": 170.5,
        "license": "OpenRAIL-M",
        "trigger": "Stickers, sticker",
        "weight": 1.0,
        "tags": ["贴纸", "设计"],
        "desc": "带白边的模切贴纸风格，适合做表情包和周边。",
        "preview": "00000-3383490575.png",
    },
    {
        "id": "sdxl-logo",
        "name": "Logo 设计",
        "family": "sdxl",
        "repo": "artificialguybr/LogoRedmond-LogoLoraForSDXL-V2",
        "file": "LogoRedmondV2-Logo-LogoRedmAF.safetensors",
        "size_mb": 170.5,
        "license": "OpenRAIL-M",
        "trigger": "LogoRedmAF, Icons",
        "weight": 1.0,
        "tags": ["Logo", "设计"],
        "desc": "简洁的 Logo / 图标设计。",
        "preview": "00140-237225586.png",
    },
    {
        "id": "sdxl-storyboard",
        "name": "电影分镜草图",
        "family": "sdxl",
        "repo": "blink7630/storyboard-sketch",
        "file": "Storyboard_sketch.safetensors",
        "size_mb": 228.5,
        "license": "其他（见仓库）",
        "trigger": "storyboard sketch of",
        "weight": 1.0,
        "tags": ["分镜", "草图"],
        "desc": "影视分镜的铅笔草图风格。",
        "preview": "2947991.jpeg",
    },
    # ---- SD 1.5 ----
    {
        "id": "sd15-pixel-art",
        "name": "Pixel Art Redmond 像素画",
        "family": "sd15",
        "repo": "artificialguybr/pixelartredmond-1-5v-pixel-art-loras-for-sd-1-5",
        "file": "PixelArtRedmond15V-PixelArt-PIXARFK.safetensors",
        "size_mb": 27.2,
        "license": "其他（见仓库）",
        "trigger": "Pixel Art, PIXARFK",
        "weight": 1.0,
        "tags": ["像素", "游戏"],
        "desc": "SD 1.5 上的像素画风格。",
        "preview": "3758809.jpeg",
    },
    {
        "id": "sd15-architecture",
        "name": "建筑空间设计",
        "family": "sd15",
        "repo": "jnluca/stable-diffusion-v1-5-architecture-lora",
        "file": "pytorch_lora_weights.safetensors",
        "local_name": "style_architecture_sd15.safetensors",
        "size_mb": 3.2,
        "license": "OpenRAIL-M",
        "trigger": "",
        "weight": 0.7,
        "tags": ["建筑", "室内"],
        "desc": "建筑外观、室内空间和结构设计。提示词可以写 architectural design, interior design, clean geometry。",
        "preview": "",
    },
    {
        "id": "sd15-anime-character",
        "name": "动漫角色",
        "family": "sd15",
        "repo": "osmr/stable-diffusion-v1-5-lora-animegirls",
        "file": "pytorch_lora_weights.safetensors",
        "local_name": "style_anime_character_sd15.safetensors",
        "size_mb": 12.8,
        "license": "MIT",
        "trigger": "",
        "weight": 0.7,
        "tags": ["动漫", "角色"],
        "desc": "日系动漫角色立绘，线条干净、眼睛细致。",
        "preview": "images/generated_image1.png",
    },
    {
        "id": "sd15-car-design",
        "name": "汽车工业设计",
        "family": "sd15",
        "repo": "mingyu-oo/stable-diffusion-v1-5-lora-hyundai-car-design",
        "file": "pytorch_lora_weights.safetensors",
        "local_name": "style_car_design_sd15.safetensors",
        "size_mb": 3.2,
        "license": "OpenRAIL-M",
        "trigger": "",
        "weight": 0.7,
        "tags": ["汽车", "工业设计"],
        "desc": "概念车与汽车外观设计渲染。提示词可以写 car design, concept vehicle, studio lighting。",
        "preview": "",
    },
]

# 本地已有、但不在目录里的 LoRA（删除后无法从这里重新下载）
LOCAL_LORA_INFO = {
    "pytorch_lora_weights.safetensors": {"name": "自定义 LoRA", "desc": "来源未记录的 SD 1.5 LoRA。"},
    "style_anime_landscape_sd15.safetensors": {"name": "动漫风景", "desc": "动画电影式的风景和天空。"},
    "style_impressionism_monet_sd15.safetensors": {"name": "莫奈印象派", "desc": "莫奈式的印象派笔触和光色。"},
    "style_pencil_sketch_sd15.safetensors": {"name": "铅笔素描", "desc": "黑白铅笔素描。"},
    "style_realistic_photo_sd15.safetensors": {"name": "写实摄影增强", "desc": "让 SD 1.5 的画面更接近照片。"},
}

CATALOG_BY_ID = {item["id"]: item for item in LORA_CATALOG}


def hf_endpoint() -> str:
    return os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")


def hf_file_url(repo: str, filename: str) -> str:
    return f"{hf_endpoint()}/{repo}/resolve/main/{quote(filename)}"


def lora_target(item: dict[str, Any]) -> Path:
    if item.get("local_name"):
        return LORA_DIR / item["family"] / item["local_name"]
    suffix = Path(item["file"]).suffix or ".safetensors"
    return LORA_DIR / item["family"] / f"{item['id']}{suffix}"


def lora_relpath(item: dict[str, Any]) -> str:
    return lora_target(item).relative_to(ROOT_DIR).as_posix()


def catalog_by_relpath() -> dict[str, dict[str, Any]]:
    return {lora_relpath(item): item for item in LORA_CATALOG}


def model_path(model: dict[str, Any]) -> Path:
    if model.get("local"):
        return ROOT_DIR / model["id"]
    return MODEL_DIR / model["folder"]


def model_relpath(model: dict[str, Any]) -> str:
    return model_path(model).relative_to(ROOT_DIR).as_posix()


def model_installed(model: dict[str, Any]) -> bool:
    path = model_path(model)
    if model.get("local"):
        return path.exists()
    return (path / COMPLETE_MARKER).exists() and (path / "model_index.json").exists()


def model_disk_bytes(model: dict[str, Any]) -> int:
    path = model_path(model)
    if path.is_file():
        return path.stat().st_size
    return _dir_size(path)


def delete_model_files(model: dict[str, Any]) -> bool:
    path = model_path(model)
    if path.is_file():
        path.unlink()
        return True
    if path.is_dir():
        shutil.rmtree(path)
        return True
    return False


def detect_lora_family(path: Path) -> str | None:
    """读 safetensors 头，用注意力层的输入维度判断 LoRA 属于哪类模型。"""
    if path.suffix.lower() != ".safetensors":
        return None
    try:
        import json
        import struct

        with open(path, "rb") as handle:
            size = struct.unpack("<Q", handle.read(8))[0]
            if size > 50_000_000:
                return None
            header = json.loads(handle.read(size))
    except (OSError, ValueError, struct.error):
        return None
    dims: set[int] = set()
    dit = False
    for key, value in header.items():
        if key == "__metadata__" or not isinstance(value, dict):
            continue
        if "layers." in key and ("attention" in key or "feed_forward" in key):
            dit = True
        shape = value.get("shape") or []
        if len(shape) == 2 and ("to_k" in key or "attn2" in key) and ("down" in key or "lora_A" in key):
            dims.add(shape[1])
    if 2048 in dims:
        return "sdxl"
    if 768 in dims:
        return "sd15"
    if dit:
        return "zimage"
    return None


def storage_summary() -> dict[str, float]:
    return {
        "models_gb": round(_dir_size(MODEL_DIR) / 1e9, 1),
        "loras_gb": round(sum(f.stat().st_size for f in LORA_DIR.rglob("*.safetensors")) / 1e9, 2),
        "disk_free_gb": disk_free_gb(),
    }


def model_by_id(model_id: str) -> dict[str, Any] | None:
    return next((m for m in MODELS if m["id"] == model_id), None)


def family_of_model(model_id: str) -> str:
    preset = model_by_id(model_id)
    if preset:
        return preset["family"]
    lowered = model_id.lower()
    if "z-image" in lowered or "zimage" in lowered:
        return "zimage"
    if "xl" in lowered:
        return "sdxl"
    return "sd15"


# ---------------------------------------------------------------------------
# 下载任务
# ---------------------------------------------------------------------------


class DownloadManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.jobs: dict[str, dict[str, Any]] = {}

    def snapshot(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            result = {key: dict(job) for key, job in self.jobs.items()}
        for key, job in result.items():
            if job["status"] == "downloading" and job.get("kind") == "model":
                model = model_by_id(key)
                job["downloaded"] = _dir_size(model_path(model)) if model else 0
        return result

    def _start(self, key: str, job: dict[str, Any], target: Any) -> dict[str, Any]:
        with self._lock:
            current = self.jobs.get(key)
            if current and current["status"] == "downloading":
                return dict(current)
            self.jobs[key] = {"status": "downloading", "downloaded": 0, "total": 0, "error": "", "started": time.time(), **job}
        threading.Thread(target=target, daemon=True).start()
        return dict(self.jobs[key])

    def _update(self, key: str, **fields: Any) -> None:
        with self._lock:
            if key in self.jobs:
                self.jobs[key].update(fields)

    # ---- LoRA：单文件，自己流式下载以便显示进度 ----
    def start_lora(self, item: dict[str, Any]) -> dict[str, Any]:
        return self.start_file(item["id"], hf_file_url(item["repo"], item["file"]), lora_target(item), kind="lora")

    def start_file(self, key: str, url: str, target: Path, kind: str = "file", after: Any = None) -> dict[str, Any]:
        """下载单个文件；after 是下载完以后要做的事（例如格式转换），做完才算完成。"""
        return self._start(key, {"kind": kind}, lambda: self._download_file(key, url, target, after))

    def _download_file(self, key: str, url: str, target: Path, after: Any = None) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        try:
            with httpx.stream("GET", url, follow_redirects=True, timeout=60) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length") or 0)
                self._update(key, total=total)
                done = 0
                with open(partial, "wb") as handle:
                    for chunk in response.iter_bytes(1024 * 256):
                        handle.write(chunk)
                        done += len(chunk)
                        self._update(key, downloaded=done)
            if total and done != total:
                raise IOError(f"下载不完整：{done} / {total} 字节")
            os.replace(partial, target)
            if after:
                self._update(key, status="converting")
                after()
            self._update(key, status="done", downloaded=done)
        except Exception as exc:  # noqa: BLE001 - 把任何失败原因都告诉前端
            partial.unlink(missing_ok=True)
            self._update(key, status="error", error=_friendly_error(exc))

    # ---- 模型：整个 diffusers 仓库，用 huggingface_hub 下载 ----
    def start_model(self, model: dict[str, Any]) -> dict[str, Any]:
        key = model["id"]
        return self._start(key, {"kind": "model", "total": int(model.get("size_gb", 0) * 1e9)}, lambda: self._download_model(model))

    def _download_model(self, model: dict[str, Any]) -> None:
        from huggingface_hub import HfApi, snapshot_download

        key = model["id"]
        patterns = model.get("allow_patterns")
        target = model_path(model)
        try:
            try:
                info = HfApi().model_info(key, files_metadata=True)
                total = sum(
                    s.size or 0
                    for s in info.siblings
                    if not patterns or any(fnmatch.fnmatch(s.rfilename, p) for p in patterns)
                )
                if total:
                    self._update(key, total=total)
            except Exception:  # noqa: BLE001 - 拿不到大小就用预估值
                pass
            target.mkdir(parents=True, exist_ok=True)
            # 直接下载到 models/<文件夹>，不经过全局 Hugging Face 缓存
            snapshot_download(key, allow_patterns=patterns, local_dir=str(target))
            shutil.rmtree(target / ".cache", ignore_errors=True)
            (target / COMPLETE_MARKER).write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
            self._update(key, status="done", downloaded=_dir_size(target))
        except Exception as exc:  # noqa: BLE001
            self._update(key, status="error", error=_friendly_error(exc))


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def _friendly_error(exc: Exception) -> str:
    text = str(exc) or type(exc).__name__
    if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)) or "ConnectTimeout" in text or "ConnectError" in text:
        return "连不上 Hugging Face。可以在 .env 里设置 HF_ENDPOINT=https://hf-mirror.com 改用镜像后重启服务。"
    if isinstance(exc, OSError) and getattr(exc, "errno", None) == 28:
        return "磁盘空间不足。"
    return text[:300]


def ensure_preview(item: dict[str, Any]) -> Path | None:
    """把预览图缓存到 loras/.previews，之后离线也能看。"""
    if not item.get("preview"):
        return None
    suffix = Path(item["preview"]).suffix.lower() or ".png"
    cached = PREVIEW_DIR / f"{item['id']}{suffix}"
    if cached.exists():
        return cached
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    response = httpx.get(hf_file_url(item["repo"], item["preview"]), follow_redirects=True, timeout=30)
    response.raise_for_status()
    tmp = cached.with_suffix(cached.suffix + ".part")
    tmp.write_bytes(response.content)
    os.replace(tmp, cached)
    return cached


def disk_free_gb() -> float:
    return round(shutil.disk_usage(ROOT_DIR).free / 1e9, 1)


downloads = DownloadManager()
