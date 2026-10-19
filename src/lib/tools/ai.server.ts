// Cloudflare Workers AI calls used by chat tools: image reading (vision) and speech-to-text.
// On the Worker these use the AI binding; anywhere else they go through the "vision" Worker's
// /ai/run relay. There is no direct REST fallback from the hosting server.
import { getAiBinding, getD1Binding, aiRelayConfig } from "@/lib/ai/runtime-env.server";

async function run(model: string, input: unknown, timeoutMs: number, busy: string, failed: string): Promise<any> {
  const ai = getAiBinding();
  if (ai) {
    try { return await ai.run(model, input); }
    catch (e: any) { throw new Error(/429|capacity|rate/i.test(String(e?.message)) ? busy : failed); }
  }
  if (getD1Binding()) throw new Error("The AI service isn't configured on the server.");
  const { url: gw, origin } = aiRelayConfig();
  if (!origin) throw new Error("The AI service isn't configured on the server.");
  const res = await fetch(`${gw}/ai/run`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(timeoutMs),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 429 ? busy : failed);
  return j.result;
}

function b64(bytes: Uint8Array) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }

/** Asks the vision model about an image (OCR, description, charts…). */
export async function vision(bytes: Uint8Array, mime: string, prompt: string): Promise<string> {
  if (bytes.length > 8 * 1024 * 1024) throw new Error("Images up to 8 MB can be read.");
  const r = await run("@cf/meta/llama-4-scout-17b-16e-instruct", { max_tokens: 4096, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64(bytes)}` } }] }] }, 90_000, "The image reader is busy. Please try again shortly.", "The image reader couldn't process this image.");
  const text = r?.choices?.[0]?.message?.content ?? r?.response ?? "";
  if (!String(text).trim()) throw new Error("The image reader returned nothing.");
  return String(text).trim();
}

/** Speech-to-text. Returns plain text and WebVTT subtitles. */
export async function transcribe(bytes: Uint8Array): Promise<{ text: string; vtt: string; words: number }> {
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Audio files up to 25 MB can be transcribed.");
  const r = await run("@cf/openai/whisper", { audio: Array.from(bytes) }, 120_000, "Transcription is busy. Please try again shortly.", "This audio couldn't be transcribed. Try MP3, WAV or OGG.");
  return { text: String(r?.text ?? "").trim(), vtt: String(r?.vtt ?? ""), words: r?.word_count ?? 0 };
}
