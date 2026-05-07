// Video composer using ffmpeg.wasm
// Builds a 9:16 / 1:1 / 16:9 ad from images + audio + music

let ffmpeg = null;
let ffmpegLoaded = false;

// All ffmpeg.wasm assets are self-hosted under /vendor/ffmpeg/ to avoid
// cross-origin import issues under COEP and to keep the site fully offline-capable.
const FFMPEG_BASE = "/vendor/ffmpeg";

function dimsForFormat(format) {
  switch (format) {
    case "1:1": return [1080, 1080];
    case "16:9": return [1920, 1080];
    case "9:16":
    default: return [1080, 1920];
  }
}

export async function loadFFmpeg(onLog) {
  if (ffmpegLoaded) return ffmpeg;
  const { FFmpeg } = window.FFmpegWASM;
  ffmpeg = new FFmpeg();
  if (onLog) {
    ffmpeg.on("log", ({ message }) => onLog(message));
    ffmpeg.on("progress", ({ progress }) => onLog(`progress: ${(progress * 100).toFixed(0)}%`));
  }
  const fmtErr = (e) => {
    if (!e) return "unknown error";
    if (typeof e === "string") return e;
    return e.message || e.name || JSON.stringify(e).slice(0, 200) || "unknown error";
  };

  // Self-hosted single-thread core. Same-origin → no CORS/COEP issues.
  // The class-worker (`814.ffmpeg.js`) is also same-origin so the FFmpeg class
  // can spawn it directly without needing classWorkerURL gymnastics.
  try {
    await ffmpeg.load({
      coreURL: `${FFMPEG_BASE}/ffmpeg-core.js`,
      wasmURL: `${FFMPEG_BASE}/ffmpeg-core.wasm`
    });
  } catch (e) {
    throw new Error(`ffmpeg.wasm load failed: ${fmtErr(e)}`);
  }
  ffmpegLoaded = true;
  return ffmpeg;
}

// Reset module state — useful after Hard refresh (we still keep the cached files
// because cache-clear button purges Cache API + reloads the page).
export function resetFFmpegCache() {
  ffmpeg = null;
  ffmpegLoaded = false;
}

// Render a single text overlay (per-scene title) as PNG using <canvas>
export function renderTextOverlay({ width, height, text, subtext = null, theme = "dark" }) {
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  // dark band at bottom 1/3
  const bandH = Math.floor(height * 0.28);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, height - bandH, width, bandH);

  // main text
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = Math.floor(width * 0.085);
  ctx.font = `bold ${fontSize}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
  // wrap if needed
  const maxWidth = width * 0.86;
  let displayText = text;
  while (ctx.measureText(displayText).width > maxWidth && fontSize > 28) {
    fontSize -= 4;
    ctx.font = `bold ${fontSize}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
  }
  // shadow
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 8;
  ctx.fillText(displayText, width / 2, height - bandH / 2 - (subtext ? 24 : 0));
  ctx.shadowBlur = 0;

  if (subtext) {
    ctx.fillStyle = "#ddd";
    ctx.font = `${Math.floor(fontSize * 0.5)}px -apple-system, sans-serif`;
    ctx.fillText(subtext, width / 2, height - bandH / 2 + Math.floor(fontSize * 0.6));
  }

  return cv.toDataURL("image/png");
}

