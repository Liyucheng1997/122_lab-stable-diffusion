"use strict";

/* ---------------- 工具 ---------------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const ICONS = {
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  reuse: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};

function icon(name, size = 16) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function hydrateIcons(root = document) {
  for (const el of $$("[data-icon]", root)) {
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16);
    if (el.tagName === "SPAN") el.style.display = "inline-flex";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const formatMb = (v) => (isNum(v) ? `${Math.round(v)} MB` : "--");
const formatGb = (v) => (isNum(v) ? `${(v / 1024).toFixed(1)}` : "--");
const formatPercent = (v) => (isNum(v) ? `${Math.round(v)}%` : "--");
const clampPercent = (v) => (isNum(v) ? Math.max(0, Math.min(100, v)) : 0);

/* ---------------- 提示 & 弹层 ---------------- */
const toastHost = $("#toastHost");
function toast(message, type = "info", ms = 2600) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function openModal(modalEl, { onKey } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.appendChild(modalEl);
  document.body.appendChild(overlay);
  const close = () => {
    document.removeEventListener("keydown", keyHandler, true);
    overlay.remove();
  };
  const keyHandler = (event) => {
    // 叠了多层弹层时只让最上面那层响应按键
    if ($$(".modal-overlay").at(-1) !== overlay) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    onKey?.(event);
  };
  document.addEventListener("keydown", keyHandler, true);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  return close;
}

function confirmDialog({ title, message, okText = "删除" }) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal confirm";
    modal.innerHTML = `
      <div class="confirm-ico">${icon("trash", 22)}</div>
      <div class="confirm-title">${escapeHtml(title)}</div>
      <div class="confirm-msg">${escapeHtml(message)}</div>
      <div class="confirm-actions">
        <button class="btn" data-act="cancel" type="button">取消</button>
        <button class="btn btn-danger-fill" data-act="ok" type="button">${escapeHtml(okText)}</button>
      </div>`;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    const close = openModal(modal, {
      onKey: (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
      },
    });
    // Esc / 点遮罩关闭时视为取消
    const observer = new MutationObserver(() => {
      if (!modal.isConnected) {
        observer.disconnect();
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }
    });
    observer.observe(document.body, { childList: true });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => finish(false));
    modal.querySelector('[data-act="ok"]').addEventListener("click", () => finish(true));
    modal.querySelector('[data-act="ok"]').focus();
  });
}

/* ---------------- 元素 ---------------- */
const statusText = $("#statusText");
const engineDot = $("#engineDot");
const engineText = $("#engineText");
const refreshBtn = $("#refreshBtn");
const themeBtn = $("#themeBtn");
const form = $("#generateForm");
const promptInput = $("#prompt");
const negativeInput = $("#negativePrompt");
const promptModeSeg = $("#promptModeSeg");
const promptHelper = $("#promptHelper");
const cnPrompt = $("#cnPrompt");
const promptStyle = $("#promptStyle");
const optimizePromptBtn = $("#optimizePromptBtn");
const promptHelperStatus = $("#promptHelperStatus");
const promptNotes = $("#promptNotes");
const modelPreset = $("#modelPreset");
const modelInput = $("#model");
const customModelField = $("#customModelField");
const familyTag = $("#familyTag");
const loraSelect = $("#loraSelect");
const loraPathInput = $("#loraPath");
const loraScaleInput = $("#loraScale");
const loraScaleRange = $("#loraScaleRange");
const loraHint = $("#loraHint");
const ratioSeg = $("#ratioSeg");
const widthInput = $("#width");
const heightInput = $("#height");
const sizeText = $("#sizeText");
const stepsInput = $("#steps");
const stepsRange = $("#stepsRange");
const guidanceInput = $("#guidanceScale");
const guidanceRange = $("#guidanceRange");
const seedInput = $("#seed");
const seedRandomBtn = $("#seedRandomBtn");
const generateBtn = $("#generateBtn");
const stage = $("#stage");
const preview = $("#preview");
const busyText = $("#busyText");
const resultMeta = $("#resultMeta");
const runInfo = $("#runInfo");
const downloadLink = $("#downloadLink");
const useSeedBtn = $("#useSeedBtn");
const gallery = $("#gallery");
const galleryCount = $("#galleryCount");
const gpuTimestamp = $("#gpuTimestamp");
const memoryText = $("#memoryText");
const memoryBar = $("#memoryBar");
const utilText = $("#utilText");
const utilBar = $("#utilBar");
const powerText = $("#powerText");
const tempText = $("#tempText");
const torchText = $("#torchText");
const lastRunState = $("#lastRunState");
const lastPeakMemory = $("#lastPeakMemory");
const lastMemoryDelta = $("#lastMemoryDelta");
const lastPeakUtil = $("#lastPeakUtil");
const lastSeconds = $("#lastSeconds");
const modelNote = $("#modelNote");
const modelDownload = $("#modelDownload");
const modelDlText = $("#modelDlText");
const modelDlBtn = $("#modelDlBtn");
const modelDlMeter = $("#modelDlMeter");
const modelDlBar = $("#modelDlBar");
const modelDlSub = $("#modelDlSub");
const negHint = $("#negHint");
const loraLibBtn = $("#loraLibBtn");
const modelLibBtn = $("#modelLibBtn");
const busyBar = $("#busyBar");
const paramHint = $("#paramHint");
const paramHintText = $("#paramHintText");
const paramResetBtn = $("#paramResetBtn");
const refFile = $("#refFile");
const refDrop = $("#refDrop");
const refBox = $("#refBox");
const refThumb = $("#refThumb");
const refSize = $("#refSize");
const refTag = $("#refTag");
const refChangeBtn = $("#refChangeBtn");
const refClearBtn = $("#refClearBtn");
const strengthField = $("#strengthField");
const strengthInput = $("#strength");
const strengthRange = $("#strengthRange");
const strengthNote = $("#strengthNote");
const countInput = $("#count");
const countRange = $("#countRange");
const countNote = $("#countNote");
const stopBatchBtn = $("#stopBatchBtn");
const kbdHint = $("#kbdHint");
const useRefBtn = $("#useRefBtn");

const FORM_KEY = "aigen.form.v1";
const CUSTOM = "__custom__";
const SIZES = {
  sd15: { "1:1": [512, 512], "3:4": [512, 688], "4:3": [688, 512], "9:16": [432, 768], "16:9": [768, 432] },
  sdxl: { "1:1": [1024, 1024], "3:4": [896, 1152], "4:3": [1152, 896], "9:16": [768, 1344], "16:9": [1344, 768] },
  zimage: { "1:1": [1024, 1024], "3:4": [896, 1152], "4:3": [1152, 896], "9:16": [768, 1344], "16:9": [1344, 768] },
};
const FAMILY_LABELS = { sd15: "SD 1.5", sdxl: "SDXL", zimage: "Z-Image" };
let familyDefaults = {
  sd15: { steps: 25, guidance_scale: 7.5 },
  sdxl: { steps: 30, guidance_scale: 6 },
  zimage: { steps: 9, guidance_scale: 0 },
};
let models = [];
let loraRecords = [];
let modelPollTimer = null;
let modelLibRender = null; // 模型库弹窗打开时的重绘函数

let images = [];
let currentResult = null; // { url, name, seed }
let isBusy = false;
let refImage = null; // 图生图参考图 { src: data URL 或 /outputs/ 下的地址, width, height }
let refToken = 0;
let batch = null; // 一次生成多张时的进度 { index, count }
let stopRequested = false;
let busyTimer = null;
let lastProgress = null;
let busyTimerTick = null;
let engine = { ready: false, loadedModel: null };
const metaCache = new Map();

/* ---------------- 主题 ---------------- */
function applyThemeIcon() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeBtn.innerHTML = icon(dark ? "sun" : "moon", 17);
}
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("aigen.theme", next);
  } catch {}
  applyThemeIcon();
});
try {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
    let saved = null;
    try {
      saved = localStorage.getItem("aigen.theme");
    } catch {}
    if (!saved) {
      document.documentElement.dataset.theme = event.matches ? "dark" : "light";
      applyThemeIcon();
    }
  });
} catch {}

/* ---------------- 模型 / 尺寸 ---------------- */
function currentModel() {
  return modelPreset.value === CUSTOM ? modelInput.value.trim() : modelPreset.value;
}

function familyOf(model) {
  const preset = models.find((m) => m.id === model);
  if (preset) return preset.family;
  const option = $$("option", modelPreset).find((o) => o.value === model);
  if (option?.dataset.family) return option.dataset.family;
  if (/z-?image/i.test(model || "")) return "zimage";
  return /xl|sdxl|pony|illustrious/i.test(model || "") ? "sdxl" : "sd15";
}

function modelLabel(model) {
  const preset = models.find((m) => m.id === model);
  if (preset) return preset.label;
  const option = $$("option", modelPreset).find((o) => o.value === model && o.value !== CUSTOM);
  if (option) return option.textContent.replace(/（.*?）/, "").trim();
  return (model || "").split(/[\\/]/).pop() || "--";
}

