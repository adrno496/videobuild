import { TEMPLATES } from "./templates.js";
import { saveKeys, loadKeys, testKeys, pexelsImageSearch, pexelsVideoSearch, pixabayMusicSearch, elevenLabsTTS, openAITTS, fetchAsBuffer, aiGenerateScript, aiImproveScript, aiGenerateStockQueries, llmComplete } from "./api.js";
import { compose, renderTextOverlay, renderFinalCard, compositeImageWithOverlay } from "./composer.js";
import {
  saveFormState, loadFormState, clearFormState,
  dbPutUpload, dbGetAllUploads, dbClearUploads,
  exportProjectJSON, importProjectJSON,
  encryptKeys, decryptKeys, keysAreEncrypted,
  saveBrand, loadBrand
} from "./storage.js";

// ─── Bitrate presets per export target ───────────────────
const PRESETS = {
  tiktok:   { videoBitrate: "8M",  audioBitrate: "192k", profile: "main",     fps: 30 },
  reels:    { videoBitrate: "6M",  audioBitrate: "192k", profile: "main",     fps: 30 },
  shorts:   { videoBitrate: "10M", audioBitrate: "192k", profile: "high",     fps: 30 },
  linkedin: { videoBitrate: "5M",  audioBitrate: "128k", profile: "main",     fps: 30 },
  standard: { videoBitrate: "4M",  audioBitrate: "128k", profile: "baseline", fps: 30 }
};

// iOS detection (webkitdirectory ignored, memory limits, etc.)
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ─── State ───────────────────────────────────────────
const state = {
  template: "viral",
  uploads: [],            // [{ name, type: "image"|"video", buf: ArrayBuffer }]
  stockResults: [],       // [{ buf, type, query }]
  visualSource: "upload", // "upload" | "stock"
  projectDigest: "",      // text digest of uploaded project folder, fed to LLM
  uploadedMusic: null     // { buf: ArrayBuffer, name } — user-provided music
};

// ─── Init ─────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  initErrorHandling();
  initTabs();
  initKeysPanel();
  initBuildPanel();
  initBrandPanel();
  initProjectIO();
  initKeyboardShortcuts();
  initIOSAdjustments();

  applyTemplate("viral");
  loadFormState();          // restore form fields
  await restoreUploads();   // restore uploaded files from IndexedDB
  updateScriptCounter();
  registerServiceWorker();  // PWA + offline cache
});

// ─── Service Worker ───────────────────────────────────
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.log("SW registered:", reg.scope);
  } catch (e) {
    console.warn("SW registration failed:", e);
  }
}

