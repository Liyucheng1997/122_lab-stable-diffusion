"""出图助手：用本地 LLM（Gemma 4，见 app/local_llm.py）和用户多轮对话，写提示词并决定出图参数。

全程在本机完成，不联网，也不需要 API Key。对话历史由网页保存，每次请求整段带上来，这里不存状态。
"""

from __future__ import annotations

import base64
import io
import json
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from app.local_llm import llm, mmproj_path, model_label

ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"]
MAX_COUNT = 4
HISTORY_CHAR_BUDGET = 12000  # 历史太长时从最早的几轮开始丢，留出上下文给新一轮
MAX_HISTORY_IMAGES = 2  # 只把最近几张参考图真正发给模型，更早的用一句话代替（每张图要占几百 token）
VISION_MAX_SIDE = 1024  # 发给模型看的图长边压到这么大


class AgentTurn(BaseModel):
    reply: str
    generate: bool
    prompt: str
    negative_prompt: str
    aspect: str
    count: int
    seed: int
    steps: int
    guidance_scale: float
    use_reference: bool
    strength: float
    variants: list[str]


# 用户话里明说的张数（"出一张""来3张"）。前面是"第/这/那…"的不算，那是在指某一张图
_COUNT_WORDS = {"一": 1, "两": 2, "二": 2, "俩": 2, "三": 3, "四": 4, "1": 1, "2": 2, "3": 3, "4": 4}
_COUNT_RE = re.compile(r"(?<![第这那上前后哪每\d])([一两二俩三四1-4])\s*张")


# 没给数字、但明显想要不止一张的说法
_SEVERAL_RE = re.compile(r"几张|多张|多来|多出|几种|几个(版本|方案|角度|构图)|一批|一组|多个(版本|方案|角度)|不同(角度|构图|版本|方案|风格)")


def requested_count(text: str) -> int | None:
    """从用户这句话里读出他要几张：说了数字就是那个数；没说也没表示要多张就是 1；只说"多来几张"返回 None，交给模型定。"""
    own_words = "\n".join(line for line in text.splitlines() if not line.startswith("["))  # 去掉系统记录那几行
    match = _COUNT_RE.search(own_words)
    if match:
        return _COUNT_WORDS[match.group(1)]
    return None if _SEVERAL_RE.search(own_words) else 1


TURN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "generate": {"type": "boolean"},
        "prompt": {"type": "string"},
        "negative_prompt": {"type": "string"},
        "aspect": {"type": "string", "enum": ASPECTS},
        "count": {"type": "integer"},
        "seed": {"type": "integer"},
        "steps": {"type": "integer"},
        "guidance_scale": {"type": "number"},
        "use_reference": {"type": "boolean"},
        "strength": {"type": "number"},
        "variants": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["reply", "generate", "prompt", "negative_prompt", "aspect", "count", "seed", "steps", "guidance_scale", "use_reference", "strength", "variants"],
    "additionalProperties": False,
}