// Logo / final card
export function renderFinalCard({ width, height, title, subtitle = "", cta = "" }) {
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  // bg gradient
  const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.7);
  g.addColorStop(0, "#3a1212");
  g.addColorStop(1, "#0a0a0c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  // title
  ctx.fillStyle = "#ffb300";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = Math.floor(width * 0.13);
  ctx.font = `900 ${fontSize}px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
  // shadow
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 16;
  ctx.fillText(title.toUpperCase(), width / 2, height / 2 - height * 0.08);
  ctx.shadowBlur = 0;
  // subtitle
  if (subtitle) {
    ctx.fillStyle = "#fff";
    ctx.font = `500 ${Math.floor(fontSize * 0.35)}px -apple-system, sans-serif`;
    ctx.fillText(subtitle, width / 2, height / 2 + height * 0.02);
  }
  // CTA pill
  if (cta) {
    const padX = width * 0.06;
    const padY = height * 0.012;
    ctx.font = `700 ${Math.floor(fontSize * 0.36)}px -apple-system, sans-serif`;
    const tw = ctx.measureText(cta).width;
    const w = tw + padX * 2;
    const h = Math.floor(fontSize * 0.36) + padY * 2;
    const x = (width - w) / 2;
    const y = height / 2 + height * 0.10;
    ctx.fillStyle = "#ffb300";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, h / 2);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.fillText(cta, width / 2, y + h / 2);
  }
  return cv.toDataURL("image/png");
}

// Convert dataURL → ArrayBuffer
function dataURLToBuffer(dataURL) {
  const base64 = dataURL.split(",")[1];
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/**
 * Compose final video.
 * scenes = [{ visualBuf: ArrayBuffer (image OR video bytes), visualType: "image"|"video", duration, textOverlayDataURL, isVideo }]
 * narrationBuf = ArrayBuffer (mp3) | null
 * musicBuf = ArrayBuffer (mp3) | null
 */
export async function compose({
  scenes,
  narrationBuf,
  musicBuf,
  format = "9:16",
  totalDuration,
  onLog
}) {
  const ff = await loadFFmpeg(onLog);
  const [W, H] = dimsForFormat(format);
  const FPS = 30;

  // Write per-scene clips to virtual FS, then concat
  const clipFiles = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const idx = String(i + 1).padStart(2, "0");
    const inputName = `in_${idx}.${s.visualType === "video" ? "mp4" : "jpg"}`;
    await ff.writeFile(inputName, new Uint8Array(s.visualBuf));

    // optional overlay PNG
    let overlayName = null;
    if (s.textOverlayDataURL) {
      overlayName = `ov_${idx}.png`;
      await ff.writeFile(overlayName, new Uint8Array(dataURLToBuffer(s.textOverlayDataURL)));
    }

    const outName = `clip_${idx}.mp4`;
    const dur = s.duration;
    const frames = Math.round(dur * FPS);
    const fadeOutSt = Math.max(0, dur - 0.4).toFixed(2);

    let filter, args;
    if (s.visualType === "video") {
      // Trim first `dur` seconds, scale & crop, optional overlay
      filter = `[0:v]scale=${W}:-1:force_original_aspect_ratio=increase,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=brightness=0.02:contrast=1.08:saturation=1.0,fps=${FPS}`;
      if (overlayName) {
        filter += `[bg];[1:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${fadeOutSt}:d=0.4:alpha=1[ov];[bg][ov]overlay=0:0:format=auto`;
      }
      args = ["-ss", "0", "-t", String(dur), "-i", inputName];
      if (overlayName) args.push("-loop", "1", "-t", String(dur), "-i", overlayName);
      args.push("-filter_complex", filter, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-t", String(dur), outName);
    } else {
      // Image with Ken Burns zoom
      filter = `[0:v]scale=${W}:-1:force_original_aspect_ratio=increase,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},zoompan=z='min(zoom+0.0015,1.10)':d=${frames}:s=${W}x${H}:fps=${FPS},eq=brightness=0.02:contrast=1.08:saturation=1.05`;
      if (overlayName) {
        filter += `[bg];[1:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${fadeOutSt}:d=0.4:alpha=1[ov];[bg][ov]overlay=0:0:format=auto`;
      }
      args = ["-loop", "1", "-t", String(dur), "-i", inputName];
      if (overlayName) args.push("-loop", "1", "-t", String(dur), "-i", overlayName);
      args.push("-filter_complex", filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-t", String(dur), outName);
    }

    if (onLog) onLog(`▶ scene ${idx}: ${s.visualType}, ${dur}s`);
    await ff.exec(args);
    clipFiles.push(outName);
  }

  // Concat list file
  const concatTxt = clipFiles.map(f => `file '${f}'`).join("\n");
  await ff.writeFile("concat.txt", new TextEncoder().encode(concatTxt));
  if (onLog) onLog("▶ concat clips");
  await ff.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "video_only.mp4"]);

  // Audio mix
  let hasAudio = false;
  if (narrationBuf || musicBuf) {
    if (narrationBuf) {
      await ff.writeFile("narration.mp3", new Uint8Array(narrationBuf));
    }
    if (musicBuf) {
      await ff.writeFile("music.mp3", new Uint8Array(musicBuf));
    }

    let mixArgs = [];
    let filter = "";
    let inputCount = 0;
    if (narrationBuf) {
      mixArgs.push("-i", "narration.mp3");
      filter += `[${inputCount}:a]volume=1.5,adelay=200|200[narr];`;
      inputCount++;
    }
    if (musicBuf) {
      mixArgs.push("-i", "music.mp3");
      const fadeOutSt = Math.max(0, totalDuration - 1).toFixed(2);
      filter += `[${inputCount}:a]volume=0.20,afade=t=in:st=0:d=1.0,afade=t=out:st=${fadeOutSt}:d=1.0[mus];`;
      inputCount++;
    }
    if (narrationBuf && musicBuf) {
      filter += "[narr][mus]amix=inputs=2:duration=longest:dropout_transition=0[aout]";
    } else if (narrationBuf) {
      filter += "[narr]anull[aout]";
    } else {
      filter += "[mus]anull[aout]";
    }

    if (onLog) onLog("▶ audio mix");
    await ff.exec([
      ...mixArgs,
      "-filter_complex", filter,
      "-map", "[aout]",
      "-t", String(totalDuration),
      "-c:a", "aac", "-b:a", "192k",
      "audio.m4a"
    ]);
    hasAudio = true;
  }

  // Final mux
  if (onLog) onLog("▶ final mux");
  if (hasAudio) {
    await ff.exec(["-i", "video_only.mp4", "-i", "audio.m4a", "-c:v", "copy", "-c:a", "copy", "-shortest", "final.mp4"]);
  } else {
    await ff.exec(["-i", "video_only.mp4", "-c", "copy", "final.mp4"]);
  }

  const data = await ff.readFile("final.mp4");
  return new Blob([data.buffer], { type: "video/mp4" });
}
