const statusText = document.querySelector("#statusText");
const safetyText = document.querySelector("#safetyText");
const refreshBtn = document.querySelector("#refreshBtn");
const form = document.querySelector("#generateForm");
const cnPrompt = document.querySelector("#cnPrompt");
const promptStyle = document.querySelector("#promptStyle");
const optimizePromptBtn = document.querySelector("#optimizePromptBtn");
const promptHelperStatus = document.querySelector("#promptHelperStatus");
const promptNotes = document.querySelector("#promptNotes");
const modelPreset = document.querySelector("#modelPreset");
const modelInput = document.querySelector("#model");
const loraSelect = document.querySelector("#loraSelect");
const loraPathInput = document.querySelector("#loraPath");
const generateBtn = document.querySelector("#generateBtn");
const preview = document.querySelector("#preview");
const gallery = document.querySelector("#gallery");
const runInfo = document.querySelector("#runInfo");
const downloadLink = document.querySelector("#downloadLink");
const gpuTimestamp = document.querySelector("#gpuTimestamp");
const memoryText = document.querySelector("#memoryText");
const memoryBar = document.querySelector("#memoryBar");
const utilText = document.querySelector("#utilText");
const utilBar = document.querySelector("#utilBar");
const powerText = document.querySelector("#powerText");
const tempText = document.querySelector("#tempText");
const torchText = document.querySelector("#torchText");
const lastRunState = document.querySelector("#lastRunState");
const lastPeakMemory = document.querySelector("#lastPeakMemory");
const lastMemoryDelta = document.querySelector("#lastMemoryDelta");
const lastPeakUtil = document.querySelector("#lastPeakUtil");
const lastSeconds = document.querySelector("#lastSeconds");
let currentPreviewUrl = "";

function readNumber(id) {
  const value = document.querySelector(`#${id}`).value.trim();
  return value === "" ? null : Number(value);
}

function formPayload() {
  return {
    prompt: document.querySelector("#prompt").value.trim(),
    negative_prompt: document.querySelector("#negativePrompt").value.trim(),
    model: modelInput.value.trim(),
    lora_path: loraPathInput.value.trim(),
    lora_scale: Number(document.querySelector("#loraScale").value),
    width: readNumber("width"),
    height: readNumber("height"),
    steps: readNumber("steps"),
    guidance_scale: readNumber("guidanceScale"),
    seed: readNumber("seed"),
  };
}

function setBusy(isBusy) {
  generateBtn.disabled = isBusy;
  generateBtn.textContent = isBusy ? "生成中..." : "生成图片";
  preview.classList.toggle("is-busy", isBusy);
}

function setPromptBusy(isBusy) {
  optimizePromptBtn.disabled = isBusy;
  optimizePromptBtn.textContent = isBusy ? "优化中..." : "优化为英文提示词";
}

function syncModelPresetFromInput() {
  const value = modelInput.value.trim();
  const match = Array.from(modelPreset.options).find((option) => option.value === value);
  modelPreset.value = match ? match.value : "";
}

function clearLoraSelection() {
  loraSelect.value = "";
  loraPathInput.value = "";
}

function showPreview(url, prompt) {
  preview.innerHTML = "";
  currentPreviewUrl = url;
  const image = document.createElement("img");
  image.src = `${url}?t=${Date.now()}`;
  image.alt = prompt || "生成图片";
  preview.appendChild(image);

  downloadLink.href = url;
  downloadLink.classList.remove("is-disabled");
}

function renderGallery(images) {
  gallery.innerHTML = "";
  if (!images.length) {
    gallery.innerHTML = '<div class="empty-history">暂无历史图片</div>';
    return;
  }

  for (const item of images) {
    const article = document.createElement("article");
    article.className = "thumb-card";
    article.innerHTML = `
      <div class="thumb-image-wrap">
        <a href="${item.url}" download>
          <img src="${item.url}" alt="${escapeHtml(item.prompt || item.name)}" loading="lazy" />
        </a>
        <button class="delete-image-button" type="button" data-image-name="${escapeHtml(item.name)}" title="删除图片">删除</button>
      </div>
      <div class="thumb-meta">
        <strong>${item.name}</strong>
        <span>${escapeHtml(item.prompt || "无提示词")}</span>
      </div>
    `;
    gallery.appendChild(article);
  }
}

