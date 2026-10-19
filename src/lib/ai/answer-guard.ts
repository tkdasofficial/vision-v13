// Holds an OpenAI-style SSE stream until the first real answer text arrives.
// Returns null when the stream ends with only reasoning (no answer), so the caller can try another model.

const hasAnswer = (text: string) => /"content":"(?:[^"\\]|\\.)+"/.test(text);

export async function untilAnswer(body: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const held: Uint8Array[] = [];
  let tail = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return null;
    held.push(value);
    tail = (tail + dec.decode(value, { stream: true })).slice(-4000);
    if (hasAnswer(tail)) break;
  }
  return new ReadableStream<Uint8Array>({
    start(ctrl) { for (const c of held) ctrl.enqueue(c); },
    async pull(ctrl) {
      const { done, value } = await reader.read();
      if (done) ctrl.close(); else ctrl.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