function formatSize(bytes) {
  if (!isNum(bytes) || bytes <= 0) return "--";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function renderModelOptions() {
  if (!models.length) return;
  const keep = currentModel();
  modelPreset.innerHTML =
    models
      .map((m) => {
        const status = m.local || m.installed ? "" : m.job?.status === "downloading" ? " · 下载中" : ` · 未下载 ${m.size_gb ? `${m.size_gb} GB` : ""}`;
        const badge = m.badge ? `（${m.badge}）` : "";
        return `<option value="${escapeHtml(m.id)}" data-family="${m.family}">${escapeHtml(m.label)}${badge}${escapeHtml(status)}</option>`;
      })
      .join("") + `<option value="${CUSTOM}">自定义模型…</option>`;
  const isPreset = models.some((m) => m.id === keep);
  modelPreset.value = isPreset ? keep : CUSTOM;
  if (!isPreset) modelInput.value = keep;
  customModelField.hidden = isPreset;
}

function updateModelPanel() {
  const preset = models.find((m) => m.id === currentModel());
  modelNote.hidden = !preset?.note;
  modelNote.textContent = preset?.note || "";
  const needDownload = !!preset && preset.downloadable && !preset.installed;
  modelDownload.hidden = !needDownload;
  if (!needDownload) return;
  const job = preset.job;
  const downloading = job?.status === "downloading";
  const total = job?.total || preset.size_gb * 1e9;
  modelDlBtn.hidden = downloading;
  modelDlMeter.hidden = !downloading;
  if (downloading) {
    const pct = total ? Math.min(100, (job.downloaded / total) * 100) : 0;
    modelDlBar.style.width = `${pct}%`;
    modelDlText.textContent = `正在下载 ${Math.floor(pct)}%`;
    modelDlSub.textContent = `${formatSize(job.downloaded)} / ${formatSize(total)} · 关掉网页也会在后台继续下载`;
  } else if (job?.status === "error") {
    modelDlText.textContent = "下载失败";
    modelDlBtn.textContent = "重试";
    modelDlSub.textContent = job.error || "";
  } else {
    modelDlText.textContent = `需要先下载（约 ${preset.size_gb} GB）`;
    modelDlBtn.textContent = "下载模型";
    modelDlSub.textContent = "从 Hugging Face 下载到项目的 models 目录，只需下载一次。";
  }
}

async function refreshModels() {
  const response = await fetch("/api/models");
  const data = await response.json();
  const wasDownloading = new Set(models.filter((m) => m.job?.status === "downloading").map((m) => m.id));
  models = data.models || [];
  if (data.family_defaults) familyDefaults = data.family_defaults;
  for (const m of models) {
    if (wasDownloading.has(m.id) && m.installed) toast(`${m.label} 下载完成`, "success", 4000);
    if (wasDownloading.has(m.id) && m.job?.status === "error") toast(`${m.label} 下载失败`, "error", 4000);
  }
  if (data.storage) libStorage = data.storage;
  renderModelOptions();
  updateFamily(false);
  modelLibRender?.();
  clearTimeout(modelPollTimer);
  if (models.some((m) => m.job?.status === "downloading")) {
    modelPollTimer = setTimeout(() => refreshModels().catch(() => {}), 1500);
  }
}

modelDlBtn.addEventListener("click", async () => {
  modelDlBtn.disabled = true;
  await downloadModel(currentModel());
  modelDlBtn.disabled = false;
});

function setModel(model) {
  const isPreset = $$("option", modelPreset).some((o) => o.value === model && o.value !== CUSTOM);
  modelPreset.value = isPreset ? model : CUSTOM;
  modelInput.value = isPreset ? "" : model;
  customModelField.hidden = isPreset;
  updateFamily(false);
}

function activeRatio() {
  return $("button.active", ratioSeg)?.dataset.ratio || null;
}

function syncRatioFromSize() {
  const family = familyOf(currentModel());
  const w = Number(widthInput.value);
  const h = Number(heightInput.value);
  const match = Object.entries(SIZES[family]).find(([, [rw, rh]]) => rw === w && rh === h);
  for (const btn of $$("button", ratioSeg)) btn.classList.toggle("active", !!match && btn.dataset.ratio === match[0]);
  sizeText.textContent = `${w || "--"} × ${h || "--"}`;
}

function applyRatio(ratio) {
  const [w, h] = SIZES[familyOf(currentModel())][ratio];
  widthInput.value = w;
  heightInput.value = h;
  syncRatioFromSize();
}

let lastFamily = null;
function updateFamily(announce = true) {
  const family = familyOf(currentModel());
  if (lastFamily && lastFamily !== family) {
    const ratio = activeRatio() || "1:1";
    const [w, h] = SIZES[family][ratio];
    widthInput.value = w;
    heightInput.value = h;
    if (announce) {
      const d = familyDefaults[family];
      if (d) {
        setPair(stepsInput, stepsRange, d.steps);
        setPair(guidanceInput, guidanceRange, d.guidance_scale);
      }
      const lora = loraRecords.find((r) => r.path === loraPathInput.value.trim());
      const cleared = !!(lora && lora.family && lora.family !== family);
      if (cleared) setLora("");
      toast(`已切换到 ${FAMILY_LABELS[family]}：${w} × ${h} · ${d?.steps} 步 · CFG ${d?.guidance_scale}${cleared ? "，不匹配的 LoRA 已清空" : ""}`, "info", 3500);
    }
  }
  lastFamily = family;
  familyTag.textContent = FAMILY_LABELS[family] || family;
  familyTag.classList.toggle("primary", family !== "sd15");
  negHint.hidden = family !== "zimage";
  syncRatioFromSize();
  renderLoraOptions();
  updateLoraHint();
  updateModelPanel();
  updateParamHint();
  updateStrengthNote();
  updateCountNote();
}

// 步数 / CFG 偏离当前模型的推荐值时，给出提示和一键恢复
function updateParamHint() {
  const family = familyOf(currentModel());
  const d = familyDefaults[family];
  if (!d) {
    paramHint.hidden = true;
    return;
  }
  const steps = Number(stepsInput.value);
  const cfg = Number(guidanceInput.value);
  const off = steps !== d.steps || Math.abs(cfg - d.guidance_scale) > 0.01;
  paramHint.hidden = !off;
  if (!off) return;
  const why = family === "zimage" && cfg > 1 ? "Turbo 加 CFG 会让画面过曝发闷、速度减半。" : "";
  paramHintText.textContent = `${FAMILY_LABELS[family]} 推荐 ${d.steps} 步 · CFG ${d.guidance_scale}。${why}`;
}

function updateLoraHint() {
  const path = loraPathInput.value.trim();
  const hasLora = !!path;
  loraScaleInput.disabled = !hasLora;
  loraScaleRange.disabled = !hasLora;
  const family = familyOf(currentModel());
  const record = loraRecords.find((r) => r.path === path);
  const loraFamily = record?.family || (/sd15|sd_15|sd-1-5/i.test(path) ? "sd15" : null);
  const mismatch = !!(hasLora && loraFamily && loraFamily !== family);
  loraHint.hidden = !mismatch;
  loraHint.textContent = mismatch
    ? `这个 LoRA 是 ${FAMILY_LABELS[loraFamily]} 的，和当前 ${FAMILY_LABELS[family]} 模型不匹配，生成会报错或画面异常。`
    : "";
}

function renderLoraOptions() {
  const family = familyOf(currentModel());
  const keep = loraPathInput.value.trim();
  const matching = loraRecords.filter((r) => !r.family || r.family === family);
  const option = (r) =>
    `<option value="${escapeHtml(r.path)}" title="${escapeHtml(r.path)}">${escapeHtml(r.display_name || r.name)}（${r.size_mb} MB）</option>`;
  let html = `<option value="">不使用 LoRA</option>`;
  html += matching.length
    ? matching.map(option).join("")
    : `<option value="" disabled>还没有 ${FAMILY_LABELS[family]} 的 LoRA，点「浏览 LoRA 库」下载</option>`;
  // 正在用但不匹配的 LoRA 也留在列表里，方便看到提醒
  const current = loraRecords.find((r) => r.path === keep && r.family && r.family !== family);
  if (current) html += `<optgroup label="其他模型的 LoRA">${option(current)}</optgroup>`;
  loraSelect.innerHTML = html;
  loraSelect.value = keep && $$("option", loraSelect).some((o) => o.value === keep) ? keep : "";
}

function addTrigger(trigger) {
  if (!trigger) return false;
  const text = promptInput.value;
  if (text.toLowerCase().includes(trigger.toLowerCase())) return false;
  promptInput.value = text.trim() ? `${trigger}, ${text.trim()}` : trigger;
  return true;
}

function chooseLora(path, { announce = true } = {}) {
  setLora(path);
  const record = loraRecords.find((r) => r.path === path);
  if (record && isNum(record.weight)) setPair(loraScaleInput, loraScaleRange, record.weight);
  const added = addTrigger(record?.trigger);
  if (announce && record) {
    toast(added ? `已选用 ${record.display_name}，触发词「${record.trigger}」已加到提示词开头` : `已选用 ${record.display_name}`, "info", 3500);
  }
  saveForm();
}

function setLora(path) {
  loraPathInput.value = path;
  if (path && !$$("option", loraSelect).some((o) => o.value === path)) renderLoraOptions();
  loraSelect.value = path && $$("option", loraSelect).some((o) => o.value === path) ? path : "";
  updateLoraHint();
}

/* ---------------- 表单状态 ---------------- */
function readNumber(input) {
  const value = input.value.trim();
  return value === "" ? null : Number(value);
}

function formPayload() {
  return {
    prompt: promptInput.value.trim(),
    negative_prompt: negativeInput.value.trim(),
    model: currentModel(),
    lora_path: loraPathInput.value.trim(),
    lora_scale: Number(loraScaleInput.value),
    width: readNumber(widthInput),
    height: readNumber(heightInput),
    steps: readNumber(stepsInput),
    guidance_scale: readNumber(guidanceInput),
    seed: readNumber(seedInput),
    strength: readStrength(),
  };
}

function readStrength() {
  const value = Number(strengthInput.value);
  return Number.isFinite(value) && value > 0 ? Math.max(0.05, Math.min(1, value)) : 0.6;
}

function readCount() {
  const value = Math.round(Number(countInput.value));
  return Number.isFinite(value) ? Math.max(1, Math.min(8, value)) : 1;
}

function saveForm() {
  store.set(FORM_KEY, {
    ...formPayload(),
    prompt: promptInput.value,
    negative_prompt: negativeInput.value,
    cn: cnPrompt.value,
    style: promptStyle.value,
    mode: promptMode(),
    count: readCount(),
    // 新选的参考图还只在浏览器里（data URL 太大不存），生成过一次、服务器存下后才记住
    init_image: refImage?.src.startsWith("/outputs/") ? refImage.src : "",
  });
}

function applyParams(params, { includeSeed = true } = {}) {
  if (params.prompt != null) promptInput.value = params.prompt;
  if (params.negative_prompt != null) negativeInput.value = params.negative_prompt;
  if (params.model) setModel(params.model);
  if (params.lora_path != null) setLora(params.lora_path);
  if (isNum(params.lora_scale)) setPair(loraScaleInput, loraScaleRange, params.lora_scale);
  if (isNum(params.width)) widthInput.value = params.width;
  if (isNum(params.height)) heightInput.value = params.height;
  if (isNum(params.steps)) setPair(stepsInput, stepsRange, params.steps);
  if (isNum(params.guidance_scale)) setPair(guidanceInput, guidanceRange, params.guidance_scale);
  if (includeSeed) seedInput.value = isNum(params.seed) ? params.seed : "";
  if (isNum(params.strength)) setPair(strengthInput, strengthRange, params.strength);
  if (isNum(params.count)) setPair(countInput, countRange, params.count);
  setRef(params.init_image || null);
  lastFamily = familyOf(currentModel());
  updateFamily(false);
  saveForm();
}

function restoreForm() {
  const saved = store.get(FORM_KEY, null);
  if (!saved) {
    // 第一次打开：默认 Z-Image Turbo + 推荐参数（HTML 里已经填好 1024 / 9 步 / CFG 0）
    setModel(modelPreset.value);
    return;
  }
  applyParams(saved);
  cnPrompt.value = saved.cn || "";
  promptStyle.value = saved.style || "";
  setPromptMode(saved.mode || "en");
}

function setPair(numberInput, rangeInput, value) {
  numberInput.value = value;
  rangeInput.value = value;
}

function bindPair(numberInput, rangeInput) {
  rangeInput.addEventListener("input", () => {
    numberInput.value = rangeInput.value;
  });
  numberInput.addEventListener("input", () => {
    if (numberInput.value !== "") rangeInput.value = numberInput.value;
  });
}
bindPair(loraScaleInput, loraScaleRange);
bindPair(stepsInput, stepsRange);
bindPair(guidanceInput, guidanceRange);
bindPair(strengthInput, strengthRange);
bindPair(countInput, countRange);
for (const el of [stepsInput, stepsRange, guidanceInput, guidanceRange]) el.addEventListener("input", () => updateParamHint());
for (const el of [stepsInput, stepsRange, strengthInput, strengthRange]) el.addEventListener("input", () => updateStrengthNote());
for (const el of [countInput, countRange, seedInput]) el.addEventListener("input", () => updateCountNote());
paramResetBtn.addEventListener("click", () => {
  const d = familyDefaults[familyOf(currentModel())];
  if (!d) return;
  setPair(stepsInput, stepsRange, d.steps);
  setPair(guidanceInput, guidanceRange, d.guidance_scale);
  updateParamHint();
  updateStrengthNote();
  saveForm();
  toast(`已恢复推荐：${d.steps} 步 · CFG ${d.guidance_scale}`);
});

/* ---------------- 参考图（图生图） / 张数 ---------------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = src;
  });
}

function renderRef() {
  const on = !!refImage;
  refDrop.hidden = on;
  refBox.hidden = !on;
  strengthField.hidden = !on;
  refTag.textContent = on ? "图生图" : "文生图";
  refTag.classList.toggle("primary", on);
  if (on) {
    refThumb.src = refImage.src;
    refSize.textContent = `${refImage.width} × ${refImage.height}`;
  } else {
    refThumb.removeAttribute("src");
  }
  updateStrengthNote();
}

// 图生图跳过开头的 步数 × (1 − 重绘幅度) 步（向下取整），只跑剩下的，和管线、后端算法一致
function updateStrengthNote() {
  const steps = Number(stepsInput.value) || 0;
  const real = steps - Math.floor(Math.max(steps - steps * readStrength(), 0));
  strengthNote.textContent = `越小越接近原图，越大越自由发挥 · 实际去噪 ${real} / ${steps} 步`;
}

function updateCountNote() {
  const count = readCount();
  const seed = readNumber(seedInput);
  countNote.hidden = count < 2;
  if (count < 2) return;
  countNote.textContent =
    seed == null ? "逐张生成，每张用不同的随机 Seed，显存占用不变。" : `逐张生成，Seed 从 ${seed} 起每张加 1，显存占用不变。`;
}

// 参考图和哪个预设比例最接近，就把画面尺寸切过去，裁掉的最少
function fitRatioToRef() {
  if (!refImage) return;
  const target = Math.log(refImage.width / refImage.height);
  const off = (entry) => Math.abs(Math.log(entry[1][0] / entry[1][1]) - target);
  const [ratio] = Object.entries(SIZES[familyOf(currentModel())]).reduce((best, entry) => (off(entry) < off(best) ? entry : best));
  if (activeRatio() !== ratio) {
    applyRatio(ratio);
    toast(`已按参考图把画面比例切到 ${ratio}`, "info", 3000);
  }
}

async function setRef(src, { fit = false } = {}) {
  const token = ++refToken;
  if (!src) {
    refImage = null;
    renderRef();
    return;
  }
  try {
    const img = await loadImage(src);
    if (token !== refToken) return;
    refImage = { src, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    if (token !== refToken) return;
    refImage = null;
    toast("参考图已经不存在，已改回文生图", "error", 3500);
  }
  renderRef();
  if (refImage && fit) fitRatioToRef();
  saveForm();
}

// 上传前在浏览器里把长边压到 2048 以内，传输小、也足够图生图用
async function useRefFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("请选择图片文件", "error");
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    await setRef(canvas.toDataURL("image/png"), { fit: true });
  } catch {
    toast("这张图片浏览器读不了，换一张试试", "error");
  } finally {
    URL.revokeObjectURL(url);
  }
}

refDrop.addEventListener("click", () => refFile.click());
refChangeBtn.addEventListener("click", () => refFile.click());
refClearBtn.addEventListener("click", () => {
  setRef(null);
  saveForm();
});
refFile.addEventListener("change", () => {
  useRefFile(refFile.files[0]);
  refFile.value = "";
});
for (const zone of [refDrop, refBox]) {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("is-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-over");
    useRefFile(event.dataTransfer.files[0]);
  });
}
document.addEventListener("paste", (event) => {
  if ($(".modal-overlay")) return;
  const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
  if (!file) return;
  event.preventDefault();
  useRefFile(file);
});

/* ---------------- 提示词模式 ---------------- */
function promptMode() {
  return $("button.active", promptModeSeg)?.dataset.mode || "en";
}
function setPromptMode(mode) {
  for (const btn of $$("button", promptModeSeg)) btn.classList.toggle("active", btn.dataset.mode === mode);
  promptHelper.hidden = mode !== "cn";
}
promptModeSeg.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-mode]");
  if (!btn) return;
  setPromptMode(btn.dataset.mode);
  if (btn.dataset.mode === "cn") cnPrompt.focus();
  saveForm();
});