async function deleteImage(name) {
  const ok = window.confirm(`删除 ${name}？本地 PNG 和同名 JSON 都会删除。`);
  if (!ok) {
    return;
  }

  const button = gallery.querySelector(`[data-image-name="${CSS.escape(name)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "删除中";
  }

  try {
    const response = await fetch(`/api/images/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "删除失败");
    }
    renderGallery(data.images || []);
    if (currentPreviewUrl.endsWith(`/${name}`)) {
      currentPreviewUrl = "";
      preview.innerHTML = '<div class="empty-state">已删除当前图片</div>';
      downloadLink.href = "#";
      downloadLink.classList.add("is-disabled");
    }
    runInfo.textContent = `已删除：${(data.deleted || []).join("、")}`;
  } catch (error) {
    runInfo.textContent = error.message || "删除失败。";
    if (button) {
      button.disabled = false;
      button.textContent = "删除";
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function formatMb(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} MB` : "--";
}

function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function formatNumber(value, unit) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}${unit}` : `--${unit}`;
}

function updateLastRun(metrics) {
  if (!metrics) {
    return;
  }
  if (metrics.ok === false) {
    lastRunState.textContent = "上次失败";
    return;
  }

  const peakMemory = metrics.peak_memory?.memory_used_mb;
  const totalMemory =
    metrics.peak_memory?.memory_total_mb ||
    metrics.after_load?.memory_total_mb ||
    metrics.after?.memory_total_mb;
  const peakUtil = metrics.peak_utilization?.utilization_percent;
  const delta = metrics.memory_delta_from_loaded_mb;

  lastRunState.textContent = `${metrics.sample_count || 0} 次采样`;
  lastPeakMemory.textContent =
    typeof peakMemory === "number" && typeof totalMemory === "number"
      ? `${Math.round(peakMemory)} / ${Math.round(totalMemory)} MB`
      : formatMb(peakMemory);
  lastMemoryDelta.textContent =
    typeof delta === "number" ? `${delta >= 0 ? "+" : ""}${Math.round(delta)} MB` : "--";
  lastPeakUtil.textContent = formatPercent(peakUtil);
  lastSeconds.textContent =
    typeof metrics.seconds === "number" && Number.isFinite(metrics.seconds)
      ? `${metrics.seconds.toFixed(2)}s`
      : "--";
}

function updateGpuPanel(data) {
  const gpu = data.gpu || {};
  if (!gpu.available) {
    gpuTimestamp.textContent = gpu.message || "GPU 数据不可用";
    memoryText.textContent = "--";
    utilText.textContent = "--";
    memoryBar.style.width = "0%";
    utilBar.style.width = "0%";
    powerText.textContent = "功耗 --";
    tempText.textContent = "温度 --";
    torchText.textContent = "Torch 显存 --";
    updateLastRun(data.latest_generation_metrics);
    return;
  }

  gpuTimestamp.textContent = gpu.timestamp || "刚刚";
  memoryText.textContent =
    typeof gpu.memory_used_mb === "number" && typeof gpu.memory_total_mb === "number"
      ? `${Math.round(gpu.memory_used_mb)} / ${Math.round(gpu.memory_total_mb)} MB`
      : "--";
  utilText.textContent = formatPercent(gpu.utilization_percent);
  memoryBar.style.width = `${asPercent(gpu.memory_percent)}%`;
  utilBar.style.width = `${asPercent(gpu.utilization_percent)}%`;
  powerText.textContent = `功耗 ${formatNumber(gpu.power_w, "W")}`;
  tempText.textContent = `温度 ${formatNumber(gpu.temperature_c, "C")}`;

  const torchMemory = data.torch_memory || {};
  torchText.textContent =
    torchMemory.available && typeof torchMemory.allocated_mb === "number"
      ? `Torch 显存 ${Math.round(torchMemory.allocated_mb)} MB`
      : "Torch 显存 --";

  updateLastRun(data.latest_generation_metrics);
}

async function refreshStatus() {
  const response = await fetch("/api/status");
  const data = await response.json();
  if (!data.ready) {
    statusText.textContent = data.message || "环境未就绪";
    return;
  }
  const gpu = data.gpu ? ` · ${data.gpu}` : "";
  statusText.textContent = `${data.device.toUpperCase()} · PyTorch ${data.torch}${gpu}`;
  safetyText.textContent = data.safety_mode === "diffusers_default" ? "默认安全过滤" : "安全状态未知";
}

async function refreshImages() {
  const response = await fetch("/api/images");
  const data = await response.json();
  renderGallery(data.images || []);
}

async function refreshLoras() {
  const previousValue = loraSelect.value || loraPathInput.value.trim();
  const response = await fetch("/api/loras");
  const data = await response.json();
  const loras = data.loras || [];

  loraSelect.innerHTML = '<option value="">不使用 LoRA</option>';
  for (const item of loras) {
    const option = document.createElement("option");
    option.value = item.path;
    option.textContent = `${item.display_name || item.name} (${item.size_mb} MB)`;
    option.title = item.path;
    loraSelect.appendChild(option);
  }

  if (previousValue && loras.some((item) => item.path === previousValue)) {
    loraSelect.value = previousValue;
    loraPathInput.value = previousValue;
  } else if (!loraPathInput.value.trim()) {
    loraSelect.value = "";
  }
}

async function refreshGpu() {
  const response = await fetch("/api/gpu");
  const data = await response.json();
  updateGpuPanel(data);
}

async function optimizePrompt() {
  const text = cnPrompt.value.trim();
  if (!text) {
    promptHelperStatus.textContent = "请先输入中文描述";
    return;
  }

  setPromptBusy(true);
  promptHelperStatus.textContent = "正在优化";
  promptNotes.textContent = "";

  try {
    const response = await fetch("/api/prompt/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        style: promptStyle.value.trim(),
        target_model: modelInput.value.trim() || "Stable Diffusion 1.5",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "提示词优化失败");
    }

    document.querySelector("#prompt").value = data.prompt || "";
    if (data.negative_prompt) {
      document.querySelector("#negativePrompt").value = data.negative_prompt;
    }
    promptHelperStatus.textContent = `已优化 · ${data.model || "DeepSeek"}`;
    promptNotes.textContent = data.notes || "";
  } catch (error) {
    promptHelperStatus.textContent = "优化失败";
    promptNotes.textContent = error.message || "提示词优化失败。";
  } finally {
    setPromptBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formPayload();
  if (!payload.prompt) {
    runInfo.textContent = "请先输入提示词。";
    return;
  }

  setBusy(true);
  runInfo.textContent = "首次运行会下载并加载模型，请耐心等待。";
  preview.innerHTML = '<div class="empty-state">正在生成...</div>';

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "生成失败");
    }
    showPreview(data.url, payload.prompt);
    renderGallery(data.images || []);
    updateLastRun(data.gpu_metrics);
    const peakMemory = data.gpu_metrics?.peak_memory?.memory_used_mb;
    const peakUtil = data.gpu_metrics?.peak_utilization?.utilization_percent;
    runInfo.textContent = `已保存：${data.path} · Seed ${data.seed} · ${data.seconds}s · 峰值显存 ${formatMb(peakMemory)} · 峰值利用率 ${formatPercent(peakUtil)}`;
  } catch (error) {
    preview.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
    runInfo.textContent = "生成失败。";
  } finally {
    setBusy(false);
  }
});

