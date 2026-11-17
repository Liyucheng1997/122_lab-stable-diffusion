# LoRA 目录

LoRA 按适用的模型类型分文件夹存放，网页会自动扫描：

```
loras/
  zimage/   Z-Image Turbo 用
  sdxl/     SDXL 以及 WAI-REAL_CN 等 SDXL 微调模型用
  sd15/     Stable Diffusion 1.5 用
  .previews/  LoRA 库的预览图缓存（可随时删除）
```

- 在网页「LoRA 库 · 管理」里下载的 LoRA 会自动放进对应文件夹，也可以在那里删除，需要时再下载回来。
- 内置目录定义在 `app/catalog.py` 的 `LORA_CATALOG`。
- 自己下载的 LoRA 放进对应文件夹即可；放在其他位置时，网页会读取文件头自动判断它属于哪类模型。

## sd15/ 里原有的 LoRA

| 文件 | 风格 | 来源 |
| --- | --- | --- |
| style_architecture_sd15.safetensors | 建筑空间设计 | jnluca/stable-diffusion-v1-5-architecture-lora |
| style_anime_character_sd15.safetensors | 动漫角色 | osmr/stable-diffusion-v1-5-lora-animegirls |
| style_car_design_sd15.safetensors | 汽车工业设计 | mingyu-oo/stable-diffusion-v1-5-lora-hyundai-car-design |
| style_anime_landscape_sd15.safetensors | 动漫风景 | 未记录 |
| style_impressionism_monet_sd15.safetensors | 莫奈印象派 | 未记录 |
| style_pencil_sketch_sd15.safetensors | 铅笔素描 | 未记录 |
| style_realistic_photo_sd15.safetensors | 写实摄影增强 | 未记录 |
| pytorch_lora_weights.safetensors | 自定义 | 未记录 |

前三个删除后可以在 LoRA 库里重新下载；来源未记录的删除后无法从网页恢复。
（原先放在 disabled/ 的 4 个在新版 diffusers 下已能正常加载，已一并启用。）
