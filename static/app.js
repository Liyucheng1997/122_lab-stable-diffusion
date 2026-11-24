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
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  person: '<circle cx="12" cy="4.5" r="2.5"/><path d="M12 7v7"/><path d="m8 21 4-7 4 7"/><path d="M5 10.5 12 9l7 1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
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
const promptHelperStatus = $("#promptHelperStatus");
const agentThread = $("#agentThread");
const agentInput = $("#agentInput");
const agentSendBtn = $("#agentSendBtn");
const agentNewBtn = $("#agentNewBtn");
const agentAuto = $("#agentAuto");
const chatList = $("#chatList");
const railToggleBtn = $("#railToggleBtn");
const paramsToggleBtn = $("#paramsToggleBtn");
const composerModel = $("#composerModel");
const composerRef = $("#composerRef");
const composerAttach = $("#composerAttach");
const composerAttachImg = $("#composerAttachImg");
const composerAttachBtn = $("#composerAttachBtn");
const composerAttachClear = $("#composerAttachClear");
const agentFile = $("#agentFile");
const attachModeSeg = $("#attachModeSeg");
const attachModeNote = $("#attachModeNote");
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
let poseLib = null; // 姿势库（/api/poses）：姿势列表、下载状态、ControlNet 状态
let pose = null; // 选着的参考姿势 { id, name, system, category, angle }；姿势库还没读到时只有 id
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
  renderPose();
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
    pose: pose?.id || "",
    pose_scale: readPoseScale(),
    pose_controlnet: POSE_CONTROLNET,
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
  updateComposerChips();
  store.set(FORM_KEY, {
    ...formPayload(),
    prompt: promptInput.value,
    negative_prompt: negativeInput.value,
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
  // 强度只在同一个 ControlNet 下沿用：之前完整版用的 0.7 放到 Lite 版上基本不跟姿势，改回默认
  setPair(poseScaleInput, poseScaleRange, isNum(params.pose_scale) && params.pose_controlnet === POSE_CONTROLNET ? params.pose_scale : POSE_DEFAULT_SCALE);
  setRef(params.init_image || null);
  // 没记 pose 的（旧图片、旧表单）都是没用姿势出的图
  setPose(params.init_image ? null : params.pose || null, { quiet: true });
  lastFamily = familyOf(currentModel());
  updateFamily(false);
  saveForm();
}

function restoreForm() {
  const saved = store.get(FORM_KEY, null);
  if (!saved) {
    // 第一次打开：默认 Z-Image Turbo + 推荐参数（HTML 里已经填好 1024 / 9 步 / CFG 0），从 AI 助手开始
    setModel(modelPreset.value);
    setPromptMode("agent");
    return;
  }
  applyParams(saved);
  setPromptMode(["en", "gallery"].includes(saved.mode) ? saved.mode : "agent");
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
  composerRef.hidden = !on;
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
  if (pose) {
    // ControlNet 管线不做图生图：两者只能用一个，后放的为准
    setPose(null, { quiet: true });
    toast("参考姿势和图生图不能同时用，已移除参考姿势", "info", 3500);
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
  if (promptMode() === "agent") agentAttachFile(file);
  else useRefFile(file);
});

/* ---------------- 参考姿势：姿势库（1439 张白模姿势）+ Z-Image ControlNet ---------------- */
const poseDrop = $("#poseDrop");
const poseBox = $("#poseBox");
const poseThumb = $("#poseThumb");
const poseName = $("#poseName");
const poseMeta = $("#poseMeta");
const poseTag = $("#poseTag");
const poseControls = $("#poseControls");
const poseScaleInput = $("#poseScale");
const poseScaleRange = $("#poseScaleRange");
const poseHint = $("#poseHint");
const cnDownload = $("#cnDownload");
const cnDlText = $("#cnDlText");
const cnDlBtn = $("#cnDlBtn");
const cnDlMeter = $("#cnDlMeter");
const cnDlBar = $("#cnDlBar");
const cnDlSub = $("#cnDlSub");
const composerPose = $("#composerPose");
const composerPoseText = $("#composerPoseText");
const POSE_ANGLES = ["正面", "斜侧", "侧面", "俯视", "仰视"];
const POSE_FILTER_KEY = "aigen.pose.filter";
// 用的是 Lite 版 ControlNet（和 app/poses.py 一致）。实测（同一提示词、同一 seed）：
// 0.7 基本不跟姿势；0.8～0.9 动作准、衣服自然；1.0 衣服贴着身体轮廓
const POSE_CONTROLNET = "zimage-controlnet-union-lite";
const POSE_DEFAULT_SCALE = 0.85;
let posePollTimer = null;
let poseLibRender = null; // 姿势库弹窗打开时的重绘函数

const poseThumbUrl = (id) => `/poses/thumbs/${encodeURIComponent(id)}.jpg`;

function readPoseScale() {
  const value = Number(poseScaleInput.value);
  return Number.isFinite(value) && value > 0 ? Math.max(0.3, Math.min(1.2, value)) : POSE_DEFAULT_SCALE;
}

// id → 姿势库里的完整条目（姿势库还没读到时先只记 id，读到后再补全）
function resolvePose(value) {
  const id = typeof value === "string" ? value : value?.id;
  if (!id) return null;
  return poseLib?.items.find((p) => p.id === id) || { id };
}

function poseLabel(p) {
  return p?.name ? `${p.name}（${p.angle}）` : p?.id || "";
}

function renderPose() {
  const on = !!pose;
  poseDrop.hidden = on;
  poseBox.hidden = !on;
  poseControls.hidden = !on;
  poseTag.textContent = on ? "已选" : "不用";
  poseTag.classList.toggle("primary", on);
  composerPose.classList.toggle("chip-on", on);
  composerPoseText.textContent = on ? `姿势 · ${pose.name || pose.id}` : "姿势";
  if (on) {
    poseThumb.src = poseThumbUrl(pose.id);
    poseName.textContent = pose.name || pose.id;
    poseMeta.textContent = pose.system ? `${pose.system} · ${pose.category} · ${pose.angle}视角` : "";
  } else {
    poseThumb.removeAttribute("src");
  }
  const family = familyOf(currentModel());
  const wrongModel = on && family !== "zimage";
  poseHint.hidden = !wrongModel;
  poseHint.textContent = wrongModel ? `参考姿势只支持 Z-Image Turbo，当前是 ${FAMILY_LABELS[family]}，出图前请换模型或移除姿势。` : "";
  renderControlnetBox();
}

function renderControlnetBox() {
  const cn = poseLib?.controlnet;
  const need = !!pose && !!cn && !cn.installed;
  cnDownload.hidden = !need;
  if (!need) return;
  const job = cn.job;
  const busy = job?.status === "downloading" || job?.status === "converting";
  cnDlBtn.hidden = busy;
  cnDlMeter.hidden = !busy;
  if (job?.status === "converting") {
    cnDlBar.style.width = "100%";
    cnDlText.textContent = "下载完成，正在转换格式…";
    cnDlSub.textContent = "大约一分钟。";
  } else if (busy) {
    const total = job.total || cn.size_gb * 1e9;
    const pct = total ? Math.min(100, (job.downloaded / total) * 100) : 0;
    cnDlBar.style.width = `${pct}%`;
    cnDlText.textContent = `正在下载姿势控制模型 ${Math.floor(pct)}%`;
    cnDlSub.textContent = `${formatSize(job.downloaded)} / ${formatSize(total)} · 关掉网页也会在后台继续下载`;
  } else if (job?.status === "error") {
    cnDlText.textContent = "下载失败";
    cnDlBtn.textContent = "重试";
    cnDlSub.textContent = job.error || "";
  } else {
    cnDlText.textContent = `还需要姿势控制模型（约 ${cn.size_gb} GB）`;
    cnDlBtn.textContent = "下载";
    cnDlSub.textContent = `${cn.label}（阿里 PAI，${cn.license}），从 Hugging Face 下载到 models/controlnet，只需一次。`;
  }
}

// next：姿势库条目或 id，null 表示不用姿势
function setPose(next, { quiet = false } = {}) {
  pose = resolvePose(next);
  if (pose && refImage) {
    setRef(null);
    if (!quiet) toast("参考姿势和图生图不能同时用，已移除参考图", "info", 3500);
  }
  // 姿势图都是 3:4 竖图：画面比例跟过去，人物不会被缩小、两边留空
  if (pose && !quiet && familyOf(currentModel()) === "zimage" && activeRatio() !== "3:4") {
    applyRatio("3:4");
    toast("已按姿势图把画面比例切到 3:4", "info", 3000);
  }
  renderPose();
  saveForm();
}

async function refreshPoses() {
  const response = await fetch("/api/poses");
  const data = await response.json();
  const was = poseLib;
  poseLib = data;
  if (was?.job?.status === "downloading" && data.job?.status === "done") toast(`姿势库下载完成 · ${data.count} 张`, "success", 4000);
  if (["downloading", "converting"].includes(was?.controlnet.job?.status) && data.controlnet.installed) toast("姿势控制模型已就绪", "success", 4000);
  if (pose) pose = resolvePose(pose);
  renderPose();
  poseLibRender?.();
  clearTimeout(posePollTimer);
  const busy = data.job?.status === "downloading" || ["downloading", "converting"].includes(data.controlnet.job?.status);
  if (busy) posePollTimer = setTimeout(() => refreshPoses().catch(() => {}), 1200);
}

async function downloadPoseLibrary() {
  try {
    await postJson("/api/poses/download", {});
  } catch (error) {
    toast(error.message || "下载失败", "error", 4000);
  }
  await refreshPoses().catch(() => {});
}

async function downloadControlnet() {
  try {
    await postJson("/api/controlnet/download", {});
    toast("开始下载姿势控制模型");
  } catch (error) {
    toast(error.message || "下载失败", "error", 4000);
  }
  await refreshPoses().catch(() => {});
}

// 姿势库弹窗：按体系 / 分类 / 视角筛选，一组姿势一张卡片，卡片下面切视角，点图选用
function openPoseLibrary() {
  const saved = store.get(POSE_FILTER_KEY, {}) || {};
  const filter = { system: saved.system || "", category: "", angle: saved.angle || "", query: "" };
  const shownAngle = new Map(); // 每组卡片当前显示的视角

  const modal = document.createElement("div");
  modal.className = "modal pose-lib";
  modal.innerHTML = `
    <div class="modal-header">
      <div class="pose-lib-title">姿势库 <span class="pose-lib-count" data-role="count"></span></div>
      <button class="modal-x" type="button" data-act="close" title="关闭 (Esc)">${icon("x", 15)}</button>
    </div>
    <div class="pose-toolbar">
      <div class="seg pose-seg" data-role="system"></div>
      <select class="input pose-select" data-role="category"></select>
      <div class="seg pose-seg" data-role="angle"></div>
      <label class="pose-search">${icon("search", 14)}<input class="input" data-role="query" type="search" placeholder="搜动作，如：站姿、跪、蹲、举手" /></label>
    </div>
    <div class="pose-body"><div data-role="notice"></div><div class="pose-grid" data-role="grid"></div></div>`;
  const systemSeg = $("[data-role=system]", modal);
  const categorySel = $("[data-role=category]", modal);
  const angleSeg = $("[data-role=angle]", modal);
  const queryInput = $("[data-role=query]", modal);
  const grid = $("[data-role=grid]", modal);
  const notice = $("[data-role=notice]", modal);
  const countEl = $("[data-role=count]", modal);

  const groupsOf = (items) => {
    const groups = new Map();
    for (const p of items) {
      const key = `${p.system}|${p.number}`;
      if (!groups.has(key)) groups.set(key, { key, name: p.name, system: p.system, category: p.category, angles: {} });
      groups.get(key).angles[p.angle] = p;
    }
    return [...groups.values()];
  };

  const noticeHtml = () => {
    const lib = poseLib;
    if (!lib) return `<div class="pose-notice">读取姿势库…</div>`;
    let html = "";
    if (!lib.installed) {
      const job = lib.job;
      if (job?.status === "downloading") {
        const pct = job.total ? Math.floor((job.done / job.total) * 100) : 0;
        html += `<div class="dl-box"><div class="dl-head"><span class="dl-text">正在下载姿势库 ${pct}%</span></div><div class="meter"><span style="width:${pct}%"></span></div><span class="field-note">${job.done} / ${job.total || "--"} 个文件</span></div>`;
      } else {
        html += `<div class="dl-box"><div class="dl-head"><span class="dl-text">${job?.status === "error" ? "下载没完成" : "姿势库还没下载"}</span><button class="btn btn-primary btn-sm" type="button" data-act="dl-poses">${job?.status === "error" ? "接着下载" : "下载姿势库（约 55 MB）"}</button></div><span class="field-note">${escapeHtml(job?.error || "")} 来自 ai-pose-gallery（原作者ギア @giaaibusi），1439 张多角度白模姿势，下载到项目的 poses 目录，只供个人学习创作。</span></div>`;
      }
    }
    const cn = lib.controlnet;
    if (lib.installed && !cn.installed) {
      const st = cn.job?.status;
      const busy = st === "downloading" || st === "converting";
      const pct = busy && cn.job.total ? Math.floor((cn.job.downloaded / cn.job.total) * 100) : 0;
      html += `<div class="pose-notice">${busy ? (st === "converting" ? "姿势控制模型下载完成，正在转换格式…" : `正在下载姿势控制模型 ${pct}%`) : `选好姿势后，出图还需要姿势控制模型（约 ${cn.size_gb} GB）。`}${busy ? "" : ` <button class="link-btn" type="button" data-act="dl-cn">现在下载</button>`}</div>`;
    }
    return html;
  };

  const render = () => {
    const lib = poseLib;
    const items = lib?.items || [];
    countEl.textContent = items.length ? `${items.length} 张 · ${groupsOf(items).length} 组动作` : "";
    notice.innerHTML = noticeHtml();
    systemSeg.innerHTML = ["", ...(lib?.systems || [])]
      .map((s) => `<button type="button" data-system="${escapeHtml(s)}" class="${s === filter.system ? "active" : ""}">${escapeHtml(s || "全部")}</button>`)
      .join("");
    angleSeg.innerHTML = ["", ...POSE_ANGLES]
      .map((a) => `<button type="button" data-angle="${a}" class="${a === filter.angle ? "active" : ""}">${a || "全部视角"}</button>`)
      .join("");
    const inSystem = items.filter((p) => !filter.system || p.system === filter.system);
    const categories = [...new Set(inSystem.map((p) => p.category))];
    if (filter.category && !categories.includes(filter.category)) filter.category = "";
    categorySel.innerHTML = `<option value="">全部分类</option>${categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}`;
    categorySel.value = filter.category;
    renderGrid(inSystem);
  };

  const renderGrid = (inSystem) => {
    const q = filter.query.trim().toLowerCase();
    const groups = groupsOf(inSystem.filter((p) => !filter.category || p.category === filter.category)).filter((g) => {
      if (filter.angle && !g.angles[filter.angle]) return false;
      return !q || `${g.name} ${g.category} ${g.system}`.toLowerCase().includes(q);
    });
    if (poseLib?.installed && !groups.length) {
      grid.innerHTML = `<div class="empty pose-empty">${icon("search", 26)}<p>没有符合条件的姿势</p></div>`;
      return;
    }
    grid.innerHTML = groups
      .map((g) => {
        const shown = g.angles[filter.angle] || g.angles[shownAngle.get(g.key)] || g.angles["正面"] || Object.values(g.angles)[0];
        const selected = pose && Object.values(g.angles).some((p) => p.id === pose.id);
        const angles = POSE_ANGLES.filter((a) => g.angles[a])
          .map((a) => `<button type="button" data-id="${escapeHtml(g.angles[a].id)}" data-key="${escapeHtml(g.key)}" class="${g.angles[a] === shown ? "active" : ""}" title="${a}视角">${a.slice(0, 1)}</button>`)
          .join("");
        return `
          <article class="pose-card${selected ? " is-selected" : ""}" data-key="${escapeHtml(g.key)}">
            <button class="pose-media" type="button" data-pick="${escapeHtml(shown.id)}" title="用这个姿势：${escapeHtml(g.name)}（${shown.angle}）">
              <img src="${poseThumbUrl(shown.id)}" alt="${escapeHtml(g.name)}" loading="lazy" />
            </button>
            <div class="pose-info">
              <div class="pose-name">${escapeHtml(g.name)}</div>
              <div class="pose-sub">${escapeHtml(g.category)}${filter.system ? "" : ` · ${escapeHtml(g.system)}`}</div>
              <div class="pose-angles">${angles}</div>
            </div>
          </article>`;
      })
      .join("");
  };

  const close = openModal(modal);
  new MutationObserver((_, observer) => {
    if (!modal.isConnected) {
      if (poseLibRender === render) poseLibRender = null;
      observer.disconnect();
    }
  }).observe(document.body, { childList: true });
  const remember = () => store.set(POSE_FILTER_KEY, { system: filter.system, angle: filter.angle });

  modal.addEventListener("click", (event) => {
    const target = event.target;
    if (target.closest('[data-act="close"]')) return close();
    if (target.closest('[data-act="dl-poses"]')) return downloadPoseLibrary();
    if (target.closest('[data-act="dl-cn"]')) return downloadControlnet();
    const sys = target.closest("button[data-system]");
    if (sys) {
      filter.system = sys.dataset.system;
      remember();
      return render();
    }
    const ang = target.closest("button[data-angle]");
    if (ang) {
      filter.angle = ang.dataset.angle;
      remember();
      return render();
    }
    const angleBtn = target.closest(".pose-angles button");
    if (angleBtn) {
      // 只换这张卡片显示的视角，不重绘整个列表
      const item = poseLib.items.find((p) => p.id === angleBtn.dataset.id);
      shownAngle.set(angleBtn.dataset.key, item.angle);
      const card = angleBtn.closest(".pose-card");
      const media = $(".pose-media", card);
      media.dataset.pick = item.id;
      media.title = `用这个姿势：${item.name}（${item.angle}）`;
      $("img", media).src = poseThumbUrl(item.id);
      for (const b of $$(".pose-angles button", card)) b.classList.toggle("active", b === angleBtn);
      return;
    }
    const pick = target.closest("[data-pick]");
    if (pick) {
      setPose(pick.dataset.pick);
      close();
      toast(`已选姿势：${poseLabel(pose)}`, "success");
    }
  });
  categorySel.addEventListener("change", () => {
    filter.category = categorySel.value;
    render();
  });
  queryInput.addEventListener("input", () => {
    filter.query = queryInput.value;
    render();
  });
  poseLibRender = render;
  render();
  refreshPoses().catch(() => {});
}

for (const el of [poseDrop, poseThumb, $("#poseChangeBtn"), composerPose]) el.addEventListener("click", openPoseLibrary);
$("#poseClearBtn").addEventListener("click", () => {
  setPose(null);
  toast("已移除参考姿势");
});
cnDlBtn.addEventListener("click", async () => {
  cnDlBtn.disabled = true;
  await downloadControlnet();
  cnDlBtn.disabled = false;
});
bindPair(poseScaleInput, poseScaleRange);

/* ---------------- 三个页签：AI 助手（对话） / 手动出图（表单） / 历史画廊 ---------------- */
const PARAMS_KEY = "aigen.params.open";
function promptMode() {
  return $("button.active", promptModeSeg)?.dataset.mode || "agent";
}
function setPromptMode(mode) {
  for (const btn of $$("button", promptModeSeg)) btn.classList.toggle("active", btn.dataset.mode === mode);
  document.body.dataset.mode = { agent: "agent", gallery: "gallery" }[mode] || "manual";
  promptHelper.hidden = mode !== "agent";
  if (mode === "agent") agentThread.scrollTop = agentThread.scrollHeight;
}
promptModeSeg.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-mode]");
  if (!btn) return;
  setPromptMode(btn.dataset.mode);
  if (btn.dataset.mode === "agent") agentInput.focus();
  saveForm();
});

