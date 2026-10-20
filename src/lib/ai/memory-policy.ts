// Browser-safe privacy and command policy; no model call can authorize a mutation.
import type { PermanentMemory } from "./memory";

export type MemoryCategory = "preference" | "profile" | "project" | "instruction" | "context";
export function memoryCategory(text: string): MemoryCategory {
  if (/\b(?:always|never|from now on)\b/i.test(text)) return "instruction";
  if (/\b(?:prefer|favorite|favourite)\b/i.test(text)) return "preference";
  if (/\b(?:project|goal|building|working on|tech stack)\b/i.test(text)) return "project";
  if (/\b(?:name|live in|work at|work as|based in|call me)\b/i.test(text)) return "profile";
  return "context";
}

/** Credentials are never saved; highly private facts require an explicit save, not inference. */
export function memoryPrivacy(text: string): "safe" | "consent" | "secret" {
  if (/\b(?:password|passcode|api[ _-]?key|access[ _-]?token|private[ _-]?key|secret|credit card|social security|ssn|otp)\b|-----BEGIN|\b(?:sk-|ghp_|AKIA)[a-z0-9_-]{12,}|\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,19}\b/i.test(text)) return "secret";
  if (/\b(?:diagnosed|diagnosis|medical|disease|religion|religious|sexual|pregnant|salary|bank account|home address)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) return "consent";
  return "safe";
}

export function normalizeMemory(text: string): string {
  return text.toLowerCase().replace(/\bfavourite\b/g, "favorite").replace(/\bcolour\b/g, "color").replace(/[.!]+$/, "").replace(/\s+/g, " ").trim();
}

export type MemoryTurn = { role: string; content: string };
export type ContextTarget = { kind: "found"; content: string } | { kind: "clarify" };
/** Pronouns never copy an assistant's invented facts into persistent memory. */
export function userMemoryTarget(history: MemoryTurn[]): ContextTarget {
  const last = [...history].reverse().find((m) => m.role === "user" && m.content.trim());
  if (!last || last.content.length > 500 || /[?]|```|\b(?:write|create|imagine|pretend|remember|forget|memory)\b/i.test(last.content)) return { kind: "clarify" };
  return { kind: "found", content: last.content.trim() };
}

export function correctionTarget(text: string, existing: PermanentMemory[]): string | null {
  const m = text.match(/^(?:actually[, ]+|that has changed[, :—-]+|correction[: ,]+)(.+)$/i);
  if (!m) return null;
  const c = m[1].trim();
  // A correction needs its own fact/subject; "that has changed" alone never chooses a row.
  return /\b(?:my .+ is|i (?:live in|prefer|work at|work as)|call me)\b/i.test(c) && existing.length ? c : null;
}