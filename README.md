# Local Stable Diffusion + LoRA Web UI

本项目提供一个本地网页跑图工具：

- FastAPI 后端加载 Stable Diffusion / LoRA
- 浏览器表单提交 prompt、尺寸、步数、seed 等参数
- 图片自动保存到 `outputs/`
- 支持填写 LoRA 文件路径或目录，并设置 LoRA 权重

## 环境

推荐使用 Python 3.11。RTX 50 系列显卡建议使用支持 CUDA 12.8+ 的 PyTorch wheel。

## 快速启动

克隆后先创建虚拟环境：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip setuptools wheel
```

安装 CUDA 版 PyTorch：

```powershell
.\.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

安装项目依赖：

```powershell
.\.venv\Scripts\python -m pip install -r requirements.txt
```

启动服务：

```powershell
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 7860
```

打开：

```text
http://127.0.0.1:7860
```

### 桌面版（双击打开）

不想每次开命令行，可以在项目目录运行一次：

```powershell
powershell -ExecutionPolicy Bypass -File .\create_shortcut.ps1
```

桌面和开始菜单会出现「本地 AI 生图」快捷方式。双击就会在独立窗口里打开界面（`desktop.pyw`，用 pywebview），关掉窗口时网页服务、本地 LLM 和出图进程会一起退出，不占显存。没有控制台，运行日志在 `logs/desktop.log`。桌面窗口的对话记录和浏览器里的是分开存的。

## AI 助手（本地 LLM 对话出图）

网页默认打开的「AI 助手」是一个多轮对话的出图助手（顶部三个页签：「AI 助手」「手动出图」「历史画廊」，手动出图是原来的参数表单，历史画廊集中看所有出过的图）：对话占主区，图片直接出在对话里，模型、LoRA、参考图等参数收在右侧的「参数」面板。它，由**本地的 Gemma 4**（llama.cpp，不联网、不需要 API Key）驱动：

- 用中文说想要的画面，助手写好提示词，并自己决定画面比例、张数（1–4）、Seed、步数和 CFG，然后自动出图（可以取消勾选「自动出图」，改成只填表单）
- 不满意就接着说怎么改，它记得前面的每一版，只改你提到的地方；说「保持构图」时会沿用上一张的 Seed
- 可以给助手参考图：点输入框下的「参考图」，或直接粘贴、拖进来（也可以在大图里点「作为参考图」）。助手看得见图（Gemma 4 的视觉模块 `mmproj-*.gguf`），图上方可以选用法——「图生图」（默认）把这张图当底图重绘，画面比例跟着原图走，重绘幅度由助手按改动大小来定；「只提取提示词」则只看图写提示词，出图时不用这张图。之后的轮次沿用这个选择，直到你说「不要参考图了」
- 你说了几张就出几张（张数直接从你的话里读，不靠模型数）；一次出多张时，助手会给每张各写一句不同的机位 / 光线补充，避免几张几乎一样
- 图生图的局限：Z-Image Turbo 不是图像编辑模型。重绘幅度低（约 0.6）时背景基本不变，高（0.9）时才能换场景，但物体的细节会被重画、和原图有出入；想要「商品原样放进新场景」需要专门的编辑模型
- 每段对话都保存在浏览器里，列在左侧的「对话记录」中：点「新对话」只是另开一段，旧的随时可以点回去接着改，不要的可以单独删除（已经出的图仍在历史画廊里）

提示词写法跟着模型走：

- Z-Image Turbo：直接用中文写一段 150–300 字的具体画面描述（它的文本编码器是 Qwen，中文理解很好），不写反向提示词（CFG 0 下不读）；写法参考官方的提示词增强模板
- SDXL / SD 1.5：逗号分隔的英文短语 + 反向提示词（CLIP 读不懂中文）

模型和 llama.cpp 用的是隔壁 `459_无审查LLM` 项目里的文件（放在别处时在 `.env` 里设 `LOCAL_LLM_DIR`，其他可调项见 `.env.example`）。网页服务启动时会顺带在后台启动 `llama-server`（端口 8090），日志在 `logs/llama-server.log`。

**显存调度**：16GB 显存放不下 Gemma（约 8GB）和生图模型同时计算，所以两边轮流用显卡——