// 助手模式下参数面板默认收起，点「参数」或输入框下面的模型标签打开
function setParamsOpen(open) {
  document.body.classList.toggle("params-open", open);
  paramsToggleBtn.setAttribute("aria-pressed", String(open));
  store.set(PARAMS_KEY, open);
}
paramsToggleBtn.addEventListener("click", () => setParamsOpen(!document.body.classList.contains("params-open")));
composerModel.addEventListener("click", () => {
  setParamsOpen(true);
  modelPreset.scrollIntoView({ block: "center" });
  modelPreset.focus();
});
composerRef.addEventListener("click", () => {
  setParamsOpen(true);
  refBox.scrollIntoView({ block: "center" });
});

// 输入框下面的标签：当前模型（带 LoRA 时注明）和是否放了参考图
function updateComposerChips() {
  const lora = loraPathInput.value.trim();
  composerModel.textContent = `${modelLabel(currentModel())}${lora ? " · LoRA" : ""}`;
  composerRef.hidden = !refImage;
}

/* ---------------- AI 助手（多轮对话，助手写提示词并决定出图参数） ---------------- */
const AGENT_KEY = "aigen.agent.v2";
const AGENT_KEY_V1 = "aigen.agent.v1";
const RAIL_KEY = "aigen.rail.open";
const AGENT_SUGGESTS = [
  "雨夜的霓虹街道上，一只机械猫回头看镜头",
  "穿汉服的女孩站在竹林里，清晨有薄雾",
  "一张咖啡店的新品海报，上面写着“秋日限定”",
  "雪山下的小木屋，窗户透出暖光",
];
// 对话记录：每段对话单独保存，「新对话」只是另开一段，旧的留在左侧列表里
// 一段对话 = { id, updated, messages, pending, usedRef }
//   messages：{ role: "user", content: 显示的原话, sent: 发给模型的话（前面可能带系统记录）, image, imageMode }
//             { role: "assistant", turn: 这一轮的提示词和参数, images: [{ url, seed, w, h }], result, error,
//               local: 用户按表单手动出的图（只显示，不发给模型）, open: 提示词是否展开 }
//   pending：上一轮的出图结果，下次用户说话时附在前面告诉助手（它要靠这个选 seed）
const MAX_CHATS = 60;
let chats = []; // 所有有内容的对话
let agent = newChat(); // 当前这段对话（还没说话的新对话不进 chats）
let agentBusy = false;
let agentRun = null; // 正在出图的那一轮 { msg, count, done }
let agentProgressText = "";