async function optimizePrompt() {
  const text = cnPrompt.value.trim();
  if (!text) {
    toast("先写一句中文描述", "error");
    cnPrompt.focus();
    return;
  }
  optimizePromptBtn.disabled = true;
  $(".btn-text", optimizePromptBtn).textContent = "转写中…";
  llmBusy = true;
  // 模型不在显存里时（刚出过图）要先加载几秒
  promptHelperStatus.textContent = llmSettings?.state === "ready" ? "本地模型转写中…" : "本地模型加载并转写中…";
  promptNotes.hidden = true;
  try {
    const response = await fetch("/api/prompt/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, style: promptStyle.value.trim(), target_model: currentModel() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "提示词优化失败");
    promptInput.value = data.prompt || "";
    // Z-Image 不用反向提示词，返回空时也清掉旧的，避免误会
    negativeInput.value = data.negative_prompt || (familyOf(currentModel()) === "zimage" ? "" : negativeInput.value);
    promptHelperStatus.textContent = `已完成 · ${data.model || "本地模型"}`;
    promptNotes.textContent = data.notes || "";
    promptNotes.hidden = !data.notes;
    saveForm();
    toast("已写入英文提示词", "success");
  } catch (error) {
    promptHelperStatus.textContent = "转写失败";
    promptNotes.textContent = error.message || "提示词优化失败。";
    promptNotes.hidden = false;
    toast("提示词优化失败", "error");
  } finally {
    llmBusy = false;
    optimizePromptBtn.disabled = false;
    $(".btn-text", optimizePromptBtn).textContent = "转写为英文提示词";
  }
}
optimizePromptBtn.addEventListener("click", optimizePrompt);

/* ---------------- 本地 LLM 状态 ---------------- */
let llmSettings = null;
let llmBusy = false;
const LLM_STATE_TEXT = { ready: "已就绪", loading: "加载中…", stopped: "待命，点转写时自动加载", missing: "不可用" };

async function refreshSettings() {
  const response = await fetch("/api/settings");
  const data = await response.json();
  llmSettings = data.llm;
  if (llmBusy) return;
  promptHelperStatus.textContent = `${llmSettings.model} · 本地 · ${LLM_STATE_TEXT[llmSettings.state] || ""}`;
  promptHelperStatus.title = llmSettings.detail || "";
}
/* ---------------- 生成 ---------------- */
function setEngine(state, text) {
  engineDot.className = `dot ${state}`;
  engineText.textContent = text;
}

function idleEngineText() {
  return engine.loadedModel ? `空闲 · 已加载 ${modelLabel(engine.loadedModel)}` : "空闲 · 未加载模型";
}

function setBusy(busy) {
  isBusy = busy;
  generateBtn.disabled = busy;
  generateBtn.innerHTML = busy ? '<span class="spinner"></span>生成中…' : "生成图片";
  const multi = busy && !!batch && batch.count > 1;
  stopBatchBtn.hidden = !multi;
  stopBatchBtn.disabled = false;
  stopBatchBtn.textContent = "这张完成后停止";
  kbdHint.hidden = multi;
  stage.classList.toggle("is-busy", busy);
  clearInterval(busyTimer);
  if (busy) {
    const started = Date.now();
    const model = currentModel();
    lastProgress = null;
    busyBar.style.width = "0%";
    const tick = () => {
      const s = Math.floor((Date.now() - started) / 1000);
      const p = lastProgress;
      const needsLoad = engine.loadedModel !== model;
      const nth = batch && batch.count > 1 ? `第 ${batch.index} / ${batch.count} 张 · ` : "";
      if (p?.phase === "denoising" && p.total) {
        busyText.textContent = `${nth}第 ${p.step} / ${p.total} 步 · ${s}s`;
        busyBar.style.width = `${(p.step / p.total) * 100}%`;
        $(".busy-sub", stage).hidden = true;
      } else if (p?.phase === "saving") {
        busyText.textContent = `${nth}解码保存中 · ${s}s`;
        busyBar.style.width = "100%";
      } else {
        busyText.textContent = `${nth}${needsLoad ? "加载模型中" : "准备中"} · ${s}s`;
      }
      setEngine("busy", `生成中 · ${s}s`);
    };
    $(".busy-sub", stage).hidden = engine.loadedModel === model;
    tick();
    busyTimerTick = tick;
    busyTimer = setInterval(tick, 1000);
  } else {
    setEngine(engine.ready ? "ok" : "err", engine.ready ? idleEngineText() : "环境未就绪");
  }
}

function renderResultMeta(params) {
  if (!params) {
    resultMeta.innerHTML = "";
    return;
  }
  const tags = [
    modelLabel(params.model),
    params.lora_path ? `LoRA ${params.lora_path.split("/").pop().replace(/\.\w+$/, "")} × ${params.lora_scale}` : null,
    `${params.width} × ${params.height}`,
    `${params.steps} 步`,
    `CFG ${params.guidance_scale}`,
    params.init_image ? `图生图 · 幅度 ${params.strength}` : null,
    `Seed ${params.seed}`,
    isNum(params.seconds) ? `${params.seconds.toFixed(1)}s` : null,
  ].filter(Boolean);
  resultMeta.innerHTML = tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
}

function showPreview(url, params) {
  const name = url.split("/").pop();
  currentResult = { url, name, seed: params.seed };
  preview.innerHTML = "";
  const image = document.createElement("img");
  image.src = `${url}?t=${Date.now()}`;
  image.alt = params.prompt || "生成图片";
  image.addEventListener("click", () => {
    const index = images.findIndex((item) => item.name === name);
    if (index >= 0) openLightbox(index);
  });
  preview.appendChild(image);
  downloadLink.href = url;
  downloadLink.setAttribute("download", name);
  downloadLink.classList.remove("is-disabled");
  useSeedBtn.disabled = false;
  useRefBtn.disabled = false;
  renderResultMeta(params);
}

function resetPreview(message = "写好提示词，点「生成图片」") {
  currentResult = null;
  preview.innerHTML = `<div class="empty">${icon("image", 34)}<p>${escapeHtml(message)}</p></div>`;
  downloadLink.href = "#";
  downloadLink.classList.add("is-disabled");
  useSeedBtn.disabled = true;
  useRefBtn.disabled = true;
  renderResultMeta(null);
}

async function requestGenerate(payload) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join("；") : data.detail;
    throw new Error(detail || "生成失败");
  }
  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isBusy) return;
  const base = formPayload();
  if (!base.prompt) {
    toast("先写提示词", "error");
    promptInput.focus();
    return;
  }
  const preset = models.find((m) => m.id === base.model);
  if (preset?.downloadable && !preset.installed) {
    toast(`${preset.label} 还没下载，先点「下载模型」`, "error", 3500);
    return;
  }
  const usedRef = refImage;
  base.init_image = usedRef ? usedRef.src : "";
  const count = readCount();
  // 同一次生成的几张共用一个批次号，历史里折叠成一组
  base.batch = count > 1 ? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : "";
  saveForm();
  stopRequested = false;
  batch = { index: 1, count };
  setBusy(true);
  let done = 0;
  let totalSeconds = 0;
  try {
    // 多张是一张一张地生成：显存占用不变，每张有自己的 Seed，出一张显示一张
    for (let i = 0; i < count && !stopRequested; i += 1) {
      batch.index = i + 1;
      lastProgress = null;
      busyTimerTick?.();
      const payload = { ...base, seed: base.seed == null ? null : (base.seed + i) % 2 ** 32 };
      const data = await requestGenerate(payload);
      done += 1;
      totalSeconds += Number(data.seconds) || 0;
      engine.loadedModel = payload.model;
      if (data.init_image) {
        // 参考图已存到服务器，后面几张不用重复上传
        base.init_image = data.init_image;
        if (usedRef && refImage === usedRef) {
          refImage.src = data.init_image;
          saveForm();
        }
      }
      showPreview(data.url, { ...payload, init_image: data.init_image, seed: data.seed, seconds: data.seconds });
      images = data.images || [];
      renderGallery();
      updateLastRun(data.gpu_metrics);
      const saved = `已保存到 outputs/${data.url.split("/").pop()}`;
      runInfo.textContent = count > 1 ? `第 ${done} / ${count} 张 · ${saved}` : saved;
    }
    if (count > 1) toast(`${done < count ? "已停止 · " : ""}生成了 ${done} 张 · 共 ${totalSeconds.toFixed(1)}s`, "success", 3500);
    else toast(`生成完成 · ${totalSeconds.toFixed(1)}s`, "success");
  } catch (error) {
    if (done) {
      // 前面几张已经保存，保留最后一张的预览，只提示出错的这张
      runInfo.textContent = `第 ${done + 1} 张生成失败：${error.message}`;
      toast(`第 ${done + 1} 张生成失败，前 ${done} 张已保存`, "error", 4500);
    } else {
      currentResult = null;
      preview.innerHTML = `<div class="empty err">${icon("alert", 30)}<p>${escapeHtml(error.message)}</p></div>`;
      useSeedBtn.disabled = true;
      useRefBtn.disabled = true;
      renderResultMeta(null);
      runInfo.textContent = "生成失败。";
      toast("生成失败", "error");
    }
  } finally {
    batch = null;
    setBusy(false);
  }
});