// ─── Global error handling ────────────────────────────
function initErrorHandling() {
  window.addEventListener("error", (e) => {
    log(`❌ ${e.message} (${e.filename}:${e.lineno})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason?.message || String(e.reason);
    log(`❌ Promise unhandled: ${msg}`);
  });
}

// ─── iOS adjustments ──────────────────────────────────
function initIOSAdjustments() {
  if (!IS_IOS) return;
  // Folder picker is broken on iOS — replace with a hint
  const folder = $("#proj-folder");
  if (folder) {
    folder.disabled = true;
    folder.title = "iOS ne supporte pas l'upload de dossier";
    const summary = $("#folder-summary");
    if (summary) summary.textContent = "ℹ️ iOS ne supporte pas l'upload de dossier — utilise un autre device.";
  }
  // Cap duration to 30s on iOS to avoid OOM
  const dur = $("#proj-duration");
  if (dur) dur.max = "30";
}

// ─── Tabs ─────────────────────────────────────────────
function initTabs() {
  $$(".nav-btn").forEach(btn => {
    if (btn.id === "hard-refresh") {
      btn.addEventListener("click", hardRefresh);
      return;
    }
    btn.addEventListener("click", () => {
      $$(".nav-btn").forEach(b => { if (b.id !== "hard-refresh") b.classList.remove("active"); });
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      $$("section.tab").forEach(s => s.hidden = s.dataset.tab !== tab);
    });
  });
  $$(".tab-mini").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab-mini").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const v = btn.dataset.vis;
      $$(".tab-content[data-vis]").forEach(s => s.hidden = s.dataset.vis !== v);
      state.visualSource = v;
    });
  });
}

// ─── Keys panel ───────────────────────────────────────
function initKeysPanel() {
  const k = loadKeys();
  $("#key-pexels").value = k.pexels;
  $("#key-pixabay").value = k.pixabay;
  $("#key-elevenlabs").value = k.elevenlabs;
  $("#key-anthropic").value = k.anthropic;
  $("#key-openai").value = k.openai;
  $("#key-mistral").value = k.mistral;
  $("#key-openrouter").value = k.openrouter;
  $("#llm-provider").value = k.llmProvider;

  $("#save-keys").addEventListener("click", () => {
    saveKeys({
      pexels: $("#key-pexels").value.trim(),
      pixabay: $("#key-pixabay").value.trim(),
      elevenlabs: $("#key-elevenlabs").value.trim(),
      anthropic: $("#key-anthropic").value.trim(),
      openai: $("#key-openai").value.trim(),
      mistral: $("#key-mistral").value.trim(),
      openrouter: $("#key-openrouter").value.trim(),
      llmProvider: $("#llm-provider").value
    });
    setKeyStatus("✅ Clés enregistrées localement.", "ok");
  });

  $("#test-keys").addEventListener("click", async () => {
    setKeyStatus("⏳ Test en cours…", "");
    const r = await testKeys();
    const ok = Object.values(r).every(v => v === "ok");
    const msg = Object.entries(r).map(([k, v]) => `• ${k}: ${v === "ok" ? "✅" : "❌ " + v}`).join("\n");
    setKeyStatus(msg, ok ? "ok" : "err");
  });

  // Encryption
  refreshEncryptionStatus();
  $("#encrypt-keys").addEventListener("click", async () => {
    const pp = $("#passphrase").value;
    if (!pp || pp.length < 8) { alert("Passphrase de 8+ caractères requise."); return; }
    if (keysAreEncrypted()) { alert("Déjà chiffré. Déchiffre d'abord."); return; }
    try {
      await encryptKeys(pp);
      // Clear inputs since values are now encrypted
      ["pexels", "pixabay", "elevenlabs", "anthropic", "openai", "mistral", "openrouter"].forEach(k => $(`#key-${k}`).value = "");
      $("#passphrase").value = "";
      refreshEncryptionStatus();
      alert("✅ Clés chiffrées.");
    } catch (e) { alert("❌ " + e.message); }
  });
  $("#decrypt-keys").addEventListener("click", async () => {
    const pp = $("#passphrase").value;
    if (!pp) { alert("Passphrase requise."); return; }
    try {
      await decryptKeys(pp);
      const k = loadKeys();
      $("#key-pexels").value = k.pexels;
      $("#key-pixabay").value = k.pixabay;
      $("#key-elevenlabs").value = k.elevenlabs;
      $("#key-anthropic").value = k.anthropic;
      $("#key-openai").value = k.openai;
      $("#key-mistral").value = k.mistral;
      $("#key-openrouter").value = k.openrouter;
      $("#passphrase").value = "";
      refreshEncryptionStatus();
      alert("✅ Clés déchiffrées.");
    } catch (e) { alert("❌ " + e.message); }
  });
}

function refreshEncryptionStatus() {
  const el = $("#encryption-status");
  if (!el) return;
  el.textContent = keysAreEncrypted() ? "🔒 Tes clés sont chiffrées." : "🔓 Tes clés sont en clair dans localStorage.";
}

function setKeyStatus(msg, kind) {
  const el = $("#keys-status");
  el.textContent = msg;
  el.className = kind || "";
  el.style.whiteSpace = "pre-line";
}

// ─── Build panel ──────────────────────────────────────
function initBuildPanel() {
  // template selection
  $$(".template-card").forEach(card => {
    card.addEventListener("click", () => applyTemplate(card.dataset.template));
  });

  // script char/scene counter
  $("#proj-script").addEventListener("input", updateScriptCounter);

  // upload images
  $("#upload-images").addEventListener("change", handleUpload);

  // fetch stock
  $("#fetch-stock").addEventListener("click", fetchStock);

  // Project folder ingestion (for LLM context)
  $("#proj-folder").addEventListener("change", handleProjectFolder);

  // AI helpers
  $("#ai-script").addEventListener("click", () => aiAction("generate"));
  $("#ai-improve").addEventListener("click", () => aiAction("improve"));
  $("#ai-queries").addEventListener("click", () => aiAction("queries"));

  // generate
  $("#generate").addEventListener("click", generate);
  $("#reset").addEventListener("click", () => location.reload());

  // A/B hooks
  $("#ai-hooks").addEventListener("click", generateHookVariants);

  // Drag & drop on dropzone
  initDragDrop();

  // Voice picker: show custom ID input if "custom" selected
  $("#voice-id").addEventListener("change", (e) => {
    $("#voice-custom-id").style.display = e.target.value === "custom" ? "block" : "none";
  });

  // User-uploaded music
  $("#music-upload").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) { state.uploadedMusic = null; $("#music-upload-info").textContent = ""; return; }
    if (f.size > 20 * 1024 * 1024) { alert("Fichier audio > 20 Mo, ça va ralentir le rendu."); }
    const buf = await f.arrayBuffer();
    state.uploadedMusic = { buf, name: f.name };
    $("#music-upload-info").textContent = `✓ ${f.name} (${(buf.byteLength / 1024 / 1024).toFixed(1)} Mo)`;
  });

  // Auto-save form state on every input
  const debouncedSave = debounce(() => {
    saveFormState();
    showAutoSave("💾 enregistré");
  }, 400);
  document.addEventListener("input", (e) => {
    if (e.target.matches("#proj-name, #proj-lang, #proj-format, #proj-duration, #proj-pitch, #proj-script, #music-query, #voice-id, #voice-style")) {
      debouncedSave();
    }
  });
}

