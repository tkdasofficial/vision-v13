// The four user-facing chat modes. Browser-safe; shared by the selector and the server router.
export type ChatMode = "default" | "deep" | "research" | "coding";

export const CHAT_MODES: { id: ChatMode; label: string; description: string }[] = [
  { id: "default", label: "Default", description: "Everyday chat — Vision picks the right workflow" },
  { id: "deep", label: "Deep Thinking", description: "Careful reasoning & hard problems" },
  { id: "research", label: "Research", description: "Structured research report" },
  { id: "coding", label: "Coding", description: "Write, review & debug code" },
];

// Older saved identifiers map onto the new modes; anything unknown becomes Default.
const LEGACY: Record<string, ChatMode> = { general: "default", reasoning: "deep", developer: "coding" };

export function normalizeMode(value: unknown): ChatMode {
  if (typeof value !== "string") return "default";
  if (CHAT_MODES.some((m) => m.id === value)) return value as ChatMode;
  return LEGACY[value] ?? "default";
}

export type OutputKind = "chat" | "document" | "code";
