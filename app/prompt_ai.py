"""出图助手：用本地 LLM（Gemma 4，见 app/local_llm.py）和用户多轮对话，写提示词并决定出图参数。

全程在本机完成，不联网，也不需要 API Key。对话历史由网页保存，每次请求整段带上来，这里不存状态。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from app.local_llm import llm, model_label

ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"]
MAX_COUNT = 4
HISTORY_CHAR_BUDGET = 12000  # 历史太长时从最早的几轮开始丢，留出上下文给新一轮


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
    },
    "required": ["reply", "generate", "prompt", "negative_prompt", "aspect", "count", "seed", "steps", "guidance_scale"],
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
- count：出几张，1 到 {max_count}。用户指定了就按用户的；全新的想法出 2 到 4 张，让他挑构图；只是微调上一版时出 1 到 2 张。
- seed：随机种子，-1 表示随机。用户想保留上一张的构图、只改局部（例如"保持不变，只把裙子换成红色"）时，填系统记录里那张图的 seed，画面会尽量保持原样；想换构图、换一批、或者是全新的想法时填 -1。
- steps、guidance_scale：按上面模型说明里的范围选。

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


def _conversation(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """整理成 user / assistant 严格交替、以 user 开头和结尾的对话，并把过长的历史从头裁掉。"""
    merged: list[dict[str, str]] = []
    for message in messages:
        content = message["content"].strip()
        if not content:
            continue
        if merged and merged[-1]["role"] == message["role"]:
            merged[-1]["content"] += "\n\n" + content
        else:
            merged.append({"role": message["role"], "content": content})
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    if not merged or merged[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="对话要以用户的话结尾。")
    # 一次丢一轮（一问一答），保证开头始终是 user
    while len(merged) > 2 and sum(len(m["content"]) for m in merged) > HISTORY_CHAR_BUDGET:
        del merged[:2]
    return merged


def chat(messages: list[dict[str, str]], family: str, model_label_target: str) -> dict[str, Any]:
    family = family if family in FAMILY_GUIDE else "sdxl"
    system = SYSTEM_PROMPT.format(model_label=model_label_target, family_guide=FAMILY_GUIDE[family], max_count=MAX_COUNT)
    raw = llm.chat_json(system, _conversation(messages), TURN_SCHEMA, max_tokens=2000)
    try:
        turn = AgentTurn.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail="助手没有返回完整结果，再发一次试试。") from exc

    min_steps, max_steps, min_cfg, max_cfg = PARAM_LIMITS[family]
    prompt = turn.prompt.strip()
    return {
        "reply": turn.reply.strip() or "好的。",
        # 没写出提示词就没法出图
        "generate": turn.generate and bool(prompt),
        "prompt": prompt,
        "negative_prompt": "" if family == "zimage" else turn.negative_prompt.strip(),
        "aspect": turn.aspect if turn.aspect in ASPECTS else "1:1",
        "count": int(_clamp(turn.count, 1, MAX_COUNT)),
        "seed": turn.seed % 2**32 if turn.seed >= 0 else None,
        "steps": int(_clamp(turn.steps, min_steps, max_steps)),
        "guidance_scale": round(_clamp(turn.guidance_scale, min_cfg, max_cfg), 1),
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
        },
        ensure_ascii=False,
    )