stopBatchBtn.addEventListener("click", () => {
  stopRequested = true;
  stopBatchBtn.disabled = true;
  stopBatchBtn.textContent = "这张完成后就停";
});

useRefBtn.addEventListener("click", () => {
  if (!currentResult) return;
  setRef(currentResult.url);
  toast("已把这张图设为参考图");
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !$(".modal-overlay")) {
    event.preventDefault();
    form.requestSubmit();
  }
});

useSeedBtn.addEventListener("click", () => {
  if (!currentResult) return;
  seedInput.value = currentResult.seed;
  saveForm();
  toast(`已固定 Seed ${currentResult.seed}`);
});

seedRandomBtn.addEventListener("click", () => {
  seedInput.value = "";
  saveForm();
  toast("Seed 已改回随机");
});

/* ---------------- 历史 ---------------- */
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function thumbHtml({ item, index }) {
  return `
      <article class="thumb">
        <div class="thumb-media" role="button" tabindex="0" data-index="${index}" title="${escapeHtml(item.prompt || item.name)}">
          <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.prompt || item.name)}" loading="lazy" />
          <div class="thumb-actions">
            <button class="thumb-act" type="button" data-act="reuse" data-index="${index}" title="复用参数">${icon("reuse", 14)}</button>
            <button class="thumb-act del" type="button" data-act="delete" data-index="${index}" title="删除">${icon("trash", 14)}</button>
          </div>
        </div>
        <div class="thumb-meta">
          <div class="thumb-prompt">${escapeHtml(item.prompt || "无提示词")}</div>
          <div class="thumb-time">${escapeHtml(formatTime(item.created_at))}</div>
        </div>
      </article>`;
}