SYSTEM_PROMPT = """你是本地 AI 生图工具里的出图助手。用户用中文和你对话：你负责把他的想法写成提示词，并决定这一轮的出图参数；之后他会反复提修改意见，你在上一版的基础上改。你记得这段对话里之前的每一版。

目标模型：{model_label}
{family_guide}

每一轮输出一个 JSON 对象，字段含义：
- reply：对用户说的话，简体中文，一两句。说清这一版你补了什么、改了什么，或者回答他的问题。不要把提示词全文抄进来，提示词他在界面上看得到。
- generate：这一轮要不要出图。用户在描述画面或提修改意见时为 true。用户只是提问、闲聊，或者需求含糊到不问清楚就没法画时为 false，这时在 reply 里回答或只问一个问题。能合理猜出来的就直接出图，比反问更有用。
- prompt：完整的提示词。每次都给完整版，不是只写改动的部分。generate 为 false 时原样沿用上一版，没有上一版就留空。
- negative_prompt：反向提示词，写法见上面的模型说明。
- aspect：画面比例。用户指定了就按用户的；否则按内容选：人像、全身、手机壁纸用 3:4 或 9:16，风景、建筑、电影感场景用 16:9 或 4:3，头像、单个物品、图标用 1:1。修改上一版时保持比例不变，除非用户要求换。
- count：出几张，1 到 {max_count}。用户说了几张就是几张，一张也不能多。他没说张数时只出 1 张；他说"多来几张""给我几种方案""换一批"这类话但没给数字时出 2 到 3 张。
- variants：count 大于 1 时，给每张图各写一句不一样的补充（15 到 40 字），数量等于 count，让这几张有看得出的区别，例如不同的机位角度、景别、光线或摆放位置；这句话会接在 prompt 后面一起用。count 为 1 时是空数组。同一个 prompt 只换 seed 出的图往往几乎一样，所以多张时一定要写。
- seed：随机种子，-1 表示随机。用户想保留上一张的构图、只改局部（例如"保持不变，只把裙子换成红色"）时，填系统记录里那张图的 seed，画面会尽量保持原样；想换构图、换一批、或者是全新的想法时填 -1。
- steps、guidance_scale：按上面模型说明里的范围选。
- use_reference：出图时要不要把参考图当底图重绘（图生图）。对话里用户没附过图时一律为 false。
- strength：use_reference 为 true 时的重绘幅度，0.3 到 0.9，越小越像原图。幅度太低时画面几乎不会变。只微调细节（表情、光线、质感）用 0.45 到 0.55；换颜色、换衣服、换掉某个物体用 0.6 到 0.7；换画风用 0.7 到 0.8；换背景、换环境、把白底图里的物体放进某个场景用 0.9（低于 0.85 时背景基本还是原来的样子，出不来场景）。用户说"没变化""没有场景感"就调高，说"不像原图了"就调低。use_reference 为 false 时填 0.6。

用户附了参考图时：先仔细看图。图里是商品或某个物体时，把它的外形逐项写进 prompt：整体形状和比例、有几层或几个部件、正面和侧面各有什么（门、盖子、开孔、把手、凸起线条的形状和位置）、材质、透明度和颜色，不要只写一个笼统的名字。把物体放进新场景时，还要把场景写具体：地点、地面和墙面、周围有哪些东西、物体放在哪里、光从哪来。这种改动幅度大，重绘后物体的细节会和原图有出入，在 reply 里如实告诉用户。
参考图有两种用法，用户消息里方括号的"参考图用法"写明了他选的是哪一种，照着做：
- 图生图（默认）：把这张图当底图重绘，use_reference 为 true 并选合适的 strength。prompt 仍然要完整描述改完之后的整个画面（图里看到的主体、姿势、服装、环境、构图、光线、色彩、画风都写进去，再加上用户要的改动），不能只写改动。他没说要改什么时，照原图描述，strength 用 0.6。
- 只提取提示词：只看图写提示词，不用它当底图，use_reference 为 false。同样把图里的内容完整写进 prompt，靠提示词还原画面，aspect 选最接近原图的。
之后的轮次里参考图仍然有效，use_reference 沿用上一轮的值：他说"再像原图一点"就调低 strength，说"变化不够"就调高；只有他明确说"不要参考图了""不用原图"时才把 use_reference 改成 false，他说"用原图""按原图来"时改回 true。

修改规则：用户说改哪里就只改哪里，提示词其余部分一字不动地保留。用户消息开头方括号里的"系统记录"是工具自动写的出图结果（出了几张、各自的 seed），不是用户说的话，用来帮你选 seed。

不要写涉及未成年人的色情内容或其他违法内容；用户要求时，写一个去掉这部分的安全版本，并在 reply 里说明。"""


