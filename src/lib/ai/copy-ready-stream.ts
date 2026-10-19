// Wraps a single-deliverable SSE reply in one copy-ready fence so it always renders as one copy box,
// whatever the model's formatting habits. A 4-backtick fence keeps any inner code fences nested.
const enc = new TextEncoder();
const delta = (content: string) => enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);

export function wrapCopyReady(body: ReadableStream<Uint8Array>, lang: "markdown" | "text" = "markdown"): ReadableStream<Uint8Array> {
  let opened = false;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) { if (!opened) { opened = true; ctrl.enqueue(delta(`\`\`\`\`${lang}\n`)); } ctrl.enqueue(chunk); },
    flush(ctrl) { if (opened) ctrl.enqueue(delta("\n````\n")); },
  }));
}
