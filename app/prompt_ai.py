"""用 Claude Opus 5.5 把中文描述改写成适合目标生图模型的提示词。

API Key 在网页「设置 API Key」里填写，保存在项目的 .env（ANTHROPIC_API_KEY），不会写进代码或提交到 GitHub。
"""

from __future__ import annotations

import os
from pathlib import Path

import anthropic
from fastapi import HTTPException
from pydantic import BaseModel

CLAUDE_MODEL = "claude-opus-5-5"
CLAUDE_MODEL_LABEL = "Claude Opus 5.5"
ENV_KEY = "ANTHROPIC_API_KEY"


class OptimizedPrompt(BaseModel):
    prompt: str
    negative_prompt: str
    notes: str


SYSTEM_PROMPT = """You turn a user's Chinese description of an image into a prompt for a local text-to-image model.

Keep everything the user asked for, and add only what makes the picture concrete: subject details, setting, composition, lighting, lens or medium, mood, materials. Don't change the subject, the people's apparent age, or the style the user chose. If the user's style notes conflict with the description, the style notes win.

Do not produce sexual content involving minors or anything illegal; if the description asks for that, write a safe prompt that drops that part and say so in the notes.

Return:
- prompt: the prompt in the format the target model expects (described in the request).
- negative_prompt: what to avoid, in the format the target model expects, or an empty string when the request says the model ignores it.
- notes: one or two short sentences in Simplified Chinese telling the user what you added or changed."""


FAMILY_GUIDE = {
    "zimage": (
        "Z-Image Turbo, a 6B diffusion transformer with a Qwen3 text encoder. It reads natural language well "
        "(English or Chinese) and can render text inside the image. Write one rich English paragraph of about "
        "60-120 words, not a tag list. If the user wants words to appear in the image, keep those exact words in "
        "quotes. The model runs at CFG 0 and ignores negative prompts, so negative_prompt must be an empty string; "
        "put anything to avoid into the prompt as a positive statement (for example 'plain background')."
    ),
    "sdxl": (
        "an SDXL model (1024 px, CLIP text encoders). Write comma-separated English phrases, most important first, "
        "about 30-60 words in total. negative_prompt: a short comma-separated list of common defects to avoid."
    ),
    "sd15": (
        "Stable Diffusion 1.5 (512 px, CLIP encoder truncates after about 75 tokens). Write short comma-separated "
        "English phrases, most important first, under 60 words. negative_prompt: a short comma-separated list of "
        "common defects to avoid."
    ),
}


def _env_path(root: Path) -> Path:
    return root / ".env"


def current_key() -> str:
    return os.environ.get(ENV_KEY, "").strip()


def key_hint(key: str) -> str:
    return f"{key[:7]}…{key[-4:]}" if len(key) > 12 else "已设置"


def settings_view() -> dict[str, object]:
    key = current_key()
    return {"configured": bool(key), "key_hint": key_hint(key) if key else "", "model": CLAUDE_MODEL_LABEL}


def _write_env_value(root: Path, name: str, value: str | None) -> None:
    """在 .env 里设置或删除一个变量，其他行原样保留。"""
    path = _env_path(root)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    kept = [line for line in lines if not line.strip().startswith(f"{name}=")]
    if value:
        kept.append(f"{name}={value}")
    path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")


def save_key(root: Path, api_key: str) -> dict[str, object]:
    api_key = api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="API Key 不能为空。")
    # 用 Models API 校验 Key：不生成内容，不产生 token 费用
    try:
        anthropic.Anthropic(api_key=api_key, timeout=20.0, max_retries=1).models.retrieve(CLAUDE_MODEL)
    except anthropic.AuthenticationError as exc:
        raise HTTPException(status_code=400, detail="这个 API Key 无效，请检查是否复制完整。") from exc
    except anthropic.PermissionDeniedError as exc:
        raise HTTPException(status_code=400, detail=f"这个 Key 没有使用 {CLAUDE_MODEL_LABEL} 的权限。") from exc
    except anthropic.NotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"这个账号暂时用不了 {CLAUDE_MODEL_LABEL}。") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(status_code=502, detail="连不上 Anthropic API，请检查网络或代理。") from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"校验 Key 时出错（{exc.status_code}）：{exc.message}") from exc
    _write_env_value(root, ENV_KEY, api_key)
    os.environ[ENV_KEY] = api_key
    return settings_view()


def delete_key(root: Path) -> dict[str, object]:
    _write_env_value(root, ENV_KEY, None)
    os.environ.pop(ENV_KEY, None)
    return settings_view()


def optimize(text: str, style: str, family: str, model_label: str) -> dict[str, str]:
    key = current_key()
    if not key:
        raise HTTPException(status_code=428, detail="还没有填写 Claude API Key。")

    guide = FAMILY_GUIDE.get(family, FAMILY_GUIDE["sdxl"])
    user_message = (
        f"Target model: {model_label} — {guide}\n\n"
        f"<description>\n{text}\n</description>\n\n"
        f"<style_notes>\n{style or '（无）'}\n</style_notes>"
    )
    client = anthropic.Anthropic(api_key=key, timeout=120.0)
    try:
        # 服务端 fallbacks：万一 Opus 5.5 的安全分类器误拒，自动换模型重试
        response = client.beta.messages.parse(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            output_config={"effort": "medium"},
            output_format=OptimizedPrompt,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as exc:
        raise HTTPException(status_code=428, detail="Claude API Key 无效或已被撤销，请重新设置。") from exc
    except anthropic.PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=f"这个 Key 没有使用 {CLAUDE_MODEL_LABEL} 的权限。") from exc
    except anthropic.RateLimitError as exc:
        raise HTTPException(status_code=429, detail="请求太频繁或额度用完了，稍后再试。") from exc
    except anthropic.BadRequestError as exc:
        raise HTTPException(status_code=400, detail=f"Claude 请求参数错误：{exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(status_code=502, detail="连不上 Anthropic API，请检查网络或代理。") from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Claude 服务出错（{exc.status_code}），稍后再试。") from exc

    if response.stop_reason == "refusal":
        raise HTTPException(status_code=422, detail="Claude 拒绝改写这段描述，换个说法再试。")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise HTTPException(status_code=502, detail="Claude 没有返回完整结果，再试一次。")

    result = response.parsed_output
    prompt = result.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=502, detail="Claude 没有返回提示词，再试一次。")
    return {
        "prompt": prompt,
        "negative_prompt": "" if family == "zimage" else result.negative_prompt.strip(),
        "notes": result.notes.strip(),
        "model": CLAUDE_MODEL_LABEL if response.model == CLAUDE_MODEL else response.model,
    }
