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

## DeepSeek 提示词优化

网页支持输入中文描述，调用 DeepSeek 生成更适合 Stable Diffusion 的英文正向/反向提示词。

复制 `.env.example` 为 `.env`，然后填写 DeepSeek Key：

```text
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

保存后重启服务。API Key 只在后端读取，不会发到浏览器。

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

模型缓存固定在项目内：

```text
hf_cache/
```

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
- 默认模型：已下载到 `hf_cache/`
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
