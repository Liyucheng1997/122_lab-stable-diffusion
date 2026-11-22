"""主进程这一侧：管理生成工作进程（app/engine.py）的启动、任务转发和崩溃恢复。"""

from __future__ import annotations

import multiprocessing as mp
import threading
from typing import Any, Callable

from fastapi import HTTPException



class WorkerCrashed(Exception):
    pass


class GenerationWorker:
    def __init__(self) -> None:
        self._ctx = mp.get_context("spawn")
        self._proc: Any = None
        self._conn: Any = None
        self._lock = threading.Lock()
        # 工作进程里当前加载的内容（从工作进程的 loaded 消息同步过来）
        self.state: dict[str, Any] = {"model_key": None, "lora_key": None, "lora_scale": None, "memory_mode": None}
        self.last_exit_code: int | None = None

    # ---------------- 进程管理 ----------------
    def alive(self) -> bool:
        return self._proc is not None and self._proc.is_alive()

    def _start(self) -> None:
        from app import engine

        parent, child = self._ctx.Pipe()
        proc = self._ctx.Process(target=engine.worker_main, args=(child,), daemon=True, name="aigen-worker")
        proc.start()
        child.close()
        self._proc, self._conn = proc, parent
        self.state = {"model_key": None, "lora_key": None, "lora_scale": None, "memory_mode": None}

    def stop(self) -> None:
        """结束工作进程，模型占用的内存和显存由系统整块收回。"""
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        proc, conn = self._proc, self._conn
        self._proc = self._conn = None
        self.state = {"model_key": None, "lora_key": None, "lora_scale": None, "memory_mode": None}
        if proc is None:
            return
        try:
            if proc.is_alive() and conn is not None:
                conn.send({"cmd": "exit"})
                proc.join(5)
        except (OSError, EOFError, BrokenPipeError):
            pass
        if proc.is_alive():
            proc.kill()
            proc.join(5)
        if conn is not None:
            conn.close()

    def needs_fresh_process(self, model_key: str, lora_key: str, lora_scale: float) -> bool:
        if not self.alive():
            return True
        current = self.state.get("model_key")
        if current is None:
            return False
        # 只有换模型才开新进程；LoRA（包括 Z-Image）都在进程里动态切换
        return current != model_key

    def park(self) -> None:
        """让工作进程把显存让出来（给本地 LLM 用）。权重留在内存里，下次出图不用重新加载。"""
        with self._lock:
            if not self.alive() or self.state.get("model_key") is None:
                return
            try:
                self._conn.send({"cmd": "park"})
                deadline = 60.0
                while deadline > 0:
                    if self._conn.poll(0.5):
                        if self._conn.recv().get("type") == "parked":
                            return
                        break
                    elif not self._proc.is_alive():
                        raise EOFError
                    deadline -= 0.5
            except (EOFError, OSError, BrokenPipeError):
                pass
            # 没让出来（进程挂了或卡住）：直接结束它，显存一样能收回
            self._stop_locked()

    # ---------------- 任务 ----------------
    def generate(self, job: dict[str, Any], on_message: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        """把任务交给工作进程，转发进度消息，返回 done / error 消息。工作进程崩溃时抛 WorkerCrashed。"""
        with self._lock:
            if self.needs_fresh_process(job["model"], job["lora_path"], job["lora_scale"]):
                self._stop_locked()
                self._start()
            proc, conn = self._proc, self._conn
            try:
                conn.send({"cmd": "generate", "job": job})
                while True:
                    if conn.poll(0.5):
                        message = conn.recv()
                        if message.get("state"):
                            self.state = message["state"]
                        if message["type"] in ("done", "error"):
                            return message
                        on_message(message)
                    elif not proc.is_alive():
                        raise EOFError
            except (EOFError, OSError, BrokenPipeError) as exc:
                proc.join(2)
                self.last_exit_code = proc.exitcode
                self._stop_locked()
                raise WorkerCrashed(proc.exitcode) from exc


def crash_detail(exit_code: int | None) -> str:
    code = f"0x{exit_code & 0xFFFFFFFF:08X}" if isinstance(exit_code, int) else "未知"
    return f"生成进程意外退出（退出码 {code}），网页服务没受影响，已经准备好重新加载。再点一次「生成图片」即可。"


def raise_for_error(message: dict[str, Any]) -> None:
    raise HTTPException(status_code=int(message.get("status", 500)), detail=message.get("detail") or "生成失败")