function newChat() {
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, updated: Date.now(), messages: [], pending: "", grouped: true };
}

function saveAgent() {
  if (agent.messages.length && !chats.includes(agent)) chats.push(agent);
  chats.sort((a, b) => b.updated - a.updated);
  chats = chats.slice(0, MAX_CHATS);
  store.set(AGENT_KEY, { current: agent.id, auto: agentAuto.checked, chats });
  renderChatList();
}

function restoreAgent() {
  const saved = store.get(AGENT_KEY, null);
  if (saved && Array.isArray(saved.chats)) {
    chats = saved.chats.filter((c) => c && Array.isArray(c.messages) && c.messages.length);
    agent = chats.find((c) => c.id === saved.current) || newChat();
    agentAuto.checked = saved.auto !== false;
  } else {
    // 旧版只存一段对话：搬过来当第一条记录
    const old = store.get(AGENT_KEY_V1, null);
    if (old && Array.isArray(old.messages) && old.messages.length) {
      agent = { ...newChat(), messages: old.messages, pending: old.pending || "", usedRef: !!old.usedRef };
      chats = [agent];
      agentAuto.checked = old.auto !== false;
    }
  }
  setParamsOpen(store.get(PARAMS_KEY, false) === true);
  // 对话记录栏：宽屏默认展开并记住上次的选择，窄屏默认收起
  setRailOpen(window.innerWidth > 900 && store.get(RAIL_KEY, true) !== false, { remember: false });
  updateComposerChips();
  renderAgent();
  renderChatList();
  regroupOldChats();
}

