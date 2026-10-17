import assert from "node:assert/strict";
import { selectedVideoTranscript } from "../src/youtube-transcript.mjs";

const videoId = "abcdefghijk";
const now = () => new Date("2026-10-12T12:00:00Z");
assert.equal((await selectedVideoTranscript(videoId, { enabled: false })).status, "not_attempted");
assert.equal((await selectedVideoTranscript("invalid", { enabled: true })).status, "unsupported");
const result = await selectedVideoTranscript(videoId, { enabled: true, now, loader: async () => [
  { text: "Named cultural reference", offset: 1200, duration: 500 },
  { text: "  Explicit   sponsorship disclosure  ", offset: 2300, duration: 900 },
] });
assert.equal(result.status, "available");
assert.equal(result.segments[1].text, "Explicit sponsorship disclosure");
assert.equal(result.segments[1].offsetMs, 2300);
assert.equal((await selectedVideoTranscript(videoId, { enabled: true, loader: async () => [] })).status, "no_captions");
assert.equal((await selectedVideoTranscript(videoId, { enabled: true, loader: async () => {
  const error = new Error("Unavailable"); error.name = "YoutubeTranscriptNotAvailableError"; throw error;
} })).status, "no_captions");
assert.equal((await selectedVideoTranscript(videoId, { enabled: true, loader: async () => { throw new Error("429"); } })).status, "blocked");
console.log("Optional selected-video transcript adapter: timed segments, disabled, missing and blocked paths passed without a live request.");
