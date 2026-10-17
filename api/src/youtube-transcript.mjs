import { fetchTranscript } from "youtube-transcript";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_SEGMENTS = 1200;
const MAX_TEXT = 120_000;

function errorStatus(error) {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? "");
  if (/Disabled|NotAvailable|UnavailableLanguage/.test(name) || /caption|transcript.*not available/i.test(message)) return "no_captions";
  if (/TooManyRequest/.test(name) || /429|403|blocked|forbidden/i.test(message)) return "blocked";
  return "transient_error";
}

// This unofficial caption source is strictly optional. A caller can always
// continue using the already collected public metadata after any non-success.
export async function selectedVideoTranscript(videoId, { language = "en", enabled = process.env.YOUTUBE_TRANSCRIPTS_ENABLED === "true",
  timeoutMs = 8000, loader = fetchTranscript, now = () => new Date() } = {}) {
  if (!VIDEO_ID.test(videoId ?? "") || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language))
    return { videoId, language, status: "unsupported", segments: [], fetchedAt: null };
  if (!enabled) return { videoId, language, status: "not_attempted", segments: [], fetchedAt: null };
  const controller = new AbortController();
  let timer;
  try {
    const boundedFetch = (input, init = {}) => fetch(input, { ...init, signal: controller.signal });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("transcript_timeout")); }, timeoutMs);
    });
    const raw = await Promise.race([
      loader(videoId, { lang: language, fetch: boundedFetch }),
      timeout,
    ]);
    if (!Array.isArray(raw) || !raw.length) return { videoId, language, status: "no_captions", segments: [], fetchedAt: now().toISOString() };
    const segments = [];
    let textLength = 0;
    for (const item of raw) {
      if (!Number.isFinite(item?.offset) || !Number.isFinite(item?.duration) ||
          item.offset < 0 || item.duration < 0 || typeof item.text !== "string") continue;
      const clean = item.text.replace(/\s+/g, " ").trim();
      if (!clean) continue;
      if (segments.length >= MAX_SEGMENTS || textLength + clean.length > MAX_TEXT) break;
      segments.push({ text: clean, offsetMs: item.offset, durationMs: item.duration });
      textLength += clean.length;
    }
    if (!segments.length) return { videoId, language, status: "no_captions", segments: [], fetchedAt: now().toISOString() };
    return { videoId, language, status: "available", segments, fetchedAt: now().toISOString(),
      truncated: segments.length < raw.length };
  } catch (error) {
    return { videoId, language, status: errorStatus(error), segments: [], fetchedAt: now().toISOString() };
  } finally { clearTimeout(timer); }
}