FAMILY_GUIDE = {
    "zimage": """Z-Image Turbo：6B 的 DiT，文本编码器是 Qwen，中文理解很好。提示词直接用中文写，不要翻译成英文。写法：
- 写成一段连贯的自然语言描述，150 到 300 字，不是关键词堆砌。
- 先锁定用户给的核心元素：主体、数量、动作、状态、指定的颜色和文字。这些不得改动。
- 再补足让画面具体的细节：主体的外观与材质、所处环境、构图与景别、镜头视角、光线、色彩搭配、前后景的空间层次。
- 只写画面里看得见的东西，客观、具体。不用比喻和抒情的句子，不写"8K、杰作、最高画质、大师作品"这类标签。
- 画面里要出现的文字，原文照写并用英文双引号括起来，同时写明它的位置、字体和大小。
- 摄影类写明镜头和光线（例如"85mm 镜头，浅景深，侧逆光"），插画类写明画风和媒介（例如"水彩插画，留白较多"）。
- 这个模型以 CFG 0 运行，不读反向提示词：negative_prompt 必须是空字符串，想排除的东西改成正面描述写进 prompt（例如"纯色背景""画面中没有其他人"）。
- steps 默认 9，可选 8 到 10；guidance_scale 固定为 0。""",
    "sdxl": """SDXL 模型（1024 像素，CLIP 文本编码器，读不懂中文）。提示词必须用英文写：
- 逗号分隔的英文短语，最重要的放最前面，总共 30 到 60 个词。
- negative_prompt：一小串逗号分隔的英文短语，列出要避免的常见缺陷。
- steps 默认 30，可选 20 到 40；guidance_scale 默认 6，可选 4 到 8，数值越高越贴提示词但越生硬。""",
    "sd15": """Stable Diffusion 1.5（512 像素，CLIP 文本编码器，读不懂中文，约 75 个 token 之后的内容会被截掉）。提示词必须用英文写：
- 逗号分隔的英文短语，最重要的放最前面，总共不超过 60 个词。
- negative_prompt：一小串逗号分隔的英文短语，列出要避免的常见缺陷。
- steps 默认 25，可选 20 到 40；guidance_scale 默认 7.5，可选 5 到 10。""",
}

# 每个模型家族允许助手选的范围：(最小步数, 最大步数, 最小 CFG, 最大 CFG)
PARAM_LIMITS = {
    "zimage": (8, 10, 0.0, 0.0),
    "sdxl": (20, 40, 4.0, 8.0),
    "sd15": (20, 40, 5.0, 10.0),
}


