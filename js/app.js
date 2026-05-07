import { TEMPLATES } from "./templates.js";
import { saveKeys, loadKeys, testKeys, pexelsImageSearch, pexelsVideoSearch, pixabayMusicSearch, elevenLabsTTS, fetchAsBuffer, aiGenerateScript, aiImproveScript, aiGenerateStockQueries } from "./api.js";
import { compose, renderTextOverlay, renderFinalCard } from "./composer.js";

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ─── State ───────────────────────────────────────────
const state = {
  template: "viral",
  uploads: [],            // [{ name, type: "image"|"video", buf: ArrayBuffer }]
  stockResults: [],       // [{ buf, type, query }]
  visualSource: "upload"  // "upload" | "stock"
};

// ─── Init ─────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initKeysPanel();
  initBuildPanel();
  applyTemplate("viral");
});

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

  // AI helpers
  $("#ai-script").addEventListener("click", () => aiAction("generate"));
  $("#ai-improve").addEventListener("click", () => aiAction("improve"));
  $("#ai-queries").addEventListener("click", () => aiAction("queries"));

  // generate
  $("#generate").addEventListener("click", generate);
  $("#reset").addEventListener("click", () => location.reload());
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

    if (kind === "generate") {
      if (!pitch) { alert("Renseigne un pitch ou un nom de projet."); return; }
      setBusy("⏳ génération script…");
      const script = await aiGenerateScript({ pitch, lang, template: tpl, duration });
      $("#proj-script").value = script;
      updateScriptCounter();
      setBusy("✨ script généré");
    } else if (kind === "improve") {
      const existing = $("#proj-script").value.trim();
      if (!existing) { alert("Écris d'abord un script à améliorer."); return; }
      setBusy("⏳ amélioration…");
      const script = await aiImproveScript({ existing, lang, template: tpl });
      $("#proj-script").value = script;
      updateScriptCounter();
      setBusy("✨ script amélioré");
    } else if (kind === "queries") {
      const lines = $("#proj-script").value.split("\n").map(l => l.trim()).filter(Boolean);
      if (!lines.length) { alert("Écris d'abord un script."); return; }
      setBusy("⏳ génération queries…");
      const queries = await aiGenerateStockQueries({ scriptLines: lines, pitch });
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
  for (const f of files) {
    const buf = await f.arrayBuffer();
    state.uploads.push({
      name: f.name,
      type: f.type.startsWith("video/") ? "video" : "image",
      buf,
      url: URL.createObjectURL(f)
    });
  }
  renderUploadPreview();
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
    const useVoice = !!$("#voice-id").value && scriptLines.length > 0;
    const voiceId = $("#voice-id").value;
    const voiceStyle = parseFloat($("#voice-style").value || "0.4");

    // Pick visuals
    const visuals = state.visualSource === "upload" ? state.uploads : state.stockResults;
    if (!visuals.length) throw new Error("Aucun visuel — uploade des images ou récupère du stock.");

    // Plan scenes: distribute total duration across N scenes (last is logo card)
    const N_visual = Math.min(visuals.length, scriptLines.length || visuals.length);
    const logoDur = 2.5;
    const visualDur = (totalDuration - logoDur) / N_visual;
    setProgress(10, `Plan: ${N_visual} scènes × ${visualDur.toFixed(1)}s + logo card`);

    // Generate narration
    let narrationBuf = null;
    if (useVoice) {
      log("🎙 Génération voix off…");
      setProgress(15, "Génération voix off (ElevenLabs)…");
      const fullText = scriptLines.join(" ");
      narrationBuf = await elevenLabsTTS(fullText, { voiceId, style: voiceStyle });
      log(`✓ voix off ${(narrationBuf.byteLength / 1024).toFixed(1)} Ko`);
    }

    // Music
    let musicBuf = null;
    const musicQuery = $("#music-query").value.trim();
    if (musicQuery) {
      log(`🎵 Recherche musique: "${musicQuery}"`);
      setProgress(25, "Recherche musique…");
      try {
        const track = await pixabayMusicSearch(musicQuery, { minDur: totalDuration, maxDur: 90 });
        if (track && track.audio) {
          musicBuf = await fetchAsBuffer(track.audio);
          log(`✓ musique: ${track.title || "track"}`);
        } else {
          log("⚠ pas de musique trouvée — pub sans musique");
        }
      } catch (e) {
        log(`⚠ musique: ${e.message}`);
      }
    }

    // Build scenes data
    setProgress(35, "Préparation scènes…");
    const scenes = [];
    const [W, H] = format === "1:1" ? [1080, 1080] : format === "16:9" ? [1920, 1080] : [1080, 1920];
    for (let i = 0; i < N_visual; i++) {
      const v = visuals[i];
      const text = scriptLines[i] || "";
      const overlayURL = text && text.length < 80 ? renderTextOverlay({ width: W, height: H, text: text.toUpperCase() }) : null;
      scenes.push({
        visualBuf: v.buf,
        visualType: v.type,
        duration: visualDur,
        textOverlayDataURL: overlayURL
      });
    }

    // Final logo card scene
    const logoCardURL = renderFinalCard({
      width: W, height: H,
      title: projName,
      subtitle: lang === "fr" ? "Disponible maintenant" : "Available now",
      cta: lang === "fr" ? "  7 JOURS GRATUIT  " : "  7 DAYS FREE  "
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
    setProgress(40, "🎬 Composition vidéo (peut prendre 1-2 min)…");
    log("📥 Chargement ffmpeg.wasm…");
    const blob = await compose({
      scenes,
      narrationBuf,
      musicBuf,
      format,
      totalDuration,
      onLog: m => log(m)
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

function log(msg) {
  const el = $("#progress-log");
  el.textContent += `${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