// 同一次生成的几张叠成一摞（最上面是最新的那张，后面露出另外两张），点击像打开文件夹一样弹出
function stackHtml(group) {
  const n = group.items.length;
  const key = escapeHtml(group.key);
  const { item, index } = group.items[0];
  const layer = (entry, cls) => (entry ? `<img class="stack-layer ${cls}" src="${escapeHtml(entry.item.url)}" alt="" loading="lazy" />` : "");
  return `
      <article class="thumb thumb-stack">
        <div class="stack-wrap">
          ${layer(group.items[2], "l2")}
          ${layer(group.items[1], "l1")}
          <div class="thumb-media" role="button" tabindex="0" data-group="${key}" title="同一次生成的 ${n} 张，点击打开">
            <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.prompt || item.name)}" loading="lazy" />
            <span class="stack-badge">${n} 张</span>
            <div class="thumb-actions">
              <button class="thumb-act" type="button" data-act="reuse" data-index="${index}" title="复用参数">${icon("reuse", 14)}</button>
              <button class="thumb-act del" type="button" data-act="delete-group" data-group="${key}" title="删除这 ${n} 张">${icon("trash", 14)}</button>
            </div>
          </div>
        </div>
        <div class="thumb-meta">
          <div class="thumb-prompt">${escapeHtml(item.prompt || "无提示词")}</div>
          <div class="thumb-time">${escapeHtml(formatTime(item.created_at))}</div>
        </div>
      </article>`;
}

function renderGallery() {
  galleryCount.textContent = images.length ? `最近 ${images.length} 张 · 点击查看大图和参数` : "还没有图片";
  if (!images.length) {
    gallery.innerHTML = `<div class="empty">${icon("image", 30)}<p>生成的图片会出现在这里</p></div>`;
  } else {
    gallery.innerHTML = galleryGroups()
      .map((group) => (group.items.length < 2 ? thumbHtml(group.items[0]) : stackHtml(group)))
      .join("");
  }
  folderRender?.();
}

let folderRender = null; // 分组弹窗打开时的重绘函数

// 把相邻且批次相同的图片归成一组
function galleryGroups() {
  const groups = [];
  images.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (item.group && last && last.key === item.group) last.items.push({ item, index });
    else groups.push({ key: item.group || "", items: [{ item, index }] });
  });
  return groups;
}

// 图片缩略图上的点击：操作按钮、打开分组、看大图（历史区和分组弹窗共用）
function handleThumbClick(event, { afterReuse } = {}) {
  const act = event.target.closest("[data-act]");
  if (act) {
    if (act.dataset.act === "delete-group") {
      deleteGroup(act.dataset.group);
      return true;
    }
    const item = images[Number(act.dataset.index)];
    if (!item) return false;
    if (act.dataset.act === "delete") deleteImage(item.name);
    else if (act.dataset.act === "reuse") reuseParams(item.name).then((ok) => ok && afterReuse?.());
    else return false;
    return true;
  }
  const media = event.target.closest(".thumb-media");
  if (!media) return false;
  if (media.dataset.group) openFolder(media.dataset.group);
  else openLightbox(Number(media.dataset.index));
  return true;
}

gallery.addEventListener("click", (event) => handleThumbClick(event));
gallery.addEventListener("keydown", (event) => {
  const media = event.target.closest(".thumb-media");
  if (media && (event.key === "Enter" || event.key === " ") && event.target === media) {
    event.preventDefault();
    if (media.dataset.group) openFolder(media.dataset.group);
    else openLightbox(Number(media.dataset.index));
  }
});

function openFolder(key) {
  const modal = document.createElement("div");
  modal.className = "modal folder";
  modal.innerHTML = `
    <div class="modal-header">
      <span class="folder-title"></span>
      <button class="modal-x" type="button" data-act="close" title="关闭 (Esc)">${icon("x", 15)}</button>
    </div>
    <div class="folder-prompt"></div>
    <div class="folder-body"><div class="group-grid"></div></div>
    <div class="modal-footer">
      <button class="btn btn-danger" type="button" data-act="delete-group" data-group="${escapeHtml(key)}">${icon("trash", 15)}删除这组</button>
      <button class="btn" type="button" data-act="close">关闭</button>
    </div>`;
  const render = () => {
    const items = images.map((item, index) => ({ item, index })).filter((entry) => entry.item.group === key);
    if (!items.length) {
      close();
      return;
    }
    $(".folder-title", modal).textContent = `同一次生成 · ${items.length} 张`;
    $(".folder-prompt", modal).textContent = items[0].item.prompt || "无提示词";
    $(".group-grid", modal).innerHTML = items.map(thumbHtml).join("");
  };
  const closeModal = openModal(modal);
  const close = () => {
    if (folderRender === render) folderRender = null;
    closeModal();
  };
  // Esc 或点遮罩关闭时也要注销重绘函数
  new MutationObserver((_, observer) => {
    if (!modal.isConnected) {
      if (folderRender === render) folderRender = null;
      observer.disconnect();
    }
  }).observe(document.body, { childList: true });
  modal.addEventListener("click", (event) => {
    if (event.target.closest('[data-act="close"]')) close();
    else handleThumbClick(event, { afterReuse: close });
  });
  folderRender = render;
  render();
}

async function deleteGroup(key) {
  const names = images.filter((item) => item.group === key).map((item) => item.name);
  if (!names.length) return;
  const ok = await confirmDialog({
    title: `删除这 ${names.length} 张图片？`,
    message: "同一次生成的这几张图片和它们的参数记录会从 outputs 目录删除，无法恢复。",
  });
  if (!ok) return;
  let removed = 0;
  try {
    for (const name of names) {
      const response = await fetch(`/api/images/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "删除失败");
      removed += 1;
      images = data.images || [];
      metaCache.delete(name);
      if (currentResult?.name === name) resetPreview("当前图片已删除");
    }
    toast(`已删除 ${removed} 张`, "success");
  } catch (error) {
    toast(`${error.message || "删除失败"}${removed ? `，已删除 ${removed} 张` : ""}`, "error", 3500);
  } finally {
    renderGallery();
  }
}

async function loadMeta(name) {
  if (metaCache.has(name)) return metaCache.get(name);
  const response = await fetch(`/outputs/${encodeURIComponent(name.replace(/\.png$/i, ".json"))}`);
  if (!response.ok) throw new Error("这张图没有参数记录");
  const meta = await response.json();
  metaCache.set(name, meta);
  return meta;
}

async function reuseParams(name) {
  try {
    const meta = await loadMeta(name);
    applyParams(meta);
    toast(`已载入参数 · Seed ${meta.seed}`, "success");
    return true;
  } catch (error) {
    toast(error.message || "读取参数失败", "error");
    return false;
  }
}

async function deleteImage(name) {
  const ok = await confirmDialog({ title: "删除这张图片？", message: `${name} 和它的参数记录会从 outputs 目录删除，无法恢复。` });
  if (!ok) return false;
  try {
    const response = await fetch(`/api/images/${encodeURIComponent(name)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "删除失败");
    images = data.images || [];
    metaCache.delete(name);
    renderGallery();
    if (currentResult?.name === name) resetPreview("当前图片已删除");
    toast("已删除", "success");
    return true;
  } catch (error) {
    toast(error.message || "删除失败", "error");
    return false;
  }
}

/* ---------------- 大图查看 ---------------- */
// 滚轮以鼠标位置为中心缩放，放大后可拖动平移，双击在 100% 和 250% 之间切换
function attachZoom(stageEl, img) {
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let drag = null;
  const badge = document.createElement("div");
  badge.className = "zoom-badge";
  stageEl.appendChild(badge);
  img.draggable = false;

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    const zoomed = scale > 1.001;
    stageEl.classList.toggle("is-zoomed", zoomed);
    badge.textContent = `${Math.round(scale * 100)}%`;
    badge.classList.toggle("show", zoomed);
  };
  const zoomAt = (clientX, clientY, next) => {
    next = Math.min(10, Math.max(1, next));
    const rect = stageEl.getBoundingClientRect();
    const px = clientX - (rect.left + rect.width / 2);
    const py = clientY - (rect.top + rect.height / 2);
    tx = px - (px - tx) * (next / scale);
    ty = py - (py - ty) * (next / scale);
    scale = next;
    if (scale <= 1.001) {
      scale = 1;
      tx = 0;
      ty = 0;
    }
    apply();
  };
  stageEl.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, scale * Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false },
  );
  stageEl.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    zoomAt(event.clientX, event.clientY, scale > 1.001 ? 1 : 2.5);
  });
  img.addEventListener("pointerdown", (event) => {
    if (scale <= 1.001) return;
    event.preventDefault();
    drag = { x: event.clientX - tx, y: event.clientY - ty };
    img.setPointerCapture(event.pointerId);
    stageEl.classList.add("is-dragging");
  });
  img.addEventListener("pointermove", (event) => {
    if (!drag) return;
    tx = event.clientX - drag.x;
    ty = event.clientY - drag.y;
    apply();
  });
  const endDrag = () => {
    drag = null;
    stageEl.classList.remove("is-dragging");
  };
  img.addEventListener("pointerup", endDrag);
  img.addEventListener("pointercancel", endDrag);
  return {
    reset() {
      scale = 1;
      tx = 0;
      ty = 0;
      apply();
    },
    zoomBy(factor) {
      const rect = stageEl.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale * factor);
    },
  };
}

