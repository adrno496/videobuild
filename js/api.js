// API clients for Pexels, Pixabay, ElevenLabs — all browser-side, CORS-friendly

const KEYS = {
  pexels: () => localStorage.getItem("key_pexels") || "",
  pixabay: () => localStorage.getItem("key_pixabay") || "",
  elevenlabs: () => localStorage.getItem("key_elevenlabs") || ""
};

export function saveKeys({ pexels, pixabay, elevenlabs }) {
  if (pexels !== undefined) localStorage.setItem("key_pexels", pexels);
  if (pixabay !== undefined) localStorage.setItem("key_pixabay", pixabay);
  if (elevenlabs !== undefined) localStorage.setItem("key_elevenlabs", elevenlabs);
}

export function loadKeys() {
  return {
    pexels: KEYS.pexels(),
    pixabay: KEYS.pixabay(),
    elevenlabs: KEYS.elevenlabs()
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

// Download a remote URL into an ArrayBuffer
export async function fetchAsBuffer(url) {
  // Try a CORS-safe fetch — Pexels/Pixabay should allow.
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${url}: ${r.status}`);
  return await r.arrayBuffer();
}
