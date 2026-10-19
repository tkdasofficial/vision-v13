export function codeLanguageLabel(language?: string): string {
  const key = language?.toLowerCase() ?? "";
  const names: Record<string, string> = { html: "HTML", htm: "HTML", xml: "XML", svg: "SVG", css: "CSS", scss: "SCSS", javascript: "JavaScript", js: "JavaScript", typescript: "TypeScript", ts: "TypeScript", jsx: "JSX", tsx: "TSX", java: "Java", cpp: "C++", "c++": "C++", c: "C", csharp: "C#", python: "Python", py: "Python", json: "JSON", bash: "Bash", shell: "Shell", sql: "SQL", rust: "Rust", go: "Go", php: "PHP", ruby: "Ruby", swift: "Swift", kotlin: "Kotlin" };
  const formats: Record<string, string> = { markdown: "Markdown", md: "Markdown", text: "Text", txt: "Text", plain: "Text", plaintext: "Text", csv: "CSV", tsv: "TSV", yaml: "YAML", yml: "YAML", toml: "TOML", ini: "INI", jsonc: "JSONC", jsonl: "JSONL", dockerfile: "Dockerfile", sh: "Shell", cs: "C#", rs: "Rust", rb: "Ruby" };
  return names[key] ?? formats[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : "Code");
}