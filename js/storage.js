// Persistence helpers:
//   - Form state in localStorage (cheap, instant)
//   - Uploaded file blobs in IndexedDB (survives reload, no size cap on disk)
//   - Project save/load as .montage.json (portable)
//   - API key encryption (AES-GCM with user passphrase, optional)

// ─── localStorage form state ───────────────────────────────
const STATE_KEY = "montage_state_v1";
const FIELDS = [
  "proj-name", "proj-lang", "proj-format", "proj-duration", "proj-pitch",
  "proj-script", "music-query", "voice-id", "voice-style"
];

export function saveFormState(extra = {}) {
  const data = { ...extra };
  for (const id of FIELDS) {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  }
  try { localStorage.setItem(STATE_KEY, JSON.stringify(data)); } catch {}
}

export function loadFormState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    for (const id of FIELDS) {
      const el = document.getElementById(id);
      if (el && data[id] !== undefined) el.value = data[id];
    }
    return data;
  } catch { return {}; }
}

export function clearFormState() {
  try { localStorage.removeItem(STATE_KEY); } catch {}
}

// ─── IndexedDB upload cache ────────────────────────────────
const DB_NAME = "montage";
const DB_VERSION = 1;
const STORE = "uploads";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutUpload(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const r = tx.objectStore(STORE).add(record);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function dbGetAllUploads() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function dbClearUploads() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const r = tx.objectStore(STORE).clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ─── Project save / load (.montage.json) ───────────────────
export function exportProjectJSON() {
  const data = {};
  for (const id of FIELDS) {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  }
  data.template = document.querySelector(".template-card.selected")?.dataset.template || "viral";
  data.brand = JSON.parse(localStorage.getItem("montage_brand") || "{}");
  data.exportedAt = new Date().toISOString();
  data.version = 1;
  return JSON.stringify(data, null, 2);
}

export function importProjectJSON(jsonText) {
  const data = JSON.parse(jsonText);
  for (const id of FIELDS) {
    const el = document.getElementById(id);
    if (el && data[id] !== undefined) el.value = data[id];
  }
  if (data.brand) localStorage.setItem("montage_brand", JSON.stringify(data.brand));
  return data;
}

// ─── API key encryption (AES-GCM, optional) ────────────────
const KEY_STORAGE = ["key_pexels", "key_pixabay", "key_elevenlabs", "key_anthropic", "key_openai", "key_mistral", "key_openrouter"];
const ENCRYPTION_FLAG = "montage_keys_encrypted";

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptKeys(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const enc = new TextEncoder();
  for (const k of KEY_STORAGE) {
    const v = localStorage.getItem(k);
    if (!v) continue;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(v));
    const payload = { iv: Array.from(iv), salt: Array.from(salt), ct: Array.from(new Uint8Array(ct)) };
    localStorage.setItem(k, "ENC:" + btoa(JSON.stringify(payload)));
  }
  localStorage.setItem(ENCRYPTION_FLAG, "1");
}

export async function decryptKeys(passphrase) {
  const dec = new TextDecoder();
  for (const k of KEY_STORAGE) {
    const v = localStorage.getItem(k);
    if (!v || !v.startsWith("ENC:")) continue;
    const payload = JSON.parse(atob(v.slice(4)));
    const key = await deriveKey(passphrase, new Uint8Array(payload.salt));
    try {
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
        key,
        new Uint8Array(payload.ct)
      );
      localStorage.setItem(k, dec.decode(pt));
    } catch (e) {
      throw new Error("Mauvaise passphrase");
    }
  }
  localStorage.removeItem(ENCRYPTION_FLAG);
}

export function keysAreEncrypted() {
  return localStorage.getItem(ENCRYPTION_FLAG) === "1";
}

// ─── Brand kit (logo + colors) ─────────────────────────────
const BRAND_KEY = "montage_brand";

export function saveBrand(brand) {
  localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
}

export function loadBrand() {
  try { return JSON.parse(localStorage.getItem(BRAND_KEY) || "{}"); } catch { return {}; }
}