function showAutoSave(msg) {
  const el = $("#autosave-indicator");
  if (!el) return;
  el.textContent = msg;
  clearTimeout(showAutoSave._t);
  showAutoSave._t = setTimeout(() => { el.textContent = ""; }, 1500);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Drag & drop ──────────────────────────────────────
function initDragDrop() {
  const zone = $("#dropzone");
  if (!zone) return;
  ["dragenter", "dragover"].forEach(ev => {
    zone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add("dragging"); });
  });
  ["dragleave", "drop"].forEach(ev => {
    zone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove("dragging"); });
  });
  zone.addEventListener("drop", async (e) => {
    const files = Array.from(e.dataTransfer.files || []).filter(f => /^(image|video)\//.test(f.type));
    if (files.length) await ingestFiles(files);
  });
}

// ─── Keyboard shortcuts ───────────────────────────────
function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "g") {
      e.preventDefault();
      $("#generate").click();
    } else if (meta && e.key.toLowerCase() === "s") {
      e.preventDefault();
      const saveBtn = $("#save-keys");
      if (!document.querySelector("section.tab[data-tab='keys']").hidden) saveBtn.click();
      else { saveFormState(); showAutoSave("💾 sauvegardé"); }
    } else if (e.key === "Escape") {
      const variants = $("#hooks-variants");
      if (variants && variants.style.display !== "none") {
        variants.style.display = "none";
        variants.innerHTML = "";
      }
    }
  });
}

// ─── Project export / import ──────────────────────────
function initProjectIO() {
  $("#project-export").addEventListener("click", () => {
    const json = exportProjectJSON();
    const name = ($("#proj-name").value.trim() || "projet").toLowerCase().replace(/\s+/g, "-");
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.montage.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#project-import").addEventListener("click", () => $("#project-import-input").click());
  $("#project-import-input").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = importProjectJSON(text);
      if (data.template) applyTemplate(data.template);
      loadFormState(); // re-read into fields
      updateScriptCounter();
      alert("✅ Projet importé.");
    } catch (err) {
      alert("❌ Fichier invalide: " + err.message);
    }
  });
  $("#project-clear").addEventListener("click", async () => {
    if (!confirm("Vider tout le projet (champs + uploads) ? Tes clés API restent.")) return;
    clearFormState();
    await dbClearUploads();
    state.uploads = [];
    state.stockResults = [];
    state.projectDigest = "";
    renderUploadPreview();
    location.reload();
  });
}

// ─── Brand kit ────────────────────────────────────────
function initBrandPanel() {
  const brand = loadBrand();
  if (brand.colorPrimary) $("#brand-color-primary").value = brand.colorPrimary;
  if (brand.colorBg) $("#brand-color-bg").value = brand.colorBg;
  if (brand.logoDataURL) {
    $("#brand-logo-preview").innerHTML = `<img src="${brand.logoDataURL}" style="max-height:80px;background:#fff;padding:4px;border-radius:4px">`;
  }

  $("#brand-logo").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { alert("Logo trop gros (max 2 Mo)."); return; }
    const dataURL = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(f);
    });
    const b = loadBrand();
    b.logoDataURL = dataURL;
    saveBrand(b);
    $("#brand-logo-preview").innerHTML = `<img src="${dataURL}" style="max-height:80px;background:#fff;padding:4px;border-radius:4px">`;
  });

  $("#brand-save").addEventListener("click", () => {
    const b = loadBrand();
    b.colorPrimary = $("#brand-color-primary").value;
    b.colorBg = $("#brand-color-bg").value;
    saveBrand(b);
    alert("✅ Brand kit enregistré.");
  });
  $("#brand-clear").addEventListener("click", () => {
    if (!confirm("Reset brand kit ?")) return;
    saveBrand({});
    $("#brand-color-primary").value = "#ffb300";
    $("#brand-color-bg").value = "#0a0a0c";
    $("#brand-logo-preview").innerHTML = "";
    $("#brand-logo").value = "";
  });
}

