/** Preserve the typed prefix and separate appended speech with a space. */
export function appendTranscript(text: string, speech: string): string {
  const transcript = speech.trim();
  if (!transcript) return text;
  return text + (text && !/\s$/.test(text) ? " " : "") + transcript;
}