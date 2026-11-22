"""用本地 LLM（Gemma 4，见 app/local_llm.py）把中文描述改写成适合目标生图模型的提示词。

全程在本机完成，不联网，也不需要 API Key。
"""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from app.local_llm import llm, model_label


class OptimizedPrompt(BaseModel):
    prompt: str
    negative_prompt: str
    notes: str


SYSTEM_PROMPT = """You turn a user's Chinese description of an image into a prompt for a local text-to-image model.

Keep everything the user asked for, and add only what makes the picture concrete: subject details, setting, composition, lighting, lens or medium, mood, materials. Don't change the subject, the people's apparent age, or the style the user chose. If the user's style notes conflict with the description, the style notes win.

Do not produce sexual content involving minors or anything illegal; if the description asks for that, write a safe prompt that drops that part and say so in the notes.

Reply with a JSON object with exactly these fields:
- prompt: the prompt in the format the target model expects (described in the request). Always in English, except words the user wants rendered inside the image.
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


def settings_view() -> dict[str, object]:
    return llm.view()


def optimize(text: str, style: str, family: str, model_label_target: str) -> dict[str, str]:
    guide = FAMILY_GUIDE.get(family, FAMILY_GUIDE["sdxl"])
    user_message = (
        f"Target model: {model_label_target} — {guide}\n\n"
        f"<description>\n{text}\n</description>\n\n"
        f"<style_notes>\n{style or '（无）'}\n</style_notes>"
    )
    raw = llm.chat_json(SYSTEM_PROMPT, user_message, OptimizedPrompt.model_json_schema())
    try:
        result = OptimizedPrompt.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail="本地 LLM 没有返回完整结果，再试一次。") from exc

    prompt = result.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=502, detail="本地 LLM 没有返回提示词，再试一次。")
    return {
        "prompt": prompt,
        "negative_prompt": "" if family == "zimage" else result.negative_prompt.strip(),
        "notes": result.notes.strip(),
        "model": f"{model_label()} · 本地",
    }
