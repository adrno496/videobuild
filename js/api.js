// API clients for Pexels, Pixabay, ElevenLabs — all browser-side, CORS-friendly

const KEYS = {
  pexels: () => localStorage.getItem("key_pexels") || "",
  pixabay: () => localStorage.getItem("key_pixabay") || "",
  elevenlabs: () => localStorage.getItem("key_elevenlabs") || "",
  anthropic: () => localStorage.getItem("key_anthropic") || "",
  openai: () => localStorage.getItem("key_openai") || "",
  mistral: () => localStorage.getItem("key_mistral") || "",
  openrouter: () => localStorage.getItem("key_openrouter") || "",
  llmProvider: () => localStorage.getItem("llm_provider") || "anthropic"
};

export function saveKeys(k) {
  const map = {
    pexels: "key_pexels",
    pixabay: "key_pixabay",
    elevenlabs: "key_elevenlabs",
    anthropic: "key_anthropic",
    openai: "key_openai",
    mistral: "key_mistral",
    openrouter: "key_openrouter",
    llmProvider: "llm_provider"
  };
  for (const [field, storageKey] of Object.entries(map)) {
    if (k[field] !== undefined) localStorage.setItem(storageKey, k[field]);
  }
}

export function loadKeys() {
  return {
    pexels: KEYS.pexels(),
    pixabay: KEYS.pixabay(),
    elevenlabs: KEYS.elevenlabs(),
    anthropic: KEYS.anthropic(),
    openai: KEYS.openai(),
    mistral: KEYS.mistral(),
    openrouter: KEYS.openrouter(),
    llmProvider: KEYS.llmProvider()
  };
}

// ── Pexels ─────────────────────────────────────────────────
export async function pexelsImageSearch(query, { orientation = "portrait", perPage = 5 } = {}) {
  const key = KEYS.pexels();
  if (!key) throw new Error("Pexels API key missing");
  const u = new URL("https://api.pexels.com/v1/search");
  u.searchParams.set("query", query);
  u.searchParams.set("orientation", orientation);
  u.searchParams.set("per_page", perPage);
  const r = await fetch(u, { headers: { Authorization: key } });
  if (!r.ok) throw new Error(`Pexels: ${r.status}`);
  const j = await r.json();
  return j.photos || [];
}

export async function pexelsVideoSearch(query, { orientation = "portrait", minDur = 4, maxDur = 30, perPage = 8 } = {}) {
  const key = KEYS.pexels();
  if (!key) throw new Error("Pexels API key missing");
  const u = new URL("https://api.pexels.com/videos/search");
  u.searchParams.set("query", query);
  u.searchParams.set("orientation", orientation);
  u.searchParams.set("per_page", perPage);
  const r = await fetch(u, { headers: { Authorization: key } });
  if (!r.ok) throw new Error(`Pexels video: ${r.status}`);
  const j = await r.json();
  // Filter by duration & quality
  return (j.videos || [])
    .filter(v => v.duration >= minDur && v.duration <= maxDur)
    .map(v => {
      // Pick best HD vertical file
      const files = (v.video_files || [])
        .filter(f => f.width <= 1920 && f.height <= 2400)
        .sort((a, b) => (b.height || 0) - (a.height || 0));
      return {
        id: v.id,
        duration: v.duration,
        width: v.width,
        height: v.height,
        url: files[0]?.link || v.video_files?.[0]?.link,
        image: v.image
      };
    })
    .filter(v => v.url);
}

