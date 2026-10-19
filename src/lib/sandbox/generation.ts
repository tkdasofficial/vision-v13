// Pure logic for the Long Context Generation pipeline: outline → chunk plan →
// context assembly → final validation. No I/O; fully testable.

export type ChunkSpec = { seq: number; sectionId: string; title: string; instructions: string; dependsOn: number[]; tokenBudget: number };
export type Plan = { outline: string[]; chunks: ChunkSpec[]; contextPolicy: { summaryEvery: number; maxPrevSections: number } };

export const CHUNK_TARGET_TOKENS = 1200;
export const MAX_CHUNKS = 40;

/** Rough token estimate (~4 chars/token) for budgeting. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Builds a deterministic chunk plan from a model-produced outline (or, when the
 * outline is absent, a single-chunk plan). Independent sections run in parallel;
 * a section whose instructions reference an earlier section depends on it.
 */
export function buildPlan(instructions: string, outline: string[], opts: { chunkTargetTokens?: number; maxChunks?: number } = {}): Plan {
  const maxChunks = opts.maxChunks ?? MAX_CHUNKS;
  const sections = outline.map((s) => s.trim()).filter(Boolean);
  if (sections.length > maxChunks) throw new Error(`The outline has ${sections.length} sections; the supported maximum is ${maxChunks}. Split the request rather than omit sections.`);
  const budget = opts.chunkTargetTokens ?? CHUNK_TARGET_TOKENS;
  const chunks: ChunkSpec[] = (sections.length ? sections : ["Full response"]).map((title, i) => {
    const dependsOn: number[] = [];
    // Sequential dependency when the section explicitly builds on the previous one.
    if (i > 0 && /^(continue|then|next|finally|in conclusion|therefore)\b/i.test(title)) dependsOn.push(i - 1);
    return {
      seq: i,
      sectionId: `s${i}`,
      title,
      instructions: `Write the section "${title}" of the following work. Original instructions: ${instructions}`,
      dependsOn,
      tokenBudget: budget,
    };
  });
  return { outline: sections.length ? sections : ["Full response"], chunks, contextPolicy: { summaryEvery: 4, maxPrevSections: 3 } };
}

/** Execution waves: chunks in the same wave are independent and may run in parallel. */
export function scheduleWaves(chunks: ChunkSpec[]): number[][] {
  const done = new Set<number>();
  const waves: number[][] = [];
  const remaining = chunks.map((c) => c.seq);
  while (remaining.length) {
    const wave = remaining.filter((seq) => chunks[seq].dependsOn.every((d) => done.has(d)));
    if (!wave.length) throw new Error("Chunk dependency cycle detected");
    waves.push(wave);
    for (const seq of wave) { done.add(seq); remaining.splice(remaining.indexOf(seq), 1); }
  }
  return waves;
}

export type ContextLayer = { global: string; outline: string; previous: { sectionId: string; title: string; content: string; summary: boolean }[]; current: string };

/**
 * Assembles the context for one chunk: original instructions + outline always,
 * plus the most relevant previous sections (dependencies in full, recent others
 * summarized) — never the entire generated output verbatim when a summary suffices.
 */
export function buildChunkContext(input: { instructions: string; outline: string[]; chunk: ChunkSpec; completed: { seq: number; sectionId: string; title: string; content: string }[]; policy: Plan["contextPolicy"] }): ContextLayer {
  const { instructions, outline, chunk, completed, policy } = input;
  const bySeq = new Map(completed.map((c) => [c.seq, c]));
  const previous: ContextLayer["previous"] = [];
  // Dependencies: preserve exact source content.
  for (const d of chunk.dependsOn) {
    const c = bySeq.get(d);
    if (c) previous.push({ sectionId: c.sectionId, title: c.title, content: c.content, summary: false });
  }
  // Recent non-dependency sections: summaries only, bounded.
  const recent = completed
    .filter((c) => !chunk.dependsOn.includes(c.seq) && c.seq < chunk.seq)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, policy.maxPrevSections);
  for (const c of recent.reverse()) {
    previous.push({ sectionId: c.sectionId, title: c.title, content: summarize(c.content), summary: true });
  }
  return {
    global: instructions,
    outline: outline.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    previous,
    current: chunk.instructions,
  };
}

export function summarize(content: string, maxChars = 400): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length <= maxChars ? clean : clean.slice(0, maxChars).replace(/\s+\S*$/, "") + "…";
}

export function checksum(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}

/** Renders the context layers into model messages for one chunk. */
export function chunkMessages(ctx: ContextLayer, tokenBudget: number): unknown[] {
  const prev = ctx.previous.length
    ? ctx.previous.map((p) => `--- Earlier section "${p.title}" (${p.summary ? "summary" : "full text"}) ---\n${p.content}`).join("\n\n")
    : "(none yet — this is the first section)";
  return [
    { role: "system", content: `You are generating one section of a larger work. Stay within roughly ${tokenBudget} tokens. Write only this section's content: no restating the outline, no meta-commentary, no repeating earlier sections.` },
    { role: "user", content: `Original instructions:\n${ctx.global}\n\nFull outline:\n${ctx.outline}\n\n${prev}\n\nYour task:\n${ctx.current}` },
  ];
}

export type ValidationResult = { ok: true } | { ok: false; problems: string[] };

/** Validates assembled output: no missing chunks, correct order, no duplication. */
export function validateAssembly(chunks: { seq: number; status: string; content: string | null; checksum: string | null }[], expectedChunks?: number): ValidationResult {
  const problems: string[] = [];
  if (!chunks.length) problems.push("No generated sections were saved");
  if (expectedChunks !== undefined && chunks.length !== expectedChunks) problems.push(`Expected ${expectedChunks} sections, got ${chunks.length}`);
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
  sorted.forEach((c, i) => {
    if (c.seq !== i) problems.push(`Chunk sequence gap at position ${i}`);
    if (c.status !== "completed" || !c.content) problems.push(`Chunk ${c.seq} is missing or incomplete`);
  });
  const seen = new Map<string, number>();
  for (const c of sorted) {
    if (!c.content) continue;
    if (c.checksum && c.checksum !== checksum(c.content)) problems.push(`Chunk ${c.seq} content checksum mismatch`);
    const key = c.checksum ?? checksum(c.content);
    const prev = seen.get(key);
    if (prev !== undefined) problems.push(`Chunk ${c.seq} duplicates chunk ${prev}`);
    else seen.set(key, c.seq);
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** Joins approved chunk contents in sequence order. */
export function assemble(chunks: { seq: number; title?: string; content: string | null }[]): string {
  return [...chunks].sort((a, b) => a.seq - b.seq).map((c) => (c.content ?? "").trim()).filter(Boolean).join("\n\n");
}