// ─── A/B hook variants ────────────────────────────────
async function generateHookVariants() {
  const status = $("#ai-status");
  const pitch = $("#proj-pitch").value.trim() || $("#proj-name").value.trim();
  const lang = $("#proj-lang").value;
  if (!pitch) { alert("Renseigne un pitch ou nom de projet."); return; }
  status.textContent = "⏳ génération 3 hooks…";
  try {
    const out = await llmComplete({
      system: `Tu génères 3 hooks d'accroche pour une pub vidéo verticale en ${lang === "fr" ? "français" : "english"}. Chaque hook = UNE phrase courte (max 8 mots), punchy. Format: une ligne par hook, rien d'autre.`,
      user: `Pitch: ${pitch}${state.projectDigest ? `\n\nContexte projet:\n<project>\n${state.projectDigest.slice(0, 8000)}\n</project>` : ""}\n\nGénère 3 hooks différents (intrigue, douleur, CTA direct).`,
      maxTokens: 200,
      temperature: 0.95
    });
    const hooks = out.split("\n").map(l => l.replace(/^[-\d.\s)]+/, "").trim()).filter(Boolean).slice(0, 3);
    const container = $("#hooks-variants");
    container.style.display = "flex";
    container.innerHTML = hooks.map((h, i) =>
      `<button class="secondary" data-hook="${encodeURIComponent(h)}" type="button" style="text-align:left">🎯 ${i + 1}. ${h}</button>`
    ).join("");
    container.querySelectorAll("button").forEach(b => {
      b.addEventListener("click", () => {
        const hook = decodeURIComponent(b.dataset.hook);
        const lines = $("#proj-script").value.split("\n");
        lines[0] = hook;
        $("#proj-script").value = lines.join("\n");
        updateScriptCounter();
        container.style.display = "none";
        container.innerHTML = "";
      });
    });
    status.textContent = `✨ 3 hooks générés — clique pour utiliser`;
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
  }
}

// ─── Project folder digest ────────────────────────────
// Filter rules: text files only, skip heavy/irrelevant dirs, cap total size.
const FOLDER_IGNORE_DIRS = /(?:^|\/)(?:node_modules|\.git|\.next|\.nuxt|dist|build|out|coverage|\.cache|\.turbo|\.vercel|\.expo|\.idea|\.vscode|target|vendor|\.venv|venv|__pycache__|\.gradle|Pods)(?:\/|$)/;
const FOLDER_PRIORITY = [
  /(^|\/)README(\.md|\.txt)?$/i,
  /(^|\/)readme(\.md|\.txt)?$/,
  /(^|\/)package\.json$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)Cargo\.toml$/,
  /(^|\/)go\.mod$/,
  /(^|\/)composer\.json$/,
  /(^|\/)Gemfile$/,
  /(^|\/)pubspec\.yaml$/,
  /(^|\/)app\.json$/,
  /(^|\/)manifest\.json$/,
  /(^|\/)index\.(html|tsx?|jsx?)$/,
  /(^|\/)main\.(tsx?|jsx?|py|go|rs)$/,
  /(^|\/)App\.(tsx?|jsx?|vue|svelte)$/,
  /(^|\/).*\.md$/i
];
const FOLDER_TEXT_EXT = /\.(md|txt|json|toml|yaml|yml|html|css|scss|less|js|jsx|ts|tsx|vue|svelte|py|rb|go|rs|java|kt|swift|dart|php|sql|env\.example|sh)$/i;
const MAX_FILE_SIZE = 80 * 1024;     // 80 KB per file
const MAX_DIGEST_SIZE = 60 * 1024;   // 60 KB total → ~15k tokens