function openLightbox(startIndex) {
  let index = startIndex;
  const modal = document.createElement("div");
  modal.className = "modal lightbox";
  modal.innerHTML = `
    <div class="modal-header">
      <span class="lb-title">图片详情</span>
      <button class="modal-x" type="button" data-act="close" title="关闭 (Esc)">${icon("x", 15)}</button>
    </div>
    <div class="lb-body">
      <div class="lb-stage">
        <img alt="" />
        <button class="lb-nav prev" type="button" data-act="prev" title="上一张 (←)">${icon("left", 18)}</button>
        <button class="lb-nav next" type="button" data-act="next" title="下一张 (→)">${icon("right", 18)}</button>
        <div class="zoom-hint">滚轮缩放 · 拖动平移 · 双击放大 / 还原</div>
      </div>
      <div class="lb-info"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-danger" type="button" data-act="delete">${icon("trash", 15)}删除</button>
      <a class="btn" data-act="download" download>${icon("download", 15)}下载</a>
      <button class="btn" type="button" data-act="ref">${icon("image", 15)}作为参考图</button>
      <button class="btn btn-primary" type="button" data-act="reuse">${icon("reuse", 15)}复用参数</button>
    </div>`;
  const img = $("img", modal);
  const info = $(".lb-info", modal);
  const title = $(".lb-title", modal);
  const zoom = attachZoom($(".lb-stage", modal), img);

  const render = async () => {
    const item = images[index];
    if (!item) {
      close();
      return;
    }
    zoom.reset();
    img.src = item.url;
    img.alt = item.prompt || item.name;
    title.textContent = `图片详情 · ${index + 1} / ${images.length}`;
    $('[data-act="download"]', modal).href = item.url;
    $('[data-act="download"]', modal).setAttribute("download", item.name);
    $('[data-act="prev"]', modal).disabled = index <= 0;
    $('[data-act="next"]', modal).disabled = index >= images.length - 1;
    info.innerHTML = `<div class="lb-block-title">${escapeHtml(item.name)}</div><div class="muted">读取参数中…</div>`;
    try {
      const meta = await loadMeta(item.name);
      if (images[index]?.name !== item.name) return;
      info.innerHTML = `
        <div><div class="lb-block-title">正向提示词</div><div class="prompt-box">${escapeHtml(meta.prompt || "")}</div></div>
        <div><div class="lb-block-title">反向提示词</div><div class="prompt-box ${meta.negative_prompt ? "" : "muted"}">${escapeHtml(meta.negative_prompt || "无")}</div></div>
        <dl class="kv">
          <dt>模型</dt><dd>${escapeHtml(modelLabel(meta.model))}</dd>
          <dt>LoRA</dt><dd>${meta.lora_path ? `${escapeHtml(meta.lora_path.split("/").pop())} × ${escapeHtml(meta.lora_scale)}` : "无"}</dd>
          <dt>尺寸</dt><dd>${escapeHtml(meta.width)} × ${escapeHtml(meta.height)}</dd>
          <dt>步数</dt><dd>${escapeHtml(meta.steps)} 步 · CFG ${escapeHtml(meta.guidance_scale)}</dd>
          ${meta.init_image ? `<dt>图生图</dt><dd>重绘幅度 ${escapeHtml(meta.strength)}</dd>` : ""}
          <dt>Seed</dt><dd>${escapeHtml(meta.seed)}</dd>
          <dt>耗时</dt><dd>${isNum(meta.seconds) ? `${meta.seconds.toFixed(1)}s` : "--"}</dd>
          <dt>时间</dt><dd>${escapeHtml(formatTime(item.created_at))}</dd>
        </dl>`;
    } catch (error) {
      info.innerHTML = `<div class="lb-block-title">${escapeHtml(item.name)}</div><div class="muted">${escapeHtml(error.message)}</div>`;
    }
  };

  const move = (delta) => {
    const next = index + delta;
    if (next < 0 || next >= images.length) return;
    index = next;
    render();
  };

  const close = openModal(modal, {
    onKey: (event) => {
      if (event.key === "+" || event.key === "=") zoom.zoomBy(1.25);
      if (event.key === "-") zoom.zoomBy(0.8);
      if (event.key === "0") zoom.reset();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    },
  });

  modal.addEventListener("click", async (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "close") close();
    if (act === "prev") move(-1);
    if (act === "next") move(1);
    if (act === "reuse" && (await reuseParams(images[index].name))) close();
    if (act === "ref") {
      setRef(images[index].url);
      toast("已把这张图设为参考图");
      close();
    }
    if (act === "delete") {
      const name = images[index].name;
      if (await deleteImage(name)) {
        if (!images.length) close();
        else {
          index = Math.min(index, images.length - 1);
          render();
        }
      }
    }
  });
  render();
}

/* ---------------- GPU ---------------- */
function updateLastRun(metrics) {
  if (!metrics) return;
  if (metrics.ok === false) {
    lastRunState.textContent = "失败";
    lastSeconds.textContent = isNum(metrics.seconds) ? `${metrics.seconds.toFixed(1)}s` : "--";
    return;
  }
  const peak = metrics.peak_memory?.memory_used_mb;
  const delta = metrics.memory_delta_from_loaded_mb;
  lastRunState.textContent = `${metrics.sample_count || 0} 次采样`;
  lastSeconds.textContent = isNum(metrics.seconds) ? `${metrics.seconds.toFixed(1)}s` : "--";
  lastPeakMemory.textContent = isNum(peak) ? `${formatGb(peak)} GB` : "--";
  lastMemoryDelta.textContent = isNum(delta) ? `${delta >= 0 ? "+" : ""}${Math.round(delta)} MB` : "--";
  lastPeakUtil.textContent = formatPercent(metrics.peak_utilization?.utilization_percent);
}

function updateGpuPanel(data) {
  const gpu = data.gpu || {};
  if (data.progress) {
    lastProgress = data.progress;
    if (isBusy) busyTimerTick?.();
  }
  updateLastRun(data.latest_generation_metrics);
  if (!gpu.available) {
    gpuTimestamp.textContent = gpu.message || "GPU 数据不可用";
    memoryText.textContent = "--";
    utilText.textContent = "--";
    memoryBar.style.width = "0%";
    utilBar.style.width = "0%";
    powerText.textContent = "--";
    tempText.textContent = "--";
    torchText.textContent = "Torch 显存 --";
    return;
  }
  gpuTimestamp.textContent = `${gpu.name || "GPU"} · 每秒刷新`;
  memoryText.textContent =
    isNum(gpu.memory_used_mb) && isNum(gpu.memory_total_mb) ? `${formatGb(gpu.memory_used_mb)} / ${formatGb(gpu.memory_total_mb)} GB` : "--";
  utilText.textContent = formatPercent(gpu.utilization_percent);
  memoryBar.style.width = `${clampPercent(gpu.memory_percent)}%`;
  utilBar.style.width = `${clampPercent(gpu.utilization_percent)}%`;
  powerText.textContent = isNum(gpu.power_w) ? `${Math.round(gpu.power_w)}W` : "--";
  tempText.textContent = isNum(gpu.temperature_c) ? `${Math.round(gpu.temperature_c)}°C` : "--";
  tempText.classList.toggle("warn", isNum(gpu.temperature_c) && gpu.temperature_c >= 83);
  const torch = data.torch_memory || {};
  torchText.textContent = torch.available && isNum(torch.allocated_mb) ? `Torch 显存 ${formatMb(torch.allocated_mb)}` : "Torch 显存 --";
}

/* ---------------- 数据刷新 ---------------- */
async function refreshStatus() {
  refreshSettings().catch(() => {}); // 本地 LLM 的状态跟着一起刷新（出图后它会被换下显存）
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    engine.ready = !!data.ready;
    if (!data.ready) {
      statusText.textContent = data.message || "环境未就绪";
      setEngine("err", "环境未就绪");
      return;
    }
    engine.loadedModel = data.loaded_model || null;
    const parts = [data.device.toUpperCase(), `PyTorch ${data.torch.split("+")[0]}`, data.gpu, data.safety_mode === "diffusers_default" ? "安全过滤开启" : ""];
    statusText.textContent = parts.filter(Boolean).join(" · ");
    if (!isBusy) setEngine("ok", idleEngineText());
  } catch {
    engine.ready = false;
    statusText.textContent = "无法连接后端";
    if (!isBusy) setEngine("err", "后端未连接");
  }
}

