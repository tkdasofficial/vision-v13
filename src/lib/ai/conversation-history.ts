import type { ConvMsg } from "./references";

/** Reconcile saved history without repeating turns already persisted by the client. */
export function restoreConversationHistory(saved: ConvMsg[], incoming: ConvMsg[]): ConvMsg[] {
  if (!saved.length) return incoming;
  const same = (a: ConvMsg, b: ConvMsg) => a.id && b.id ? a.id === b.id : a.role === b.role && JSON.stringify(a.content) === JSON.stringify(b.content);
  // Find a contiguous suffix/prefix overlap, never a global content match: repeated questions are intentional.
  for (let length = Math.min(saved.length, incoming.length); length > 0; length--) {
    if (saved.slice(-length).every((m, i) => same(m, incoming[i]))) return [...saved, ...incoming.slice(length)];
  }
  return [...saved, ...incoming];
}