async function handleProjectFolder(e) {
  const files = Array.from(e.target.files || []);
  const summary = $("#folder-summary");
  if (!files.length) { state.projectDigest = ""; summary.textContent = ""; return; }
  summary.textContent = `⏳ analyse de ${files.length} fichiers…`;

  // Keep only text files outside ignore-dirs
  const candidates = files
    .filter(f => {
      const path = f.webkitRelativePath || f.name;
      if (FOLDER_IGNORE_DIRS.test("/" + path)) return false;
      if (f.size > MAX_FILE_SIZE) return false;
      return FOLDER_TEXT_EXT.test(path);
    })
    .map(f => ({ file: f, path: f.webkitRelativePath || f.name }))
    .sort((a, b) => priorityRank(a.path) - priorityRank(b.path));

  let digest = "";
  let included = 0;
  for (const { file, path } of candidates) {
    if (digest.length >= MAX_DIGEST_SIZE) break;
    try {
      const text = await file.text();
      const remaining = MAX_DIGEST_SIZE - digest.length;
      const chunk = text.length > remaining ? text.slice(0, remaining) + "\n…[truncated]" : text;
      digest += `\n\n=== ${path} ===\n${chunk}`;
      included++;
    } catch {}
  }
  state.projectDigest = digest.trim();
  summary.textContent = `✓ ${included} fichiers indexés (${(state.projectDigest.length / 1024).toFixed(1)} Ko de contexte pour l'IA)`;
}

function priorityRank(path) {
  for (let i = 0; i < FOLDER_PRIORITY.length; i++) {
    if (FOLDER_PRIORITY[i].test(path)) return i;
  }
  return FOLDER_PRIORITY.length + path.split("/").length;
}

async function hardRefresh() {
  if (!confirm("Vider les caches et recharger ?\n\n• Cache API + service workers purgés\n• ffmpeg.wasm sera retéléchargé\n• Tes clés API restent enregistrées")) return;
  const btn = $("#hard-refresh");
  btn.disabled = true;
  btn.textContent = "⏳ purge…";
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {
    console.warn("hard refresh partial:", e);
  }
  // Cache-busting reload: bypasses HTTP cache by forcing a unique URL.
  const url = new URL(location.href);
  url.searchParams.set("_t", Date.now().toString());
  location.replace(url.toString());
}

async function aiAction(kind) {
  const status = $("#ai-status");
  const setBusy = (msg) => { status.textContent = msg; };
  try {
    const lang = $("#proj-lang").value;
    const pitch = $("#proj-pitch").value.trim() || $("#proj-name").value.trim();
    const tpl = state.template;
    const duration = parseFloat($("#proj-duration").value) || 25;

    const projectDigest = state.projectDigest;
    if (kind === "generate") {
      if (!pitch && !projectDigest) { alert("Renseigne un pitch, un nom de projet, ou uploade le dossier du projet."); return; }
      setBusy("⏳ génération script…");
      const script = await aiGenerateScript({ pitch, lang, template: tpl, duration, projectDigest });
      $("#proj-script").value = script;
      updateScriptCounter();
      setBusy("✨ script généré");
    } else if (kind === "improve") {
      const existing = $("#proj-script").value.trim();
      if (!existing) { alert("Écris d'abord un script à améliorer."); return; }
      setBusy("⏳ amélioration…");
      const script = await aiImproveScript({ existing, lang, template: tpl, projectDigest });
      $("#proj-script").value = script;
      updateScriptCounter();
      setBusy("✨ script amélioré");
    } else if (kind === "queries") {
      const lines = $("#proj-script").value.split("\n").map(l => l.trim()).filter(Boolean);
      if (!lines.length) { alert("Écris d'abord un script."); return; }
      setBusy("⏳ génération queries…");
      const queries = await aiGenerateStockQueries({ scriptLines: lines, pitch, projectDigest });
      const inputs = $$(".stock-q");
      queries.forEach((q, i) => { if (inputs[i]) inputs[i].value = q; });
      setBusy(`✨ ${queries.length} queries générées`);
    }
  } catch (e) {
    console.error(e);
    setBusy(`❌ ${e.message}`);
  }
}

function applyTemplate(tplName) {
  state.template = tplName;
  const tpl = TEMPLATES[tplName];
  $$(".template-card").forEach(c => c.classList.toggle("selected", c.dataset.template === tplName));

  $("#proj-duration").value = tpl.duration;
  $("#music-query").value = tpl.musicQuery;
  if (tpl.voiceStyle === null) {
    $("#voice-id").value = "";
  } else {
    $("#voice-style").value = String(tpl.voiceStyle);
  }

  const appName = $("#proj-name").value.trim() || "Mon App";
  if (tpl.scriptTemplate) {
    $("#proj-script").value = tpl.scriptTemplate(appName);
    updateScriptCounter();
  }

  rebuildStockQueriesUI();
}

