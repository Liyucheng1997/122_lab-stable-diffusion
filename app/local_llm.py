"""托管本地 LLM（llama.cpp 的 llama-server），给「中文优化」用。

模型和运行库放在另一个项目里（默认是隔壁的 459_无审查LLM），这里只负责启动、停止和调用：
- 网页服务启动时顺带把它拉起来；
- 出图前由 main.py 调 stop() 结束进程，8GB 显存立刻整块还给生图模型；
- 下次点「转写」时再启动（权重还在系统文件缓存里，几秒就好）。

16GB 显存放不下 Gemma（约 8.5GB）和生图模型同时计算，一旦超出，Windows 会把显存溢出到共享内存，
速度掉一个数量级。所以两边始终只让一个待在显卡上。
"""

from __future__ import annotations

import atexit
import os
import subprocess
import time
from pathlib import Path
from threading import RLock
from typing import Any

import httpx
from fastapi import HTTPException

ROOT_DIR = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT_DIR / "logs"
PID_FILE = LOG_DIR / "llama-server.pid"
SERVER_EXE = "llama-server.exe"


def _llm_dir() -> Path:
    raw = os.environ.get("LOCAL_LLM_DIR", "").strip().strip('"')
    return Path(raw) if raw else ROOT_DIR.parent / "459_无审查LLM"


def _port() -> int:
    return int(os.environ.get("LOCAL_LLM_PORT", "8090"))


def _ctx() -> int:
    # 要装下系统提示词和多轮对话历史（历史过长时 prompt_ai 会从头裁掉）
    return int(os.environ.get("LOCAL_LLM_CTX", "16384"))


def autostart_enabled() -> bool:
    return os.environ.get("LOCAL_LLM_AUTOSTART", "1").strip().lower() not in ("0", "false", "no", "off")


def _server_path() -> Path:
    return _llm_dir() / "llama.cpp" / SERVER_EXE


def model_path() -> Path | None:
    """LOCAL_LLM_MODEL 指定的文件；没指定就用 models/ 里第一个不是视觉模块（mmproj）的 gguf。"""
    raw = os.environ.get("LOCAL_LLM_MODEL", "").strip().strip('"')
    if raw:
        path = Path(raw)
        if not path.is_absolute():
            path = _llm_dir() / path
        return path if path.is_file() else None
    models = sorted(p for p in (_llm_dir() / "models").glob("*.gguf") if not p.name.lower().startswith("mmproj"))
    return models[0] if models else None


def model_label() -> str:
    path = model_path()
    if not path:
        return "本地模型"
    # Gemma-4-E4B-Uncensored-…-Q8_K_P → Gemma 4 E4B
    return path.stem.split("-Uncensored")[0].replace("-", " ").strip() or path.stem


def _missing_reason() -> str:
    if not _server_path().is_file():
        return f"找不到 {_server_path()}。请检查 .env 里的 LOCAL_LLM_DIR。"
    if not model_path():
        return f"{_llm_dir() / 'models'} 里没有 gguf 模型文件。"
    return ""


class LocalLLM:
    def __init__(self) -> None:
        self._proc: subprocess.Popen[bytes] | None = None
        self._log: Any = None
        self._ready = False
        self._lock = RLock()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{_port()}"

    def alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    # ---------------- 进程管理 ----------------
    def _kill_stale(self) -> None:
        """网页服务上次被强行结束时，llama-server 可能还留着占显存；按记下的 pid 清掉。"""
        try:
            pid = int(PID_FILE.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            return
        try:
            import psutil

            proc = psutil.Process(pid)
            if proc.name().lower() == SERVER_EXE:
                proc.kill()
                proc.wait(5)
        except Exception:  # noqa: BLE001 - 进程早就不在了，或者没装 psutil
            pass
        PID_FILE.unlink(missing_ok=True)

    def start(self) -> None:
        """启动 llama-server（不等它加载完）。已经在跑就什么都不做。"""
        with self._lock:
            if self.alive():
                return
            reason = _missing_reason()
            if reason:
                raise HTTPException(status_code=503, detail=f"本地 LLM 不可用：{reason}")
            self._cleanup()
            self._kill_stale()
            LOG_DIR.mkdir(exist_ok=True)
            self._log = open(LOG_DIR / "llama-server.log", "wb")
            command = [
                str(_server_path()),
                "-m", str(model_path()),
                "--jinja", "-ngl", "99", "-fa", "on",
                "-c", str(_ctx()), "-np", "1",
                "--host", "127.0.0.1", "--port", str(_port()),
            ]
            self._proc = subprocess.Popen(
                command,
                cwd=str(_llm_dir()),
                stdout=self._log,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            self._ready = False
            PID_FILE.write_text(str(self._proc.pid), encoding="utf-8")

    def _cleanup(self) -> None:
        if self._log is not None:
            self._log.close()
            self._log = None
        self._proc = None
        self._ready = False

    def stop(self) -> bool:
        """结束 llama-server，显存由系统整块收回。返回之前是否在运行。"""
        with self._lock:
            proc = self._proc
            was_running = self.alive()
            if proc is not None and was_running:
                proc.kill()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    pass
            self._cleanup()
            PID_FILE.unlink(missing_ok=True)
            return was_running

    def _healthy(self, timeout: float) -> bool:
        try:
            return httpx.get(f"{self.base_url}/health", timeout=timeout).status_code == 200
        except httpx.HTTPError:
            return False

    def ensure_ready(self, timeout: float = 180.0) -> None:
        """保证模型已经加载好、可以接请求。"""
        self.start()
        if self._ready and self.alive():
            return
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not self.alive():
                code = self._proc.returncode if self._proc else None
                self.stop()
                raise HTTPException(status_code=503, detail=f"本地 LLM 启动失败（退出码 {code}），详情见 logs/llama-server.log。")
            if self._healthy(2.0):
                self._ready = True
                return
            time.sleep(0.3)
        self.stop()
        raise HTTPException(status_code=504, detail="本地 LLM 加载超时，详情见 logs/llama-server.log。")

    # ---------------- 状态与调用 ----------------
    def view(self) -> dict[str, Any]:
        reason = _missing_reason()
        if reason:
            return {"available": False, "state": "missing", "model": model_label(), "detail": reason}
        if not self.alive():
            state = "stopped"
        else:
            if not self._ready and self._healthy(0.3):
                self._ready = True
            state = "ready" if self._ready else "loading"
        return {"available": True, "state": state, "model": model_label(), "detail": ""}

    def chat_json(self, system: str, messages: list[dict[str, str]], schema: dict[str, Any], max_tokens: int = 1024) -> str:
        """带着整段对话历史请求下一轮回复，要求按 JSON Schema 输出，返回模型写的 JSON 文本。"""
        self.ensure_ready()
        payload = {
            "messages": [{"role": "system", "content": system}, *messages],
            "temperature": 0.7,
            "top_p": 0.95,
            "top_k": 64,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_schema", "json_schema": {"name": "result", "strict": True, "schema": schema}},
            # 改写提示词不需要先思考，直接回答更快
            "chat_template_kwargs": {"enable_thinking": False},
        }
        try:
            response = httpx.post(f"{self.base_url}/v1/chat/completions", json=payload, timeout=180.0)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"本地 LLM 没有响应：{exc}") from exc
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"本地 LLM 出错（{response.status_code}）：{response.text[:200]}")
        choice = response.json()["choices"][0]
        if choice.get("finish_reason") == "length":
            raise HTTPException(status_code=502, detail="本地 LLM 的输出被截断了，再试一次。")
        return choice["message"].get("content") or ""


llm = LocalLLM()
atexit.register(llm.stop)