// 历史画廊里按这个编号把同一段对话的图收进一个图片夹
function chatBatch(chat) {
  return `chat-${chat.id}`;
}
const isChatGroup = (key) => String(key).startsWith("chat-");

// 改成按对话归组之前出的图还带着旧的批次号：对每段旧对话补归一次
async function regroupOldChats() {
  let changed = false;
  for (const chat of chats) {
    if (chat.grouped) continue;
    const names = chat.messages.flatMap((m) => (m.images || []).map((img) => img.url.split("/").pop()));
    if (names.length) {
      try {
        const response = await fetch("/api/images/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch: chatBatch(chat), names }),
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data.changed) {
          images = data.images || images;
          renderGallery();
        }
      } catch {
        continue;
      }
    }
    chat.grouped = true;
    changed = true;
  }
  if (changed) saveAgent();
}

function chatTitle(chat) {
  const first = chat.messages.find((m) => m.role === "user");
  return first?.content?.trim() || "手动出图";
}

function chatTimeLabel(time) {
  const date = new Date(time);
  const now = new Date();
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.toDateString() === now.toDateString()) return `今天 ${hm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

function renderChatList() {
  if (!chats.length) {
    chatList.innerHTML = `<p class="rail-empty">还没有对话记录。<br />每段对话都会留在这里，随时可以回来接着改。</p>`;
    return;
  }
  chatList.innerHTML = chats
    .map((chat) => {
      const shots = chat.messages.reduce((n, m) => n + (m.images?.length || 0), 0);
      const sub = `${chatTimeLabel(chat.updated)}${shots ? ` · ${shots} 张图` : ""}`;
      return `<div class="chat-item${chat === agent ? " active" : ""}" data-id="${chat.id}" role="button" tabindex="0"><div class="chat-item-text"><div class="chat-item-title">${escapeHtml(chatTitle(chat))}</div><div class="chat-item-sub">${sub}</div></div><button type="button" class="chat-item-del" data-act="delete" title="删除这段对话">${icon("trash", 14)}</button></div>`;
    })
    .join("");
}

// 换到另一段对话（或新开一段）。正在思考或出图时不让换，免得结果写到别的对话里
function switchChat(next) {
  if (agentBusy || agentRun) {
    toast("等这一轮完成再切换对话");
    return false;
  }
  if (agent.usedRef) setRef(null); // 助手放进表单的参考图属于原来那段对话，不带过去
  agent = next;
  agentAttach = null;
  renderAgentAttach();
  renderAgent();
  saveAgent();
  if (window.innerWidth <= 900) setRailOpen(false, { remember: false });
  return true;
}

function setRailOpen(open, { remember = true } = {}) {
  promptHelper.classList.toggle("rail-open", open);
  railToggleBtn.setAttribute("aria-pressed", String(open));
  if (remember && window.innerWidth > 900) store.set(RAIL_KEY, open);
}
railToggleBtn.addEventListener("click", () => setRailOpen(!promptHelper.classList.contains("rail-open")));

chatList.addEventListener("click", async (event) => {
  const item = event.target.closest(".chat-item");
  if (!item) return;
  const chat = chats.find((c) => c.id === item.dataset.id);
  if (!chat) return;
  if (event.target.closest('[data-act="delete"]')) {
    if (agentBusy || agentRun) {
      toast("等这一轮完成再删除对话");
      return;
    }
    const ok = await confirmDialog({ title: "删除这段对话？", message: `「${chatTitle(chat).slice(0, 40)}」的聊天记录会被删除。已经出的图还在历史画廊里。`, okText: "删除" });
    if (!ok) return;
    chats = chats.filter((c) => c !== chat);
    if (chat === agent) switchChat(newChat());
    else saveAgent();
    return;
  }
  if (chat !== agent) switchChat(chat);
});
chatList.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.classList.contains("chat-item")) event.target.click();
});

function agentPlanTags(turn) {
  return [
    turn.use_reference ? null : turn.aspect,
    `${turn.count} 张`,
    `${turn.steps} 步`,
    turn.guidance_scale > 0 ? `CFG ${turn.guidance_scale}` : null,
    turn.seed == null ? "Seed 随机" : `Seed ${turn.seed}`,
    turn.use_reference ? `图生图 · 重绘幅度 ${turn.strength}` : null,
  ].filter(Boolean);
}

function agentMessageHtml(m, index) {
  if (m.role === "user") {
    const usage = m.imageMode === "describe" ? "只提取提示词" : "图生图";
    const image = m.image ? `<div class="bubble-ref"><img class="bubble-img" src="${escapeHtml(m.image)}" alt="参考图" loading="lazy" /><span class="tag">参考图 · ${usage}</span></div>` : "";
    return `<div class="msg user"><div class="user-col">${image}<div class="bubble">${escapeHtml(m.content)}</div></div></div>`;
  }
  const turn = m.turn;
  const parts = [`<div class="msg-text">${escapeHtml(turn.reply)}</div>`];
  if (turn.generate) {
    const tags = agentPlanTags(turn).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const variants = turn.variants?.length
      ? `<ol class="plan-variants">${turn.variants.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ol>`
      : "";
    parts.push(
      `<div class="plan"><button type="button" class="plan-prompt${m.open ? " open" : ""}" data-act="prompt" data-i="${index}" title="点击展开 / 收起提示词">${escapeHtml(turn.prompt)}</button>${variants}<div class="plan-tags">${tags}</div></div>`,
    );
  }
  const run = agentRun?.msg === m ? agentRun : null;
  const shots = (m.images || []).map(
    (img) =>
      `<button type="button" class="shot" data-act="open" data-name="${escapeHtml(img.url.split("/").pop())}" style="aspect-ratio:${img.w}/${img.h}" title="Seed ${img.seed} · 点击看大图"><img src="${escapeHtml(img.url)}" alt="" loading="lazy" /></button>`,
  );
  if (run) {
    // 还没出来的几张先占位：第一个显示进度，其余排队
    for (let i = run.done; i < run.count; i += 1) {
      const body = i === run.done ? `<span class="spinner"></span><span id="agentProgress">${escapeHtml(agentProgressText)}</span>` : "<span>排队中</span>";
      shots.push(`<div class="shot pending${i === run.done ? "" : " wait"}" style="aspect-ratio:${run.w}/${run.h}">${body}</div>`);
    }
  }
  if (shots.length) {
    // 同一轮的图排成一行（横图 4 张以上排两列），并限制单张的高度，免得竖图撑得太高
    const first = m.images?.[0] || run;
    const ratio = first.w / first.h;
    const cols = shots.length <= 3 ? shots.length : ratio > 1 ? 2 : 4;
    const maxHeight = shots.length === 1 ? 420 : 320;
    const maxWidth = Math.round(cols * maxHeight * ratio + (cols - 1) * 8);
    parts.push(`<div class="shots" style="grid-template-columns:repeat(${cols},minmax(0,1fr));max-width:${maxWidth}px">${shots.join("")}</div>`);
  }
  if (m.error) parts.push(`<div class="msg-error">${icon("alert", 15)}<span>${escapeHtml(m.error)}</span></div>`);
  if (m.result && !run) parts.push(`<div class="msg-note">${escapeHtml(m.result)}</div>`);
  return `<div class="msg bot"><div class="avatar">${icon("sparkles", 15)}</div><div class="msg-body">${parts.join("")}</div></div>`;
}

function renderAgent({ stick = true } = {}) {
  if (!agent.messages.length && !agentBusy) {
    const suggests = AGENT_SUGGESTS.map((s) => `<button type="button" class="chip" data-act="suggest">${escapeHtml(s)}</button>`).join("");
    agentThread.innerHTML = `<div class="chat-empty"><div class="avatar lg">${icon("sparkles", 22)}</div><h3>想画点什么？</h3><p>用中文说出画面，助手会写好提示词，自己定比例、张数和 Seed 然后出图。<br />不满意就接着说怎么改，它记得前面的每一版。</p><div class="suggests">${suggests}</div></div>`;
    return;
  }
  const html = agent.messages.map(agentMessageHtml);
  if (agentBusy) {
    const text = llmSettings?.state === "ready" ? "思考中…" : "正在加载本地模型并思考…";
    html.push(`<div class="msg bot"><div class="avatar">${icon("sparkles", 15)}</div><div class="msg-body"><div class="typing"><span class="spinner"></span>${text}</div></div></div>`);
  }
  agentThread.innerHTML = html.join("");
  if (stick) agentThread.scrollTop = agentThread.scrollHeight;
}

// 对话里的图如果已经在画廊里删掉了，显示成「图片已删除」而不是裂图
agentThread.addEventListener("error", (event) => event.target.closest?.(".shot")?.classList.add("gone"), true);

agentThread.addEventListener("click", (event) => {
  const target = event.target.closest("[data-act]");
  if (!target) return;
  if (target.dataset.act === "suggest") {
    agentInput.value = target.textContent;
    growAgentInput();
    agentInput.focus();
  } else if (target.dataset.act === "prompt") {
    const m = agent.messages[Number(target.dataset.i)];
    if (!m) return;
    m.open = !m.open;
    target.classList.toggle("open", m.open);
  } else if (target.dataset.act === "open") {
    const index = images.findIndex((item) => item.name === target.dataset.name);
    if (index >= 0) openLightbox(index);
    else toast("这张图已经被删除了");
  }
});

// 把助手定的提示词和参数填进参数表单
async function applyAgentPlan(turn) {
  const ref = agentRefImage();
  if (ref) {
    // 对话里有参考图时，用不用它由助手这一轮决定：重绘就放进表单，只是看图写提示词就撤掉
    // 图生图时画面比例跟着参考图走（fit），免得原图被裁掉一大块
    await setRef(turn.use_reference ? ref : null, { fit: true });
    if (turn.use_reference) setPair(strengthInput, strengthRange, turn.strength);
    agent.usedRef = true;
  }
  const img2img = !!(ref && turn.use_reference && refImage);
  promptInput.value = turn.prompt;
  negativeInput.value = turn.negative_prompt || "";
  // 图生图跟着参考图的比例，参考姿势跟着姿势图（3:4），都不听助手的
  if (!img2img && !pose && SIZES[familyOf(currentModel())][turn.aspect]) applyRatio(turn.aspect);
  setPair(stepsInput, stepsRange, turn.steps);
  setPair(guidanceInput, guidanceRange, turn.guidance_scale);
  seedInput.value = turn.seed == null ? "" : turn.seed;
  setPair(countInput, countRange, turn.count);
  updateParamHint();
  updateStrengthNote();
  updateCountNote();
  saveForm();
}

/* 出图过程挂在对话里：开始时占位，出一张显示一张，结束后记下结果 */
function agentGenStart(count, base) {
  if (promptMode() !== "agent") return;
  let msg = agent.messages[agent.messages.length - 1];
  if (msg?.role !== "assistant" || !msg.turn.generate) {
    // 用户没经过助手、直接按表单参数出图：在对话里补一条记录，图才有地方放
    msg = {
      role: "assistant",
      local: true,
      turn: {
        reply: "按参数面板里的设置出图。",
        generate: true,
        prompt: base.prompt,
        aspect: activeRatio() || `${base.width} × ${base.height}`,
        count,
        steps: base.steps,
        guidance_scale: base.guidance_scale,
        seed: base.seed,
      },
    };
    agent.messages.push(msg);
  }
  msg.error = "";
  agentRun = { msg, count, done: 0, w: base.width, h: base.height };
  renderAgent();
}

function agentGenImage(url, seed, w, h) {
  if (!agentRun) return;
  agentRun.msg.images = [...(agentRun.msg.images || []), { url, seed, w, h }];
  agentRun.done += 1;
  renderAgent();
  saveAgent();
}

function agentSetProgress(text) {
  agentProgressText = text;
  const el = $("#agentProgress");
  if (el) el.textContent = text;
}

function agentGenEnd(seeds, prompt, strength, error, poseText = "") {
  if (!agentRun) return;
  const msg = agentRun.msg;
  agentRun = null;
  agent.updated = Date.now();
  if (error) msg.error = seeds.length ? `第 ${seeds.length + 1} 张生成失败：${error}` : error;
  if (seeds.length) {
    // 放了参考图时出的是图生图，画面会被参考图带着走；用了参考姿势时人物照着姿势摆。要让用户和助手都知道
    const ref = strength ? `（图生图：按参考图重绘，幅度 ${strength}）` : poseText ? `（参考姿势：${poseText}）` : "";
    const text = `已出图 ${seeds.length} 张，seed：${seeds.join("、")}${ref}`;
    msg.result = text;
    if (msg.local) agent.pending = `用户按参数面板手动${text}，提示词是：${prompt}`;
    else {
      agent.pending = `上一轮${text}`;
      if (prompt !== msg.turn.prompt) agent.pending += `。出图前用户把提示词手动改成了：${prompt}`;
    }
  }
  renderAgent();
  saveAgent();
}

function growAgentInput() {
  agentInput.style.height = "auto";
  agentInput.style.height = `${Math.min(agentInput.scrollHeight, 180)}px`;
}

async function sendAgent() {
  const attach = agentAttach;
  const text = agentInput.value.trim() || (attach ? "看看这张参考图。" : "");
  if (!text || agentBusy) return;
  if (isBusy) {
    toast("正在出图，等这批出完再说");
    return;
  }
  const pending = agent.pending;
  agent.updated = Date.now();
  agent.messages.push({ role: "user", content: text, sent: pending ? `[系统记录：${pending}]\n${text}` : text, image: attach || undefined, imageMode: attach ? attachMode() : undefined });
  agentAttach = null;
  renderAgentAttach();
  agent.pending = "";
  agentInput.value = "";
  growAgentInput();
  agentBusy = true;
  llmBusy = true;
  agentSendBtn.disabled = true;
  // 刚出过图时模型不在显存里，要先加载几秒
  promptHelperStatus.textContent = llmSettings?.state === "ready" ? "助手思考中…" : "加载本地模型并思考中…";
  renderAgent();
  let turn = null;
  try {
    const response = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // 手动出图的记录（local）只给人看，不进模型的对话历史
        messages: agent.messages
          .filter((m) => !m.local)
          .map((m) => (m.role === "user" ? { role: "user", content: m.sent, image: m.image || "", image_mode: m.image ? m.imageMode || "" : "" } : { role: "assistant", turn: m.turn })),
        target_model: currentModel(),
        pose: pose?.id || "",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join("；") : data.detail;
      throw new Error(detail || "助手没有回应");
    }
    turn = data;
    agent.messages.push({ role: "assistant", turn });
  } catch (error) {
    // 没发成功：把这句话退回输入框，对话保持原样
    agent.messages.pop();
    agent.pending = pending;
    agentInput.value = attach && text === "看看这张参考图。" ? "" : text;
    agentAttach = attach;
    renderAgentAttach();
    growAgentInput();
    toast(error.message || "助手没有回应", "error", 4000);
  } finally {
    agentBusy = false;
    llmBusy = false;
    agentSendBtn.disabled = false;
    renderAgent();
    saveAgent();
    refreshSettings().catch(() => {});
  }
  if (!turn?.generate) return;
  await applyAgentPlan(turn);
  if (agentAuto.checked) await runGeneration(turn.variants || []);
  else {
    setParamsOpen(true);
    toast("提示词和参数已填好，点「生成图片」", "success", 3500);
  }
}

agentSendBtn.addEventListener("click", sendAgent);
agentInput.addEventListener("input", growAgentInput);
agentInput.addEventListener("keydown", (event) => {
  // Enter 发送，Shift + Enter 换行；输入法选字时的回车不算
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  event.preventDefault();
  sendAgent();
});
agentNewBtn.addEventListener("click", () => {
  // 旧对话留在左侧的对话记录里；当前已经是空白的新对话就不用再开
  if (agent.messages.length && !switchChat(newChat())) return;
  agentInput.focus();
});
agentAuto.addEventListener("change", saveAgent);

/* ---------------- AI 助手的参考图：附在输入框里，随下一句话发给助手 ---------------- */
// 助手能看见这张图：可以照着它写提示词，也可以决定出图时按它重绘（图生图）
let agentAttach = null; // 待发送的参考图地址（已经存到服务器的 /outputs/refs/…）
const ATTACH_MODE_KEY = "aigen.attach.mode";
const ATTACH_MODE_NOTES = {
  ref: "把这张图当底图重绘，构图和内容会跟着原图走。说说想改什么，不说就照原图重画。",
  describe: "助手只看图写提示词，出图时不用这张图，画面是全新生成的。",
};

// 参考图用法：ref 图生图（默认） / describe 只提取提示词
function attachMode() {
  return $("button.active", attachModeSeg)?.dataset.mode || "ref";
}
function setAttachMode(mode) {
  for (const btn of $$("button", attachModeSeg)) btn.classList.toggle("active", btn.dataset.mode === mode);
  attachModeNote.textContent = ATTACH_MODE_NOTES[mode];
}
attachModeSeg.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-mode]");
  if (!btn) return;
  setAttachMode(btn.dataset.mode);
  store.set(ATTACH_MODE_KEY, btn.dataset.mode);
});
setAttachMode(store.get(ATTACH_MODE_KEY, "ref") === "describe" ? "describe" : "ref");

function renderAgentAttach() {
  composerAttach.hidden = !agentAttach;
  composerAttachBtn.classList.toggle("chip-on", !!agentAttach);
  if (agentAttach) composerAttachImg.src = agentAttach;
}

// src：浏览器里读出来的 data URL，或 /outputs/ 下已有图片的地址
async function agentAttachSrc(src) {
  try {
    const response = await fetch("/api/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: src }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "参考图上传失败");
    agentAttach = data.url;
    renderAgentAttach();
    agentInput.focus();
  } catch (error) {
    toast(error.message || "参考图上传失败", "error", 3500);
  }
}

async function agentAttachFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("请选择图片文件", "error");
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    // 上传前把长边压到 2048 以内
    const img = await loadImage(url);
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    await agentAttachSrc(canvas.toDataURL("image/png"));
  } catch {
    toast("这张图片浏览器读不了，换一张试试", "error");
  } finally {
    URL.revokeObjectURL(url);
  }
}

composerAttachBtn.addEventListener("click", () => agentFile.click());
agentFile.addEventListener("change", () => {
  agentAttachFile(agentFile.files[0]);
  agentFile.value = "";
});
composerAttachClear.addEventListener("click", () => {
  agentAttach = null;
  renderAgentAttach();
});
promptHelper.addEventListener("dragover", (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
  promptHelper.classList.add("is-over");
});
promptHelper.addEventListener("dragleave", (event) => {
  if (!promptHelper.contains(event.relatedTarget)) promptHelper.classList.remove("is-over");
});
promptHelper.addEventListener("drop", (event) => {
  event.preventDefault();
  promptHelper.classList.remove("is-over");
  agentAttachFile(event.dataTransfer.files[0]);
});

// 对话里最近一次附的参考图：之后的轮次里助手说「按参考图重绘」指的就是它
function agentRefImage() {
  for (let i = agent.messages.length - 1; i >= 0; i -= 1) if (agent.messages[i].image) return agent.messages[i].image;
  return null;
}

/* ---------------- 本地 LLM 状态 ---------------- */
let llmSettings = null;
let llmBusy = false;
const LLM_STATE_TEXT = { ready: "已就绪", loading: "加载中…", stopped: "待命，发消息时自动加载", missing: "不可用" };

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
      agentSetProgress(busyText.textContent);
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
    params.pose ? `姿势 ${poseLabel(resolvePose(params.pose))} · 强度 ${params.pose_scale}` : null,
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runGeneration();
});

// 按表单当前的参数出图（点「生成图片」和 AI 助手自动出图都走这里）
// variants：助手给每张图各写的一句补充（机位、构图、光线…），接在提示词后面，让同一批的几张有区别
async function runGeneration(variants = []) {
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
  if (base.pose) {
    if (familyOf(base.model) !== "zimage") {
      toast("参考姿势只支持 Z-Image Turbo：换成 Z-Image，或者移除姿势", "error", 4000);
      return;
    }
    if (poseLib && !poseLib.controlnet.installed) {
      toast("还要先下载姿势控制模型（参数面板「参考姿势」里）", "error", 4000);
      if (promptMode() === "agent") setParamsOpen(true);
      cnDownload.scrollIntoView({ block: "center" });
      return;
    }
  }
  const usedRef = refImage;
  const usedPose = base.pose ? pose : null;
  base.init_image = usedRef ? usedRef.src : "";
  const count = readCount();
  // 助手模式下，同一段对话出的图都归到这段对话的图片夹里
  base.batch = promptMode() === "agent" ? chatBatch(agent) : count > 1 ? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : "";
  saveForm();
  stopRequested = false;
  batch = { index: 1, count };
  agentGenStart(count, base);
  setBusy(true);
  let done = 0;
  let totalSeconds = 0;
  const seeds = [];
  let failure = "";
  try {
    // 多张是一张一张地生成：显存占用不变，每张有自己的 Seed，出一张显示一张
    for (let i = 0; i < count && !stopRequested; i += 1) {
      batch.index = i + 1;
      lastProgress = null;
      busyTimerTick?.();
      const payload = { ...base, seed: base.seed == null ? null : (base.seed + i) % 2 ** 32 };
      if (variants[i]) payload.prompt = `${base.prompt}\n${variants[i]}`;
      const data = await requestGenerate(payload);
      done += 1;
      seeds.push(data.seed);
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
      agentGenImage(data.url, data.seed, payload.width, payload.height);
      updateLastRun(data.gpu_metrics);
      const saved = `已保存到 outputs/${data.url.split("/").pop()}`;
      runInfo.textContent = count > 1 ? `第 ${done} / ${count} 张 · ${saved}` : saved;
    }
    if (count > 1) toast(`${done < count ? "已停止 · " : ""}生成了 ${done} 张 · 共 ${totalSeconds.toFixed(1)}s`, "success", 3500);
    else toast(`生成完成 · ${totalSeconds.toFixed(1)}s`, "success");
  } catch (error) {
    failure = error.message || "生成失败";
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
    agentGenEnd(seeds, base.prompt, usedRef ? base.strength : null, failure, usedPose ? poseLabel(usedPose) : "");
  }
}

stopBatchBtn.addEventListener("click", () => {
  stopRequested = true;
  stopBatchBtn.disabled = true;
  stopBatchBtn.textContent = "这张完成后就停";
});

// 把一张已有的图当参考图：助手模式下放进输入框（下一句话带给助手），否则放进参数表单
function useAsRef(url) {
  if (promptMode() === "agent") {
    agentAttachSrc(url).then(() => agentAttach && toast("已放进输入框，说说想怎么用这张图", "success", 3200));
    return;
  }
  setRef(url);
  toast("已把这张图设为参考图");
}

useRefBtn.addEventListener("click", () => {
  if (!currentResult) return;
  useAsRef(currentResult.url);
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !$(".modal-overlay") && promptMode() !== "gallery") {
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

// 同一次生成的几张叠成一摞（最上面是第 1 张，后面露出第 2、3 张），点击像打开文件夹一样弹出
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
          <div class="thumb-media" role="button" tabindex="0" data-group="${key}" title="${isChatGroup(group.key) ? "同一段对话" : "同一次生成"}的 ${n} 张，点击打开">
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
    const chat = isChatGroup(key) ? chats.find((c) => chatBatch(c) === key) : null;
    $(".folder-title", modal).textContent = `${isChatGroup(key) ? "同一段对话" : "同一次生成"} · ${items.length} 张`;
    $(".folder-prompt", modal).textContent = chat ? `对话：${chatTitle(chat)}` : items[0].item.prompt || "无提示词";
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
    message: `${isChatGroup(key) ? "这段对话里出的" : "同一次生成的"}这几张图片和它们的参数记录会从 outputs 目录删除，无法恢复。`,
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
    // 参数填进了表单：在画廊里就跳到手动出图，在助手里就把参数面板打开，让人看得到
    if (promptMode() === "gallery") setPromptMode("en");
    else if (promptMode() === "agent") setParamsOpen(true);
    saveForm();
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
      useAsRef(images[index].url);
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
  refreshPoses().catch(() => {});
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
restoreAgent();
resetPreview();
refreshAll();
setInterval(refreshGpu, 1000);
setInterval(refreshStatus, 15000);