- 点「生成图片」：先结束 `llama-server`，显存整块还给生图模型；
- 给助手发消息：先让生图模型把显存让出来（权重留在内存里，不用重新加载），再启动 Gemma，通常几秒；
- 连续出图或连续对话时不会发生切换，只有在两者之间来回时才切一次。

## 参考姿势（姿势库 + ControlNet）

从 1439 张多角度人体姿势里挑一个动作，出图时人物照着这个动作摆，衣服、长相、场景还是按提示词画。只支持 Z-Image Turbo。

- 入口：参数面板的「参考姿势」，或 AI 助手输入框下面的「姿势」。弹出的姿势库按体系（全身标准 / 全身性感 / 上半身 / 双人）、分类、视角（正面 / 斜侧 / 侧面 / 俯视 / 仰视）筛选，也能搜动作名；每张卡片下面切视角，点图选用
- 选了姿势后画面比例自动切到 3:4（姿势图都是 900 × 1200 竖图），助手也会照着姿势写人物动作和视角
- 参考姿势和图生图二选一，后放的为准
- 生成的图的 `.json` 里会记下用的姿势（`pose`、`pose_name`、`pose_scale`、`pose_controlnet`），「复用参数」会一起带回来

**控制图和强度**（同一提示词、同一 seed 实测）：控制图是从姿势的深度图里提取的人物轮廓（黑底白线），只管动作和身形，衣服、脸、背景都照提示词画。默认强度 0.85：

| 强度 | 效果 |
| --- | --- |
| 0.7 | 基本不跟姿势 |
| 0.8–0.9（默认 0.85） | 动作准（手的位置、腿的角度、身体朝向都对），衣服自然，推荐 |
| 1.0 | 动作更贴，但衣服会贴着身体轮廓（长袖衬衫变成短背心） |

试过没采用的：直接用深度图，强度够摆出姿势时画出来就是一个没脸的白模；用白模线稿，关节圆圈和身体分割线会画成白色紧身衣。

**需要下载两样东西**（第一次选姿势时网页上会提示，点一下就行）：

