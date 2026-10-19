import hljs from "highlight.js/lib/common";

// Real syntax colours. Falls back to auto-detection when the language is unknown.
export function highlight(code: string, language?: string): { html: string; language?: string } {
  try {
    const lang = language?.toLowerCase();
    const hl = lang === "html" || lang === "svg" ? "xml" : lang;
    if (hl && hljs.getLanguage(hl)) return { html: hljs.highlight(code, { language: hl, ignoreIllegals: true }).value, language: lang };
    const r = hljs.highlightAuto(code.slice(0, 20000));
    return { html: code.length > 20000 ? escape(code) : r.value, language: r.language };
  } catch {
    return { html: escape(code) };
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Real format of a code file. Fixes hljs naming HTML "xml" and fills in a missing language.
export function detectLanguage(code: string, given?: string): string | undefined {
  const t = code.trim().slice(0, 4000);
  const g = given?.toLowerCase();
  const isHtml = /<!DOCTYPE html|<html[\s>]|<head[\s>]|<body[\s>]|<(div|span|section|header|footer|main|nav|p|a|h[1-6]|ul|li|button|script|style|link|meta)[\s>/]/i.test(t);
  if ((!g || g === "xml" || g === "markup" || g === "htm") && isHtml && !/^<\?xml/i.test(t)) return /<\w+[^>]*\s(className|onClick)=\{|^import /m.test(t) ? "jsx" : "html";
  if (g && g !== "plaintext" && g !== "text") return g;
  if (/^<\?xml|^<svg/i.test(t)) return t.startsWith("<svg") ? "svg" : "xml";
  if (/^\s*[{\[]/.test(t)) { try { JSON.parse(code); return "json"; } catch { /* not json */ } }
  if (/^[.#]?[\w-]+(\s*[,>+~]?\s*[.#]?[\w-:]+)*\s*\{[^}]*:[^}]*;/m.test(t) && !/\b(function|const|let|return)\b/.test(t)) return "css";
  if (/^\s*(def |from \w+ import |import \w+$|print\()/m.test(t)) return "python";
  if (/:\s*(string|number|boolean)\b|^\s*(interface|type) \w+/m.test(t) && /\b(const|let|function|export)\b/.test(t)) return "typescript";
  if (/\b(const|let|var|function|=>|console\.|document\.|require\()/.test(t)) return "javascript";
  return highlight(code).language;
}

// Plain text that is clearly code (e.g. a raw HTML file) but arrived without ``` fences.
export function looksLikeCode(text: string) {
  const t = text.trim();
  if (t.includes("```")) return false;
  return /^(<!DOCTYPE|<html|<\?xml|<svg|import |export |const |function |def |class |package |#include|using |SELECT |CREATE )/i.test(t);
}