async function refreshImages() {
  const response = await fetch("/api/images");
  const data = await response.json();
  images = data.images || [];
  renderGallery();
}

async function refreshLoras() {
  const response = await fetch("/api/loras");
  const data = await response.json();
  loraRecords = data.loras || [];
  renderLoraOptions();
  updateLoraHint();
}

let gpuInFlight = false;
async function refreshGpu() {
  if (gpuInFlight || document.hidden) return;
  gpuInFlight = true;
  try {
    const response = await fetch("/api/gpu");
    updateGpuPanel(await response.json());
  } catch {
    gpuTimestamp.textContent = "GPU 状态刷新失败";
  } finally {
    gpuInFlight = false;
  }
}

function refreshAll() {
  refreshSettings().catch(() => {});
  refreshModels().catch(() => {});
  refreshStatus();
  refreshImages().catch(() => toast("读取历史图片失败", "error"));
  refreshLoras().catch(() => {});
  refreshGpu();
}

refreshBtn.addEventListener("click", () => {
  refreshBtn.classList.remove("spin");
  void refreshBtn.offsetWidth;
  refreshBtn.classList.add("spin");
  refreshAll();
});

/* ---------------- 模型库 / LoRA 库 ---------------- */
let libItems = [];
let libStorage = null;
let libPollTimer = null;
let libRender = null; // 弹窗打开时的重绘函数

async function refreshCatalog() {
  const response = await fetch("/api/loras/catalog");
  const data = await response.json();
  const before = new Map(libItems.map((i) => [i.id, i.job?.status]));
  libItems = data.items || [];
  libStorage = data.storage || libStorage;
  let finished = false;
  for (const item of libItems) {
    if (before.get(item.id) === "downloading" && item.installed) {
      finished = true;
      toast(`${item.name} 下载完成`, "success", 3500);
    }
    if (before.get(item.id) === "downloading" && item.job?.status === "error") toast(`${item.name} 下载失败`, "error", 4000);
  }
  if (finished) await refreshLoras().catch(() => {});
  libRender?.();
  clearTimeout(libPollTimer);
  if (libItems.some((i) => i.job?.status === "downloading")) {
    libPollTimer = setTimeout(() => refreshCatalog().catch(() => {}), 800);
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "请求失败");
  return data;
}

async function downloadCatalogLora(id) {
  try {
    await postJson("/api/loras/download", { id });
  } catch (error) {
    toast(error.message || "下载失败", "error", 4000);
  }
  await refreshCatalog().catch(() => {});
}

async function downloadModel(id) {
  const preset = models.find((m) => m.id === id);
  try {
    await postJson("/api/models/download", { id });
    toast(`开始下载 ${preset?.label || id}`);
  } catch (error) {
    toast(error.message || "下载失败", "error", 4000);
  }
  await refreshModels().catch(() => {});
}