1. 姿势库（约 55 MB → `poses/`）：缩略图和深度图，来自 [ai-pose-gallery](https://ai-pose-gallery.anhao.app/poses) / GitHub [anhao/ai-pose-gallery-zh](https://github.com/anhao/ai-pose-gallery-zh)，原作者ギア（[@giaaibusi](https://x.com/giaaibusi)）。图片版权归原作者，只供个人学习和创作，所以 `poses/` 不进 git。也可以用命令下载（中断了重跑会接着下；加 `--full` 另外下载约 640 MB 的白模线稿原图，出图用不到）：

   ```powershell
   .\.venv\Scripts\python scripts\download_poses.py
   ```

   连不上 GitHub 时在 `.env` 里设 `POSE_MIRROR`（raw.githubusercontent.com 的镜像地址）。

2. 姿势控制模型（2 GB → `models/controlnet/`）：阿里 PAI 的 [Z-Image-Turbo-Fun-Controlnet-Union-2.1](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1) 的 Lite 版（`lite-2602-8steps`，Apache-2.0）：3 个控制层、约 1B 参数，8 步蒸馏，和 Z-Image Turbo 一样 9 步出图。下载完会在单独的进程里转成 diffusers 目录，不用联网。

**显存和内存**（RTX 5080 Laptop 16GB、32GB 内存，896 × 1152，连出 3 张）：

| | 完整版 ControlNet（v2.1.0） | Lite 版（现在） |
| --- | --- | --- |
| 显存实占峰值 | 14.8 GB，会爆显存 | 9.7 GB |
| 出图进程提交内存 | 31–36 GB | 26 GB |
| 每张耗时（第二张起） | 27–37 秒 | 19–23 秒 |

完整版有 15 个控制层（3.3B 参数），16GB 显卡上只能用 fp8 存权重，每层算的时候临时转回 bf16，显存反复申请释放，实际占住的比用到的多 4～5 GB；显存不够时 Windows 会把多出的部分挪到系统内存，进程提交内存冲到 40 GB 以上。Lite 版 2 GB 直接用 bf16，没有这个问题。

ControlNet 平时放在内存里，去噪第一步（文本编码器下了显卡之后）才搬上显卡，去噪完就搬回内存，不和文本编码器、VAE 解码和本地 LLM 抢显存。万一还是爆了显存，出图进程会自动重启，再点一次「生成图片」就行，不用重开软件。

## 模型

默认模型是：

```text
stable-diffusion-v1-5/stable-diffusion-v1-5
```

首次生成会从 Hugging Face 下载模型到本机缓存，可能需要几分钟。你也可以在网页中填写：

- Hugging Face 模型 ID
- 本地 Diffusers 模型目录
- 单文件 `.safetensors` / `.ckpt` 模型

网页的 `模型预设` 里已经包含：

- Stable Diffusion 1.5：`stable-diffusion-v1-5/stable-diffusion-v1-5`
- Stable Diffusion XL 1.0：`stabilityai/stable-diffusion-xl-base-1.0`

切换到 SDXL 时不要继续使用 SD1.5 LoRA；LoRA 必须和模型基座匹配。

所有模型都放在项目的 `models/` 目录：

```text
models/
  Z-Image-Turbo/                    diffusers 格式
  stable-diffusion-xl-base-1.0/
  stable-diffusion-v1-5/
  waiREALCN_v150.safetensors        单文件模型
```

点 `基础模型` 旁边的「模型详情 · 管理」可以查看每个模型的介绍、优缺点、推荐参数和占用空间，并下载或删除。

## 推荐模型：Z-Image Turbo

`模型` 下拉框里的 **Z-Image Turbo**（阿里通义，6B，Apache-2.0）写实效果明显好于 SD 1.5 / SDXL，能直接理解中文提示词，9 步出图。
第一次选它时点「下载模型」，约 32.8 GB 会下载到 `models/Z-Image-Turbo/`，网页上能看到进度。16GB 显存的显卡会自动用 CPU offload（显存不够时再加 fp8 权重）运行。

- 推荐参数：1024 × 1024、9 步、CFG 0（切换模型时会自动填好）
- CFG 为 0 时不使用反向提示词
- 连不上 Hugging Face 时，在 `.env` 里加 `HF_ENDPOINT=https://hf-mirror.com` 后重启

## LoRA 库

点 `LoRA 风格` 旁边的「浏览 LoRA 库」，可以看到按 Z-Image / SDXL / SD 1.5 分类的知名 LoRA（预览图、简介、触发词、建议权重、许可证），一键下载到 `loras/<模型类型>/`，不需要的可以在那里删除，需要时再下载回来。
选用时会自动填好权重，并把触发词加到提示词开头。目录定义在 `app/catalog.py`，想加新的 LoRA 往 `LORA_CATALOG` 里加一项即可。

## LoRA

把 LoRA 文件放到 `loras/`，然后在网页中填写例如：

```text
loras/my-style.safetensors
```

`LoRA 权重` 通常从 `0.5` 到 `1.0` 开始调。

网页会自动扫描 `loras/` 下的 `.safetensors`、`.pt`、`.bin`、`.ckpt` 文件，并显示在 `选择 LoRA` 下拉框中。选择后会自动填入 `LoRA 路径`。

`选择 LoRA` 显示的是中文风格名；`LoRA 路径` 保留真实文件路径，生成时以后者为准。

## 输出

生成结果保存在：

```text
outputs/
```

每张图会同时保存一份同名 `.json` 元数据。

历史图片卡片右上角有 `删除` 按钮。删除会同时移除本地 `outputs/` 里的 PNG 和同名 `.json` 元数据。

## GPU 资源监控

网页会显示两类 GPU 数据：

- 实时 GPU：来自 `nvidia-smi`，包括总显存占用、利用率、温度、功耗。
- 上一张图：本次生成采样期间的峰值显存、相对模型加载后的新增显存、峰值利用率和耗时。

每张图对应的 `.json` 元数据里也会保存 `gpu_metrics`，方便之后对比不同尺寸、步数、模型或 LoRA 的资源消耗。

## 安全过滤

项目使用 Diffusers 模型管线的默认 safety checker，不额外做本地关键词拦截。

## 本次安装

- Python 虚拟环境：`.venv/`
- PyTorch：CUDA 12.8 wheel，已识别 RTX 5080 Laptop GPU
- 默认模型：在 `models/` 目录
- 测试输出：`outputs/`

这些目录都是本机运行产物，不会提交到 GitHub。

## 停止服务

如果服务是后台启动的，可以查看 7860 端口对应进程：

```powershell
Get-NetTCPConnection -LocalPort 7860
```

然后结束对应 PID：

```powershell
Stop-Process -Id <PID>
```