optimizePromptBtn.addEventListener("click", () => {
  optimizePrompt();
});

modelPreset.addEventListener("change", () => {
  modelInput.value = modelPreset.value;
  const selected = modelPreset.selectedOptions[0];
  if (selected?.dataset.family === "sdxl") {
    clearLoraSelection();
    runInfo.textContent = "已切换到 SDXL。SD1.5 LoRA 已清空，请使用 SDXL 对应 LoRA。";
  }
});

modelInput.addEventListener("input", () => {
  syncModelPresetFromInput();
});

loraSelect.addEventListener("change", () => {
  loraPathInput.value = loraSelect.value;
});

loraPathInput.addEventListener("input", () => {
  const value = loraPathInput.value.trim();
  loraSelect.value = Array.from(loraSelect.options).some((option) => option.value === value) ? value : "";
});

gallery.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-image-button");
  if (!button) {
    return;
  }
  deleteImage(button.dataset.imageName);
});

refreshBtn.addEventListener("click", () => {
  refreshStatus().catch(() => {
    statusText.textContent = "状态检测失败";
  });
  refreshImages().catch(() => {});
  refreshLoras().catch(() => {});
  refreshGpu().catch(() => {});
});

refreshStatus().catch(() => {
  statusText.textContent = "状态检测失败";
});
syncModelPresetFromInput();
refreshImages().catch(() => {});
refreshLoras().catch(() => {});
refreshGpu().catch(() => {});
setInterval(() => {
  refreshGpu().catch(() => {
    gpuTimestamp.textContent = "GPU 状态刷新失败";
  });
}, 1000);