async function deleteLoraFile({ path, name, redownloadable }) {
  const ok = await confirmDialog({
    title: `删除「${name}」？`,
    message: `会删除 ${path}。${redownloadable ? "以后可以在 LoRA 库里重新下载。" : "这个 LoRA 不在内置目录里，删除后无法从这里重新下载。"}`,
    okText: "删除",
  });
  if (!ok) return false;
  try {
    const response = await fetch(`/api/loras/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "删除失败");
    if (loraPathInput.value.trim() === path) setLora("");
    toast(`已删除，释放 ${data.freed_mb} MB`, "success");
  } catch (error) {
    toast(error.message || "删除失败", "error", 4000);
  }
  await refreshLoras().catch(() => {});
  await refreshCatalog().catch(() => {});
  return true;
}

async function deleteModel(model) {
  const message = model.local
    ? `会删除 ${model.path}（${model.disk_gb} GB）。这是你自己放进来的模型，这里无法重新下载，请确认有备份。`
    : `会删除 ${model.path}，释放 ${model.disk_gb} GB。以后需要时可以在模型库里重新下载（约 ${model.size_gb} GB）。`;
  const ok = await confirmDialog({ title: `删除「${model.label}」？`, message, okText: "删除" });
  if (!ok) return false;
  try {
    const response = await fetch(`/api/models?id=${encodeURIComponent(model.id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "删除失败");
    toast(`已删除 ${model.label}，释放 ${data.freed_gb} GB`, "success", 3500);
  } catch (error) {
    toast(error.message || "删除失败", "error", 4000);
  }
  await refreshModels().catch(() => {});
  refreshStatus();
  return true;
}

function switchModel(id) {
  // 直接改下拉框再触发 change，让 updateFamily 按“切换模型”处理（套用推荐步数/CFG、清理不匹配的 LoRA）
  modelPreset.value = id;
  modelPreset.dispatchEvent(new Event("change"));
}

function useCatalogLora(item) {
  if (item.family !== familyOf(currentModel())) {
    // 切到这个 LoRA 对应的模型：优先已下载的
    const candidates = models.filter((m) => m.family === item.family);
    const target = candidates.find((m) => m.installed) || candidates[0];
    if (!target) {
      toast(`没有可用的 ${FAMILY_LABELS[item.family]} 模型`, "error");
      return false;
    }
    switchModel(target.id);
  }
  chooseLora(item.path);
  return true;
}

function sizeLabel(mb) {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function modelCardHtml(m) {
  const job = m.job;
  const downloading = job?.status === "downloading";
  const inUse = currentModel() === m.id;
  let status;
  if (downloading) status = `<span class="dot busy"></span>下载中`;
  else if (m.installed) status = `<span class="dot ok"></span>已下载 · 占用 ${m.disk_gb} GB${m.in_use ? " · 已加载到显存" : ""}`;
  else status = `<span class="dot"></span>未下载 · 约 ${m.size_gb} GB`;

  let actions = "";
  if (downloading) {
    const total = job.total || m.size_gb * 1e9;
    const pct = total ? Math.min(100, (job.downloaded / total) * 100) : 0;
    actions += `<div class="lib-progress"><div class="meter"><span style="width:${pct}%"></span></div>下载中 ${Math.floor(pct)}% · ${formatSize(job.downloaded)} / ${formatSize(total)}</div>`;
  } else if (m.installed) {
    actions += `<button class="btn btn-sm ${inUse ? "" : "btn-primary"}" type="button" data-act="use-model" data-id="${escapeHtml(m.id)}" ${inUse ? "disabled" : ""}>${inUse ? "当前模型" : "使用"}</button>`;
    actions += `<button class="btn btn-sm btn-danger" type="button" data-act="delete-model" data-id="${escapeHtml(m.id)}">${icon("trash", 14)}删除</button>`;
  } else if (m.downloadable) {
    actions += `<button class="btn btn-sm btn-primary" type="button" data-act="download-model" data-id="${escapeHtml(m.id)}">${icon("download", 14)}下载 · ${m.size_gb} GB</button>`;
  } else {
    actions += `<span class="field-note">把文件放到 ${escapeHtml(m.path)} 后刷新即可</span>`;
  }
  if (m.page) actions += `<a class="icon-btn" href="${escapeHtml(m.page)}" target="_blank" rel="noopener" title="在 Hugging Face 查看">${icon("external", 15)}</a>`;
  const err = job?.status === "error" ? `<div class="lib-err">${escapeHtml(job.error)}</div>` : "";
  const list = (items) => (items || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const kv = [
    ["开发者", m.author],
    ["发布", m.released],
    ["规模", m.params],
    ["适合", m.best_for],
    ["推荐参数", m.settings],
    ["许可证", m.license],
    ["存放位置", m.path],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`)
    .join("");
  return `
    <article class="mdl-card" data-card="${escapeHtml(m.id)}">
      <div class="mdl-head">
        <div class="mdl-title">${escapeHtml(m.label)}
          ${m.badge ? `<span class="tag ${m.badge === "推荐" ? "primary" : ""}">${escapeHtml(m.badge)}</span>` : ""}
          <span class="tag">${FAMILY_LABELS[m.family]}</span>
        </div>
        <div class="mdl-status">${status}</div>
      </div>
      <p class="mdl-note">${escapeHtml(m.note || "")}</p>
      <div class="mdl-cols">
        <div><div class="lb-block-title">优点</div><ul class="mdl-list">${list(m.pros)}</ul></div>
        <div><div class="lb-block-title">不足</div><ul class="mdl-list">${list(m.cons)}</ul></div>
      </div>
      <dl class="kv mdl-kv">${kv}</dl>
      ${err}
      <div class="lib-actions">${actions}</div>
    </article>`;
}

function loraCardHtml(item) {
  // item 可以是目录条目，也可以是不在目录里的本地 LoRA
  const job = item.job;
  const downloading = job?.status === "downloading";
  const inUse = loraPathInput.value.trim() === item.path;
  const state = item.installed ? `<span class="lib-state"><span class="dot ok"></span>${inUse ? "使用中" : item.local ? "本地文件" : "已下载"}</span>` : "";
  const cover = item.preview
    ? `<img src="/api/loras/catalog/${encodeURIComponent(item.id)}/preview" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  const initials = escapeHtml(item.tags?.[0] || item.name.slice(0, 2));
  let actions;
  if (downloading) {
    const pct = job.total ? Math.floor((job.downloaded / job.total) * 100) : 0;
    actions = `<div class="lib-progress"><div class="meter"><span style="width:${pct}%"></span></div>下载中 ${pct}% · ${formatSize(job.downloaded)} / ${formatSize(job.total)}</div>`;
  } else if (item.installed) {
    actions = `<button class="btn btn-sm ${inUse ? "" : "btn-primary"}" type="button" data-act="use-lora" data-path="${escapeHtml(item.path)}" ${inUse ? "disabled" : ""}>${inUse ? "正在使用" : "使用"}</button>
      <button class="icon-btn" type="button" data-act="delete-lora" data-path="${escapeHtml(item.path)}" title="删除">${icon("trash", 15)}</button>`;
  } else {
    actions = `<button class="btn btn-sm" type="button" data-act="download-lora" data-id="${escapeHtml(item.id)}">${icon("download", 14)}下载 · ${sizeLabel(item.size_mb)}</button>`;
  }
  if (item.page) actions += `<a class="icon-btn" href="${escapeHtml(item.page)}" target="_blank" rel="noopener" title="在 Hugging Face 查看">${icon("external", 15)}</a>`;
  const err = job?.status === "error" ? `<div class="lib-err">${escapeHtml(job.error)}</div>` : "";
  const meta = item.local
    ? `<span>本地文件 · ${sizeLabel(item.size_mb)}</span><span>${escapeHtml(item.path)}</span>`
    : `<span>${item.trigger ? `触发词 <code>${escapeHtml(item.trigger)}</code>` : "无需触发词"}</span>
       <span>权重 ${item.weight}</span><span>${escapeHtml(item.license)}</span>`;
  return `
    <article class="lib-card" data-card="${escapeHtml(item.path)}">
      <div class="lib-cover">${initials}${cover}${state}</div>
      <div class="lib-info">
        <div class="lib-name">${escapeHtml(item.name)}</div>
        <div class="lib-desc">${escapeHtml(item.desc || "")}</div>
        <div class="lib-meta">${meta}</div>
        ${err}
        <div class="lib-actions">${actions}</div>
      </div>
    </article>`;
}

function libraryLoras(family) {
  const catalogPaths = new Set(libItems.map((i) => i.path));
  const local = loraRecords
    .filter((r) => !catalogPaths.has(r.path) && (r.family || "sd15") === family)
    .map((r) => ({
      id: r.path,
      name: r.display_name || r.name,
      desc: r.desc || "不在内置目录里的本地 LoRA。",
      path: r.path,
      size_mb: r.size_mb,
      installed: true,
      local: true,
      tags: [],
    }));
  return [...libItems.filter((i) => i.family === family), ...local];
}

function openLibrary({ tab = "models", focus = null } = {}) {
  let currentTab = tab;
  let family = familyOf(currentModel());
  if (tab === "loras" && focus) {
    const rec = loraRecords.find((r) => r.path === focus);
    if (rec?.family) family = rec.family;
  }
  let pendingFocus = focus;

  const modal = document.createElement("div");
  modal.className = "modal lora-lib";
  modal.innerHTML = `
    <div class="modal-header">
      <div class="seg" data-role="tab">
        <button type="button" data-tab="models">模型</button>
        <button type="button" data-tab="loras">LoRA</button>
      </div>
      <button class="modal-x" type="button" data-act="close" title="关闭 (Esc)">${icon("x", 15)}</button>
    </div>
    <div class="lib-toolbar">
      <div class="seg" data-role="family">
        <button type="button" data-family="zimage">Z-Image</button>
        <button type="button" data-family="sdxl">SDXL</button>
        <button type="button" data-family="sd15">SD 1.5</button>
      </div>
      <span class="lib-tip" data-role="storage"></span>
    </div>
    <div class="lib-body"><div class="lib-list"></div></div>`;
  const list = $(".lib-list", modal);
  const familySeg = $("[data-role=family]", modal);
  const storageEl = $("[data-role=storage]", modal);

  const render = () => {
    for (const b of $$("[data-role=tab] button", modal)) b.classList.toggle("active", b.dataset.tab === currentTab);
    for (const b of $$("button", familySeg)) b.classList.toggle("active", b.dataset.family === family);
    familySeg.style.visibility = currentTab === "loras" ? "visible" : "hidden";
    const st = libStorage;
    storageEl.textContent = st ? `项目占用：模型 ${st.models_gb} GB · LoRA ${st.loras_gb} GB · 磁盘剩余 ${st.disk_free_gb} GB` : "";

    let html;
    if (currentTab === "models") {
      list.className = "lib-list mdl-list-wrap";
      html = models.map(modelCardHtml);
    } else {
      list.className = "lib-list lib-grid";
      html = libraryLoras(family).map(loraCardHtml);
      if (!html.length) html = [`<div class="empty">${icon("image", 30)}<p>暂无条目</p></div>`];
    }
    const key = `${currentTab}:${family}`;
    const cards = $$("[data-card]", list);
    if (list.dataset.key !== key || cards.length !== html.length) {
      list.innerHTML = html.join("");
      list.dataset.key = key;
      $$("[data-card]", list).forEach((card, i) => (card.dataset.markup = html[i]));
    } else {
      // 只替换有变化的卡片，避免预览图闪烁
      html.forEach((markup, i) => {
        if (cards[i].dataset.markup === markup) return;
        const tmp = document.createElement("div");
        tmp.innerHTML = markup.trim();
        const fresh = tmp.firstElementChild;
        fresh.dataset.markup = markup;
        const oldImg = $(".lib-cover img", cards[i]);
        const newImg = $(".lib-cover img", fresh);
        if (oldImg && newImg) newImg.replaceWith(oldImg);
        cards[i].replaceWith(fresh);
      });
    }
    if (pendingFocus) {
      const card = $$("[data-card]", list).find((c) => c.dataset.card === pendingFocus);
      if (card) {
        pendingFocus = null;
        card.scrollIntoView({ block: "center" });
        card.classList.add("is-focus");
        setTimeout(() => card.classList.remove("is-focus"), 1600);
      }
    }
  };

  libRender = render;
  const previousModelRender = modelLibRender;
  modelLibRender = render;
  const close = openModal(modal);
  const observer = new MutationObserver(() => {
    if (!modal.isConnected) {
      observer.disconnect();
      if (libRender === render) libRender = null;
      if (modelLibRender === render) modelLibRender = previousModelRender;
    }
  });
  observer.observe(document.body, { childList: true });

  modal.addEventListener("click", async (event) => {
    const tabBtn = event.target.closest("[data-role=tab] button");
    if (tabBtn) {
      currentTab = tabBtn.dataset.tab;
      render();
      return;
    }
    const famBtn = event.target.closest("[data-role=family] button");
    if (famBtn) {
      family = famBtn.dataset.family;
      render();
      return;
    }
    const el = event.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "close") close();
    if (act === "download-model") {
      el.disabled = true;
      await downloadModel(el.dataset.id);
    }
    if (act === "delete-model") {
      const m = models.find((x) => x.id === el.dataset.id);
      if (m) await deleteModel(m);
    }
    if (act === "use-model") {
      switchModel(el.dataset.id);
      close();
    }
    if (act === "download-lora") {
      el.disabled = true;
      await downloadCatalogLora(el.dataset.id);
    }
    if (act === "delete-lora") {
      const item = libraryLoras(family).find((x) => x.path === el.dataset.path);
      if (item) await deleteLoraFile({ path: item.path, name: item.name, redownloadable: !item.local });
    }
    if (act === "use-lora") {
      const item = libraryLoras(family).find((x) => x.path === el.dataset.path);
      if (!item) return;
      if (item.local) {
        if (family !== familyOf(currentModel())) {
          const target = models.find((m) => m.family === family && m.installed);
          if (target) switchModel(target.id);
        }
        chooseLora(item.path);
        close();
      } else if (useCatalogLora(item)) close();
    }
  });

  render();
  Promise.all([refreshCatalog(), refreshModels(), refreshLoras()])
    .then(render)
    .catch(() => toast("读取模型库失败", "error"));
}

loraLibBtn.addEventListener("click", () => openLibrary({ tab: "loras", focus: loraPathInput.value.trim() || null }));
modelLibBtn.addEventListener("click", () => openLibrary({ tab: "models", focus: currentModel() }));

/* ---------------- 事件绑定 ---------------- */
modelPreset.addEventListener("change", () => {
  customModelField.hidden = modelPreset.value !== CUSTOM;
  if (modelPreset.value === CUSTOM) modelInput.focus();
  updateFamily(true);
  saveForm();
});
modelInput.addEventListener("change", () => {
  updateFamily(true);
  saveForm();
});
loraSelect.addEventListener("change", () => {
  chooseLora(loraSelect.value);
});
loraPathInput.addEventListener("input", () => setLora(loraPathInput.value.trim()));
ratioSeg.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-ratio]");
  if (!btn) return;
  applyRatio(btn.dataset.ratio);
  saveForm();
});
widthInput.addEventListener("input", syncRatioFromSize);
heightInput.addEventListener("input", syncRatioFromSize);
form.addEventListener("input", saveForm);
form.addEventListener("change", saveForm);

/* ---------------- 启动 ---------------- */
hydrateIcons();
applyThemeIcon();
restoreForm();
resetPreview();
refreshAll();
setInterval(refreshGpu, 1000);
setInterval(refreshStatus, 15000);