function rebuildStockQueriesUI() {
  const tpl = TEMPLATES[state.template];
  const container = $("#stock-queries");
  container.innerHTML = "";
  // One stock query per script line
  const lines = $("#proj-script").value.split("\n").filter(l => l.trim());
  const queries = tpl.stockQueries.length ? tpl.stockQueries : new Array(lines.length).fill("");
  lines.forEach((line, i) => {
    const row = document.createElement("div");
    row.className = "stock-row";
    row.innerHTML = `
      <span class="scene-label">Scène ${i + 1}</span>
      <input class="stock-q" data-scene="${i}" placeholder="ex: ${queries[i] || "athletic dramatic dark"}" value="${queries[i] || ""}">
    `;
    container.appendChild(row);
  });
}

function updateScriptCounter() {
  const v = $("#proj-script").value;
  $("#script-chars").textContent = v.length;
  $("#script-scenes").textContent = v.split("\n").filter(l => l.trim()).length;
  rebuildStockQueriesUI();
}

// ─── Uploads ──────────────────────────────────────────
async function handleUpload(e) {
  const files = Array.from(e.target.files || []);
  await ingestFiles(files);
}

async function ingestFiles(files) {
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const type = f.type.startsWith("video/") ? "video" : "image";
    const blob = new Blob([buf], { type: f.type });
    const url = URL.createObjectURL(blob);
    const upload = { name: f.name, type, buf, url, mimeType: f.type };
    state.uploads.push(upload);
    // Persist to IndexedDB so reload doesn't lose them
    try {
      await dbPutUpload({ name: f.name, type, mimeType: f.type, blob });
    } catch (err) {
      console.warn("IDB save failed:", err);
    }
  }
  renderUploadPreview();
}

async function restoreUploads() {
  try {
    const records = await dbGetAllUploads();
    for (const r of records) {
      const buf = await r.blob.arrayBuffer();
      const url = URL.createObjectURL(r.blob);
      state.uploads.push({ name: r.name, type: r.type, buf, url, mimeType: r.mimeType });
    }
    if (records.length) renderUploadPreview();
  } catch (e) {
    console.warn("restoreUploads failed:", e);
  }
}

function renderUploadPreview() {
  const grid = $("#upload-preview");
  grid.innerHTML = "";
  state.uploads.forEach((u, idx) => {
    const item = document.createElement("div");
    item.className = "item";
    if (u.type === "video") {
      item.innerHTML = `<video src="${u.url}" muted playsinline></video><span class="label">Sc.${idx + 1}</span><span class="remove" data-idx="${idx}">×</span>`;
    } else {
      item.innerHTML = `<img src="${u.url}"><span class="label">Sc.${idx + 1}</span><span class="remove" data-idx="${idx}">×</span>`;
    }
    grid.appendChild(item);
  });
  grid.querySelectorAll(".remove").forEach(b => b.addEventListener("click", e => {
    const i = +e.target.dataset.idx;
    state.uploads.splice(i, 1);
    renderUploadPreview();
  }));
}

