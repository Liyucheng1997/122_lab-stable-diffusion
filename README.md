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

## 本地 LLM 提示词优化

网页「提示词 → 中文优化」可以输入中文描述，由**本地的 Gemma 4**（llama.cpp，不联网、不需要 API Key）改写成适合当前模型的提示词：

- Z-Image Turbo：一段自然语言英文描述，不写反向提示词（它在 CFG 0 下不读）
- SDXL / SD 1.5：逗号分隔的英文短语 + 反向提示词

模型和 llama.cpp 用的是隔壁 `459_无审查LLM` 项目里的文件（放在别处时在 `.env` 里设 `LOCAL_LLM_DIR`，其他可调项见 `.env.example`）。网页服务启动时会顺带在后台启动 `llama-server`（端口 8090），日志在 `logs/llama-server.log`。

**显存调度**：16GB 显存放不下 Gemma（约 8GB）和生图模型同时计算，所以两边轮流用显卡——

- 点「生成图片」：先结束 `llama-server`，显存整块还给生图模型；
- 点「转写」：先让生图模型把显存让出来（权重留在内存里，不用重新加载），再启动 Gemma，通常几秒；
- 连续出图或连续转写时不会发生切换，只有在两者之间来回时才切一次。

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