def settings_view() -> dict[str, object]:
    return llm.view()


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _image_data_url(path: Path) -> str:
    """把参考图压小、转成 JPEG 的 data URL，发给模型看。"""
    from PIL import Image

    with Image.open(path) as source:
        image = source.convert("RGB")
    image.thumbnail((VISION_MAX_SIDE, VISION_MAX_SIDE), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _attach_images(conversation: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把带参考图的用户消息换成「图 + 文字」的多模态内容。"""
    with_image = [m for m in conversation if m.get("image")]
    recent = {id(m) for m in with_image[-MAX_HISTORY_IMAGES:]}
    result: list[dict[str, Any]] = []
    for message in conversation:
        content: Any = message["content"]
        if message.get("image") and id(message) in recent:
            content = [
                {"type": "image_url", "image_url": {"url": _image_data_url(message["image"])}},
                {"type": "text", "text": content},
            ]
        elif message.get("image") or message.get("image_missing"):
            content = f"[这里用户附过一张参考图，现在不再显示]\n{content}"
        if message.get("image") and message.get("image_mode"):
            usage = "图生图，把这张图当底图重绘" if message["image_mode"] == "ref" else "只提取提示词，不用它当底图"
            note = f"[参考图用法：{usage}]"
            if isinstance(content, list):
                content[-1]["text"] = f"{note}\n{content[-1]['text']}"
            else:
                content = f"{note}\n{content}"
        result.append({"role": message["role"], "content": content})
    return result


def _conversation(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """整理成 user / assistant 严格交替、以 user 开头和结尾的对话，并把过长的历史从头裁掉。"""
    merged: list[dict[str, Any]] = []
    for message in messages:
        content = message["content"].strip()
        image = message.get("image")
        if not content and not image:
            continue
        if merged and merged[-1]["role"] == message["role"]:
            merged[-1]["content"] = (merged[-1]["content"] + "\n\n" + content).strip()
            merged[-1]["image"] = image or merged[-1].get("image")
            merged[-1]["image_mode"] = (image and message.get("image_mode")) or merged[-1].get("image_mode")
            merged[-1]["image_missing"] = message.get("image_missing") or merged[-1].get("image_missing")
        else:
            merged.append({"role": message["role"], "content": content, "image": image, "image_mode": message.get("image_mode"), "image_missing": message.get("image_missing")})
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    if not merged or merged[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="对话要以用户的话结尾。")
    # 一次丢一轮（一问一答），保证开头始终是 user
    while len(merged) > 2 and sum(len(m["content"]) for m in merged) > HISTORY_CHAR_BUDGET:
        del merged[:2]
    return merged


POSE_GUIDE = """
用户在参数面板里选了参考姿势：{pose}。
出图时会用这个姿势的人体轮廓图控制人物的动作、朝向和在画面里的位置（ControlNet），所以：
- prompt 里人物的动作、手脚的位置、身体朝向和镜头视角要和这个姿势一致，把动作具体写出来；人数也要一致（"双人"姿势写两个人）。
- 姿势图是没有脸、没有衣服的白色人体模型，只是动作参考：prompt 里照常写真实的人物外貌、发型、服装、场景和光线，不要写"人体模型""白模"。
- 画面比例跟着姿势图走（竖构图 3:4），aspect 填 3:4。
- count 大于 1 时，variants 只换服装、光线、背景或表情，不要改动作和视角。
- 用户说"不要这个姿势""换个动作"时，在 reply 里提醒他到参数面板的「参考姿势」里移除或换一个。"""


def chat(messages: list[dict[str, Any]], family: str, model_label_target: str, pose: str = "") -> dict[str, Any]:
    family = family if family in FAMILY_GUIDE else "sdxl"
    system = SYSTEM_PROMPT.format(model_label=model_label_target, family_guide=FAMILY_GUIDE[family], max_count=MAX_COUNT)
    if pose and family == "zimage":
        system += "\n" + POSE_GUIDE.format(pose=pose)
    conversation = _conversation(messages)
    has_image = any(m.get("image") for m in conversation)
    if has_image and not mmproj_path():
        raise HTTPException(status_code=503, detail="本地 LLM 没有视觉模块（models/ 里缺 mmproj-*.gguf），看不了参考图。")
    raw = llm.chat_json(system, _attach_images(conversation), TURN_SCHEMA, max_tokens=2000)
    try:
        turn = AgentTurn.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail="助手没有返回完整结果，再发一次试试。") from exc

    use_reference = turn.use_reference
    last = conversation[-1]
    if last.get("image") and last.get("image_mode"):
        # 这句话带着新的参考图：用不用它当底图是用户在界面上选的，不靠模型猜
        use_reference = last["image_mode"] == "ref"

    # 换场景 / 换背景时重绘幅度不能低：实测 0.6 背景还是原图的白底，0.9 才出得来场景
    own_words = "\n".join(line for line in last["content"].splitlines() if not line.startswith("["))
    strength = _clamp(turn.strength, 0.2, 0.95)
    if use_reference and re.search(r"场景|背景|环境|放在|放到|摆在|摆到", own_words):
        strength = max(strength, 0.9)

    # 张数：说了几张就是几张，没说就 1 张，都不靠模型自己定；只有"多来几张"这种才听模型的（至少 2 张）
    count = requested_count(last["content"]) or int(_clamp(turn.count, 2, MAX_COUNT))
    variants = [v.strip() for v in turn.variants if v.strip()][:count] if count > 1 else []

    min_steps, max_steps, min_cfg, max_cfg = PARAM_LIMITS[family]
    prompt = turn.prompt.strip()
    return {
        "reply": turn.reply.strip() or "好的。",
        # 没写出提示词就没法出图
        "generate": turn.generate and bool(prompt),
        "prompt": prompt,
        "negative_prompt": "" if family == "zimage" else turn.negative_prompt.strip(),
        "aspect": turn.aspect if turn.aspect in ASPECTS else "1:1",
        "count": count,
        "variants": variants,
        "seed": turn.seed % 2**32 if turn.seed >= 0 else None,
        "steps": int(_clamp(turn.steps, min_steps, max_steps)),
        "guidance_scale": round(_clamp(turn.guidance_scale, min_cfg, max_cfg), 1),
        # 对话里没有（还在的）参考图时，没法图生图
        "use_reference": use_reference and has_image,
        "strength": round(strength, 2),
        "model": f"{model_label()} · 本地",
    }


def turn_as_history(turn: dict[str, Any]) -> str:
    """把助手上一轮的结果还原成它当时输出的 JSON，放回对话历史。"""
    seed = turn.get("seed")
    return json.dumps(
        {
            "reply": turn.get("reply", ""),
            "generate": bool(turn.get("generate")),
            "prompt": turn.get("prompt", ""),
            "negative_prompt": turn.get("negative_prompt", ""),
            "aspect": turn.get("aspect", "1:1"),
            "count": turn.get("count", 1),
            "seed": -1 if seed is None else seed,
            "steps": turn.get("steps", 9),
            "guidance_scale": turn.get("guidance_scale", 0),
            "use_reference": bool(turn.get("use_reference")),
            "strength": turn.get("strength", 0.6),
            "variants": turn.get("variants") or [],
        },
        ensure_ascii=False,
    )
