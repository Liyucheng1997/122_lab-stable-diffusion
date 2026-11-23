"""桌面版入口：双击桌面快捷方式打开，用独立窗口显示网页界面。

- 网页服务（uvicorn）跑在本进程的后台线程里，关窗口时正常退出，
  本地 LLM 和出图工作进程跟着一起关掉，不会留在后台占显存。
- 如果 7860 端口上已经有服务在跑（比如用命令行开过），直接连上去，关窗口时不动它。
- 用 pythonw 启动没有控制台，输出写到 logs/desktop.log。
"""

from __future__ import annotations

import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"

# pythonw 下 stdout/stderr 是 None，diffusers 的进度条等一写就报错。
# 这段在模块顶层：出图工作进程（spawn）重新导入本文件时也会执行。
if sys.stdout is None or sys.stderr is None:
    LOG_DIR.mkdir(exist_ok=True)
    _log = open(LOG_DIR / "desktop.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stdout or _log
    sys.stderr = sys.stderr or _log

HOST = "127.0.0.1"
PORT = 7860
URL = f"http://{HOST}:{PORT}/"
TITLE = "本地 AI 生图"
ICON = ROOT / "static" / "app.ico"

LOADING_HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;font-family:"Segoe UI","Microsoft YaHei",sans-serif;
background:#f5f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center}
@media (prefers-color-scheme:dark){html,body{background:#1c1c1e;color:#f5f5f7}}
.box{text-align:center}.logo{width:56px;height:56px;border-radius:14px;background:#1d1d1f;color:#fff;
font-weight:700;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 18px}
@media (prefers-color-scheme:dark){.logo{background:#f5f5f7;color:#1d1d1f}}
p{margin:0;font-size:14px;opacity:.6}</style></head>
<body><div class="box"><div class="logo">AI</div><p>正在启动…</p></div></body></html>"""


def server_alive() -> bool:
    try:
        with urllib.request.urlopen(URL + "api/settings", timeout=1) as resp:
            return resp.status == 200
    except OSError:
        return False


def main() -> None:
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))

    # 让任务栏按本程序分组、显示本程序的图标，而不是 Python 的
    try:
        import ctypes

        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("local.ai-image-web")
    except (AttributeError, OSError):
        pass

    import uvicorn
    import webview

    server: uvicorn.Server | None = None
    server_thread: threading.Thread | None = None

    if not server_alive():
        config = uvicorn.Config("app.main:app", host=HOST, port=PORT, log_level="info")
        server = uvicorn.Server(config)
        server_thread = threading.Thread(target=server.run, name="uvicorn", daemon=True)
        server_thread.start()

    window = webview.create_window(
        TITLE,
        html=LOADING_HTML,
        width=1440,
        height=920,
        min_size=(900, 640),
        text_select=True,
    )

    def wait_and_load() -> None:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if server_thread is not None and not server_thread.is_alive():
                break  # 服务没起来（比如端口被别的程序占了）
            if server_alive():
                window.load_url(URL)
                return
            time.sleep(0.3)
        window.load_html(
            LOADING_HTML.replace("正在启动…", "启动失败，详情见 logs/desktop.log")
        )

    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.start(
        wait_and_load,
        private_mode=False,  # 保留浏览器存储：对话记录存在 localStorage 里
        storage_path=str(ROOT / ".webview"),
        icon=str(ICON) if ICON.exists() else None,
    )

    # 窗口关了：让 uvicorn 正常退出，触发 shutdown 钩子关掉 LLM 和出图进程
    if server is not None and server_thread is not None:
        server.should_exit = True
        server_thread.join(timeout=20)


if __name__ == "__main__":
    main()