// ── Pixabay ─────────────────────────────────────────────────
export async function pixabayImageSearch(query, { orientation = "vertical", perPage = 5 } = {}) {
  const key = KEYS.pixabay();
  if (!key) throw new Error("Pixabay API key missing");
  const u = new URL("https://pixabay.com/api/");
  u.searchParams.set("key", key);
  u.searchParams.set("q", query);
  u.searchParams.set("orientation", orientation);
  u.searchParams.set("per_page", String(Math.max(3, perPage)));
  u.searchParams.set("image_type", "photo");
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Pixabay: ${r.status}`);
  const j = await r.json();
  return j.hits || [];
}

export async function pixabayMusicSearch(query, { minDur = 25, maxDur = 90 } = {}) {
  const key = KEYS.pixabay();
  if (!key) throw new Error("Pixabay API key missing");
  // Pixabay music API endpoint
  const u = new URL("https://pixabay.com/api/music/");
  u.searchParams.set("key", key);
  u.searchParams.set("q", query);
  u.searchParams.set("per_page", "20");
  let r = await fetch(u);
  // Music API may not exist publicly; fallback
  if (!r.ok) {
    // Try the general music tag fallback
    return null;
  }
  const j = await r.json();
  const hits = (j.hits || []).filter(h =>
    (h.duration || 0) >= minDur && (h.duration || 0) <= maxDur
  );
  return hits[0] || null;
}

// ── ElevenLabs ─────────────────────────────────────────────────
export async function elevenLabsTTS(text, { voiceId, style = 0.4, stability = 0.55 } = {}) {
  const key = KEYS.elevenlabs();
  if (!key) throw new Error("ElevenLabs API key missing");
  if (!voiceId) throw new Error("Voice ID missing");
  const u = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const r = await fetch(u, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability, similarity_boost: 0.8, style, use_speaker_boost: true }
    })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`ElevenLabs: ${r.status} — ${err.slice(0, 200)}`);
  }
  return await r.arrayBuffer();  // mp3 bytes
}

// ── Test keys ─────────────────────────────────────────────────
export async function testKeys() {
  const out = { pexels: null, pixabay: null, elevenlabs: null };
  try { await pexelsImageSearch("test", { perPage: 1 }); out.pexels = "ok"; } catch (e) { out.pexels = e.message; }
  try { await pixabayImageSearch("test", { perPage: 3 }); out.pixabay = "ok"; } catch (e) { out.pixabay = e.message; }
  try {
    // Light test: just hit the voice endpoint with very short text
    const ab = await elevenLabsTTS("Test.", { voiceId: "JBFqnCBsd6RMkjVDRZzb" });
    out.elevenlabs = ab && ab.byteLength > 0 ? "ok" : "empty";
  } catch (e) { out.elevenlabs = e.message; }
  return out;
}

// ── LLM (Claude / OpenAI / Mistral / OpenRouter) ─────────────────────────
// Unified prompt → text completion. Picks provider based on stored preference,
// falls back to first available key.
export async function llmComplete({ system, user, maxTokens = 800, temperature = 0.7 }) {
  const order = [KEYS.llmProvider(), "anthropic", "openai", "mistral", "openrouter"];
  const tried = new Set();
  let lastErr = null;
  for (const provider of order) {
    if (tried.has(provider)) continue;
    tried.add(provider);
    const key = (KEYS[provider] || (() => ""))();
    if (!key) continue;
    try {
      return await callLLM(provider, key, { system, user, maxTokens, temperature });
    } catch (e) {
      lastErr = e;
      console.warn(`LLM ${provider} failed:`, e.message);
    }
  }
  throw new Error(lastErr ? `Tous les LLM ont échoué (${lastErr.message})` : "Aucune clé LLM configurée");
}

async function callLLM(provider, key, { system, user, maxTokens, temperature }) {
  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content: user }]
      })
    });
    if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.content?.[0]?.text || "";
  }
  if (provider === "openai") {
    return openAICompatible("https://api.openai.com/v1/chat/completions", key, "gpt-4o-mini", { system, user, maxTokens, temperature });
  }
  if (provider === "mistral") {
    return openAICompatible("https://api.mistral.ai/v1/chat/completions", key, "mistral-small-latest", { system, user, maxTokens, temperature });
  }
  if (provider === "openrouter") {
    return openAICompatible("https://openrouter.ai/api/v1/chat/completions", key, "anthropic/claude-3.5-sonnet", { system, user, maxTokens, temperature }, {
      "HTTP-Referer": location.origin,
      "X-Title": "MontageAI"
    });
  }
  throw new Error(`provider inconnu: ${provider}`);
}

async function openAICompatible(url, key, model, { system, user, maxTokens, temperature }, extraHeaders = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!r.ok) throw new Error(`${url} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}

// High-level helpers used by the UI
export async function aiGenerateScript({ pitch, lang, template, duration }) {
  const tone = template === "viral" ? "punchy, fast-cut, hook → features → CTA"
    : template === "pov" ? "POV cinématique, posé, story-driven, métaphorique"
    : template === "asmr" ? "minimal, descriptif visuel, peu de texte"
    : "direct, sans bullshit";
  const system = `Tu es un copywriter spécialiste de pubs courtes pour réseaux sociaux. Tu écris en ${lang === "fr" ? "français" : "english"}, ton: ${tone}. UNE phrase courte par ligne (max 8 mots). Pas de hashtags, pas d'emoji, pas de numérotation. Juste le script brut, ligne par ligne.`;
  const user = `Pitch: ${pitch}\nDurée cible: ${duration}s (~${Math.max(5, Math.round(duration / 3.5))} lignes).\nÉcris UNIQUEMENT le script, une phrase par ligne.`;
  const out = await llmComplete({ system, user, maxTokens: 400, temperature: 0.85 });
  return out.split("\n").map(l => l.replace(/^[-\d.\s)]+/, "").trim()).filter(Boolean).join("\n");
}

export async function aiImproveScript({ existing, lang, template }) {
  const system = `Tu améliores un script de pub vidéo verticale en ${lang === "fr" ? "français" : "english"}. Style: ${template}. Garde le nombre de lignes. UNE phrase courte par ligne. Pas d'emoji, pas de hashtags. Réponds UNIQUEMENT avec le script amélioré.`;
  const out = await llmComplete({ system, user: existing, maxTokens: 400, temperature: 0.7 });
  return out.split("\n").map(l => l.replace(/^[-\d.\s)]+/, "").trim()).filter(Boolean).join("\n");
}

export async function aiGenerateStockQueries({ scriptLines, pitch }) {
  const system = `Tu génères des requêtes de recherche pour Pexels (banque d'images). Pour chaque ligne du script, donne UNE requête en ANGLAIS, 3-5 mots, visuels concrets et cinématiques (pas d'abstrait). Format: une requête par ligne, dans l'ordre, rien d'autre.`;
  const user = `Pitch: ${pitch || "(non précisé)"}\n\nScript:\n${scriptLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\nDonne ${scriptLines.length} requêtes Pexels en anglais, une par ligne.`;
  const out = await llmComplete({ system, user, maxTokens: 400, temperature: 0.6 });
  return out.split("\n").map(l => l.replace(/^[-\d.\s)]+/, "").replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}

// Download a remote URL into an ArrayBuffer
export async function fetchAsBuffer(url) {
  // Try a CORS-safe fetch — Pexels/Pixabay should allow.
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${url}: ${r.status}`);
  return await r.arrayBuffer();
}