// ─── Stock fetch ──────────────────────────────────────
async function fetchStock() {
  const queries = Array.from($$(".stock-q")).map(i => i.value.trim()).filter(Boolean);
  if (!queries.length) { alert("Renseigne au moins 1 query."); return; }
  $("#fetch-stock").disabled = true;
  state.stockResults = [];
  const grid = $("#stock-preview");
  grid.innerHTML = "";

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const photos = await pexelsImageSearch(q, { perPage: 5 });
      const pick = photos[0];
      if (!pick) { console.warn(`No result for: ${q}`); continue; }
      const url = pick.src.large2x || pick.src.large || pick.src.original;
      const buf = await fetchAsBuffer(url);
      state.stockResults.push({ buf, type: "image", query: q, url });
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<img src="${url}"><span class="label">Sc.${i + 1}</span>`;
      grid.appendChild(item);
    } catch (e) {
      console.error(`Stock fetch fail for "${q}":`, e);
      const item = document.createElement("div");
      item.className = "item";
      item.style.background = "#3a1010";
      item.innerHTML = `<span class="label">❌ ${e.message.slice(0, 30)}</span>`;
      grid.appendChild(item);
    }
  }
  $("#fetch-stock").disabled = false;
}

// ─── Generate ─────────────────────────────────────────
async function generate() {
  const generateBtn = $("#generate");
  generateBtn.disabled = true;
  $("#progress").hidden = false;
  $("#output").hidden = true;
  log("🚀 Démarrage…");
  setProgress(0, "Préparation…");

  try {
    const projName = $("#proj-name").value.trim() || "MyApp";
    const lang = $("#proj-lang").value;
    const format = $("#proj-format").value;
    const totalDuration = parseFloat($("#proj-duration").value) || 25;
    const tpl = TEMPLATES[state.template];

    const scriptLines = $("#proj-script").value.split("\n").map(l => l.trim()).filter(Boolean);
    const voiceSel = $("#voice-id").value;
    const useVoice = !!voiceSel && scriptLines.length > 0;
    const useOpenAITTS = voiceSel.startsWith("openai:");
    const openAIVoice = useOpenAITTS ? voiceSel.slice("openai:".length) : null;
    const voiceId = voiceSel === "custom" ? $("#voice-custom-id").value.trim() : voiceSel;
    const voiceStyle = parseFloat($("#voice-style").value || "0.4");
    if (useVoice && !useOpenAITTS && voiceSel === "custom" && !voiceId) {
      throw new Error("Voix custom sélectionnée mais ID vide.");
    }

    // Pick visuals
    const visuals = state.visualSource === "upload" ? state.uploads : state.stockResults;
    if (!visuals.length) throw new Error("Aucun visuel — uploade des images ou récupère du stock.");

    // Plan scenes: distribute total duration across N scenes (last is logo card)
    const N_visual = Math.min(visuals.length, scriptLines.length || visuals.length);
    const logoDur = 2.5;
    const visualDur = (totalDuration - logoDur) / N_visual;
    setProgress(10, `Plan: ${N_visual} scènes × ${visualDur.toFixed(1)}s + logo card`);

    // Run TTS + music in parallel — ~2× faster than sequential
    setProgress(15, "Voix off + musique en parallèle…");
    const ttsPromise = !useVoice ? Promise.resolve(null)
      : useOpenAITTS ? openAITTS(scriptLines.join(" "), { voice: openAIVoice })
          .then(buf => { log(`✓ voix off (OpenAI ${openAIVoice}) ${(buf.byteLength / 1024).toFixed(1)} Ko`); return buf; })
          .catch(e => { log(`⚠ OpenAI TTS: ${e.message}`); return null; })
      : elevenLabsTTS(scriptLines.join(" "), { voiceId, style: voiceStyle })
          .then(buf => { log(`✓ voix off ${(buf.byteLength / 1024).toFixed(1)} Ko`); return buf; })
          .catch(e => {
            const m = /402/.test(e.message) ? "⚠ ElevenLabs 402 — free tier ne peut plus utiliser les voix de la librairie via l'API. Solutions : (1) clone ta voix dans ton compte ElevenLabs → utilise 🎤 Voix custom, (2) bascule sur OpenAI TTS." : `⚠ voix off: ${e.message}`;
            log(m); return null;
          });

    const musicQuery = $("#music-query").value.trim();
    let musicPromise;
    if (state.uploadedMusic) {
      log(`✓ musique uploadée: ${state.uploadedMusic.name}`);
      musicPromise = Promise.resolve(state.uploadedMusic.buf);
    } else if (musicQuery) {
      musicPromise = pixabayMusicSearch(musicQuery, { minDur: totalDuration, maxDur: 90 })
        .then(async track => {
          if (track && track.audio) {
            const buf = await fetchAsBuffer(track.audio);
            log(`✓ musique: ${track.title || "track"}`);
            return buf;
          }
          log("⚠ Pixabay music API indisponible — uploade ta propre musique");
          return null;
        })
        .catch(e => { log(`⚠ musique: ${e.message}`); return null; });
    } else {
      musicPromise = Promise.resolve(null);
    }

    const [narrationBuf, musicBuf] = await Promise.all([ttsPromise, musicPromise]);

    // Build scenes data — for IMAGE scenes with text overlay, we pre-composite
    // image + text in canvas to a single JPEG. ffmpeg.wasm hangs on dual-input
    // overlay pipelines (loop:1 PNG + zoompan), so this is more reliable AND faster.
    setProgress(35, "Préparation scènes…");
    const scenes = [];
    const [W, H] = format === "1:1" ? [1080, 1080] : format === "16:9" ? [1920, 1080] : [1080, 1920];
    for (let i = 0; i < N_visual; i++) {
      const v = visuals[i];
      const text = scriptLines[i] || "";
      const overlayURL = text && text.length < 80 ? renderTextOverlay({ width: W, height: H, text: text.toUpperCase() }) : null;
      if (v.type === "image" && overlayURL) {
        // Pre-composite image + overlay at target resolution
        const composedBuf = await compositeImageWithOverlay(v.buf, overlayURL, W, H);
        scenes.push({ visualBuf: composedBuf, visualType: "image", duration: visualDur, textOverlayDataURL: null });
      } else if (v.type === "image") {
        // Pre-composite image alone (handles cover-fit + color grade)
        const composedBuf = await compositeImageWithOverlay(v.buf, null, W, H);
        scenes.push({ visualBuf: composedBuf, visualType: "image", duration: visualDur, textOverlayDataURL: null });
      } else {
        // Video → keep ffmpeg overlay path (canvas pre-composite per-frame is too slow)
        scenes.push({ visualBuf: v.buf, visualType: "video", duration: visualDur, textOverlayDataURL: overlayURL });
      }
    }

    // Final logo card scene — uses brand kit colors/logo if set
    const brand = loadBrand();
    const logoCardURL = await renderFinalCard({
      width: W, height: H,
      title: projName,
      subtitle: lang === "fr" ? "Disponible maintenant" : "Available now",
      cta: lang === "fr" ? "  7 JOURS GRATUIT  " : "  7 DAYS FREE  ",
      colorPrimary: brand.colorPrimary,
      colorBg: brand.colorBg,
      logoDataURL: brand.logoDataURL
    });
    // Convert dataURL to buffer for use as image input
    const logoBuf = dataURLToArrayBuffer(logoCardURL);
    scenes.push({
      visualBuf: logoBuf,
      visualType: "image",
      duration: logoDur,
      textOverlayDataURL: null
    });

    // Compose
    const presetKey = $("#proj-preset").value || "tiktok";
    const preset = PRESETS[presetKey] || PRESETS.tiktok;
    setProgress(40, "🎬 Composition vidéo (peut prendre 1-2 min)…");
    log(`📥 Chargement ffmpeg.wasm… (preset: ${presetKey})`);
    const blob = await compose({
      scenes,
      narrationBuf,
      musicBuf,
      format,
      totalDuration,
      preset,
      onLog: m => log(m),
      onLoadProgress: p => setProgress(40 + Math.round(p * 20), `📥 Téléchargement ffmpeg.wasm… ${(p * 100).toFixed(0)}%`),
      onStageProgress: (label, frac) => setProgress(Math.round(frac * 100), `🎬 ${label}`)
    });

    setProgress(100, "✅ Terminé !");
    const url = URL.createObjectURL(blob);
    $("#output-video").src = url;
    $("#download-link").href = url;
    $("#download-link").download = `${projName.toLowerCase().replace(/\s+/g, "-")}-ad.mp4`;
    $("#output").hidden = false;
    log(`✅ ${(blob.size / 1024 / 1024).toFixed(1)} Mo`);
  } catch (e) {
    console.error(e);
    log(`❌ ${e.message}`);
    setProgress(0, "Erreur");
  } finally {
    generateBtn.disabled = false;
  }
}

function dataURLToArrayBuffer(dataURL) {
  const base64 = dataURL.split(",")[1];
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function setProgress(pct, text) {
  $("#progress-fill").style.width = `${pct}%`;
  $("#progress-text").textContent = text;
}

// Filter ffmpeg.wasm log noise that confuses users into thinking encoding failed.
// "Aborted()" is the normal wasm exit signal between exec() calls (not an error).
// "deprecated pixel format" + libx264 stats blocks are spammy but harmless.
const LOG_NOISE = [
  /^\s*$/,
  /deprecated pixel format/,
  /^\s*\[swscaler /,
  /^\s*\[libx264.*using cpu capabilities/,
  /^\s*\[libx264.*264 - core /,
  /^\s*\[libx264 @.*\] (frame [IPB]:|consecutive B-frames|mb [IPB]|coded y,uvDC|i16 |i4 |i8c |Weighted P-Frames|ref [PB] L|kb\/s:|final ratefactor|profile [A-Z])/,
  /^\s*Aborted\(\)\s*$/,
  /^ffmpeg version 5/,
  /^\s*built with emcc/,
  /^\s*configuration: /,
  /^\s*libav(util|codec|format|device|filter)\s/,
  /^\s*libsw(scale|resample)\s/,
  /^\s*libpostproc\s/,
  /^\s*Stream mapping:/,
  /^\s*Stream #0:0 \(mjpeg\) ->/,
  /^\s*Stream #1:0 \(png\) ->/,
  /^\s*(eq|scale|overlay|format):default ->/,
  /^Input #\d, /,
  /^\s*Duration: /,
  /^\s*Stream #\d:\d: /,
  /^Output #\d, /,
  /^\s*Metadata:/,
  /^\s*encoder\s+:/,
  /^\s*Side data:/,
  /^\s*cpb: /,
  /^\s*video:\d+kB audio:/,
  /^progress: /,
  /^\s*frame=\s*\d+ fps=/
];

function log(msg) {
  if (typeof msg !== "string") msg = String(msg);
  for (const rx of LOG_NOISE) if (rx.test(msg)) return;
  const el = $("#progress-log");
  el.textContent += `${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
