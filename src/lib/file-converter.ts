/**
 * Universal File Format Converter
 * Supports: Image, Document, Video, Audio conversions
 */

export type ConversionCategory = "image" | "document" | "video" | "audio";

export type FormatInfo = {
  ext: string;
  mime: string;
  label: string;
  category: ConversionCategory;
};

export const ALL_FORMATS: FormatInfo[] = [
  // Images
  { ext: "png", mime: "image/png", label: "PNG", category: "image" },
  { ext: "jpg", mime: "image/jpeg", label: "JPG", category: "image" },
  { ext: "jpeg", mime: "image/jpeg", label: "JPEG", category: "image" },
  { ext: "webp", mime: "image/webp", label: "WebP", category: "image" },
  { ext: "bmp", mime: "image/bmp", label: "BMP", category: "image" },
  { ext: "gif", mime: "image/gif", label: "GIF", category: "image" },
  { ext: "ico", mime: "image/x-icon", label: "ICO", category: "image" },
  { ext: "svg", mime: "image/svg+xml", label: "SVG", category: "image" },
  // Documents
  { ext: "txt", mime: "text/plain", label: "TXT", category: "document" },
  { ext: "pdf", mime: "application/pdf", label: "PDF", category: "document" },
  { ext: "html", mime: "text/html", label: "HTML", category: "document" },
  { ext: "md", mime: "text/markdown", label: "Markdown", category: "document" },
  { ext: "csv", mime: "text/csv", label: "CSV", category: "document" },
  { ext: "json", mime: "application/json", label: "JSON", category: "document" },
  { ext: "xml", mime: "application/xml", label: "XML", category: "document" },
  // Video
  { ext: "mp4", mime: "video/mp4", label: "MP4", category: "video" },
  { ext: "webm", mime: "video/webm", label: "WebM", category: "video" },
  { ext: "avi", mime: "video/x-msvideo", label: "AVI", category: "video" },
  { ext: "mov", mime: "video/quicktime", label: "MOV", category: "video" },
  { ext: "mkv", mime: "video/x-matroska", label: "MKV", category: "video" },
  // Audio
  { ext: "mp3", mime: "audio/mpeg", label: "MP3", category: "audio" },
  { ext: "wav", mime: "audio/wav", label: "WAV", category: "audio" },
  { ext: "ogg", mime: "audio/ogg", label: "OGG", category: "audio" },
  { ext: "aac", mime: "audio/aac", label: "AAC", category: "audio" },
  { ext: "flac", mime: "audio/flac", label: "FLAC", category: "audio" },
  { ext: "m4a", mime: "audio/mp4", label: "M4A", category: "audio" },
  { ext: "weba", mime: "audio/webm", label: "WEBA", category: "audio" },
];

export function detectFormat(file: File): FormatInfo | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return ALL_FORMATS.find((f) => f.ext === ext) || null;
}

export function getCategory(file: File): ConversionCategory | null {
  const fmt = detectFormat(file);
  if (fmt) return fmt.category;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("text/") || file.type.includes("pdf") || file.type.includes("json") || file.type.includes("xml")) return "document";
  return null;
}

// Conversion rules: which formats can convert to which
const CONVERSION_MAP: Record<ConversionCategory, Record<string, string[]>> = {
  image: {
    png: ["jpg", "jpeg", "webp", "bmp", "gif", "ico", "pdf"],
    jpg: ["png", "webp", "bmp", "gif", "ico", "pdf"],
    jpeg: ["png", "webp", "bmp", "gif", "ico", "pdf"],
    webp: ["png", "jpg", "jpeg", "bmp", "gif", "ico", "pdf"],
    bmp: ["png", "jpg", "jpeg", "webp", "gif", "ico", "pdf"],
    gif: ["png", "jpg", "jpeg", "webp", "bmp", "ico", "pdf"],
    ico: ["png", "jpg", "jpeg", "webp", "bmp", "gif"],
    svg: ["png", "jpg", "jpeg", "webp", "bmp", "pdf"],
  },
  document: {
    txt: ["pdf", "html", "md", "csv", "json"],
    pdf: ["txt"],
    html: ["txt", "pdf", "md"],
    md: ["txt", "html", "pdf"],
    csv: ["txt", "json", "html"],
    json: ["txt", "csv", "xml"],
    xml: ["txt", "json"],
  },
  video: {
    mp4: ["webm", "avi", "mkv", "mov"],
    webm: ["mp4", "avi", "mkv", "mov"],
    avi: ["mp4", "webm", "mkv", "mov"],
    mov: ["mp4", "webm", "avi", "mkv"],
    mkv: ["mp4", "webm", "avi", "mov"],
  },
  audio: {
    mp3: ["wav", "ogg", "aac", "flac", "m4a", "weba"],
    wav: ["mp3", "ogg", "aac", "flac", "m4a", "weba"],
    ogg: ["mp3", "wav", "aac", "flac", "m4a", "weba"],
    aac: ["mp3", "wav", "ogg", "flac", "m4a", "weba"],
    flac: ["mp3", "wav", "ogg", "aac", "m4a", "weba"],
    m4a: ["mp3", "wav", "ogg", "aac", "flac", "weba"],
    weba: ["mp3", "wav", "ogg", "aac", "flac", "m4a"],
  },
};

export function getTargetFormats(file: File): FormatInfo[] {
  const source = detectFormat(file);
  if (!source) return [];
  const cat = source.category;
  const targets = CONVERSION_MAP[cat]?.[source.ext] || [];
  return targets.map((ext) => ALL_FORMATS.find((f) => f.ext === ext)!).filter(Boolean);
}

export type ConversionProgress = {
  stage: string;
  percent: number;
};

export type ConversionResult = {
  blob: Blob;
  fileName: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
};

// ── Image Conversions ──

async function convertImage(
  file: File,
  targetExt: string,
  onProgress: (p: ConversionProgress) => void
): Promise<ConversionResult> {
  onProgress({ stage: "Loading image...", percent: 10 });

  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });

  onProgress({ stage: "Converting...", percent: 40 });

  const canvas = document.createElement("canvas");

  // ICO: constrain to 256x256
  if (targetExt === "ico") {
    const size = Math.min(img.width, img.height, 256);
    canvas.width = size;
    canvas.height = size;
  } else {
    canvas.width = img.width;
    canvas.height = img.height;
  }

  const ctx = canvas.getContext("2d")!;

  // For JPG/BMP, fill white background (no alpha)
  if (["jpg", "jpeg", "bmp"].includes(targetExt)) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  onProgress({ stage: "Encoding...", percent: 70 });

  // Special case: image → PDF
  if (targetExt === "pdf") {
    const { jsPDF } = await import("jspdf");
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const pxToMm = 0.264583;
    const w = img.width * pxToMm;
    const h = img.height * pxToMm;
    const pdf = new jsPDF({ orientation: w > h ? "landscape" : "portrait", unit: "mm", format: [w, h] });
    pdf.addImage(dataUrl, "JPEG", 0, 0, w, h);
    const blob = pdf.output("blob");
    const name = file.name.replace(/\.[^.]+$/, ".pdf");
    onProgress({ stage: "Done!", percent: 100 });
    return { blob, fileName: name, mimeType: "application/pdf", size: blob.size, downloadUrl: URL.createObjectURL(blob) };
  }

  const target = ALL_FORMATS.find((f) => f.ext === targetExt);
  const mime = target?.mime || "image/png";

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas conversion failed"))),
      mime,
      0.92
    );
  });

  const name = file.name.replace(/\.[^.]+$/, `.${targetExt}`);
  onProgress({ stage: "Done!", percent: 100 });
  return { blob, fileName: name, mimeType: mime, size: blob.size, downloadUrl: URL.createObjectURL(blob) };
}

// ── Document Conversions ──

async function convertDocument(
  file: File,
  targetExt: string,
  onProgress: (p: ConversionProgress) => void
): Promise<ConversionResult> {
  const sourceExt = file.name.split(".").pop()?.toLowerCase() || "";
  onProgress({ stage: "Reading file...", percent: 10 });

  // PDF → TXT
  if (sourceExt === "pdf" && targetExt === "txt") {
    onProgress({ stage: "Extracting text from PDF...", percent: 20 });
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress({ stage: `Extracting page ${i}/${pdf.numPages}...`, percent: 20 + Math.round((i / pdf.numPages) * 60) });
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      text += `--- Page ${i} ---\n${pageText}\n\n`;
    }

    const blob = new Blob([text], { type: "text/plain" });
    const name = file.name.replace(/\.pdf$/i, ".txt");
    onProgress({ stage: "Done!", percent: 100 });
    return { blob, fileName: name, mimeType: "text/plain", size: blob.size, downloadUrl: URL.createObjectURL(blob) };
  }

  // Text-based → PDF
  if (targetExt === "pdf") {
    const text = await file.text();
    onProgress({ stage: "Generating PDF...", percent: 40 });

    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 15;
    const maxWidth = pageWidth - margin * 2;

    pdf.setFont("helvetica");
    pdf.setFontSize(11);

    const lines = pdf.splitTextToSize(text, maxWidth);
    let y = margin;
    const lineHeight = 5.5;

    for (let i = 0; i < lines.length; i++) {
      if (y + lineHeight > pdf.internal.pageSize.getHeight() - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(lines[i], margin, y);
      y += lineHeight;
      if (i % 50 === 0) {
        onProgress({ stage: `Writing line ${i}/${lines.length}...`, percent: 40 + Math.round((i / lines.length) * 50) });
      }
    }

    const blob = pdf.output("blob");
    const name = file.name.replace(/\.[^.]+$/, ".pdf");
    onProgress({ stage: "Done!", percent: 100 });
    return { blob, fileName: name, mimeType: "application/pdf", size: blob.size, downloadUrl: URL.createObjectURL(blob) };
  }

  // Text-based ↔ Text-based
  const text = await file.text();
  onProgress({ stage: "Converting...", percent: 50 });

  let output = text;

  // Markdown → HTML
  if (sourceExt === "md" && targetExt === "html") {
    output = markdownToHtml(text);
  }
  // HTML → TXT
  else if (sourceExt === "html" && targetExt === "txt") {
    const div = document.createElement("div");
    div.innerHTML = text;
    output = div.textContent || div.innerText || "";
  }
  // HTML → Markdown
  else if (sourceExt === "html" && targetExt === "md") {
    const div = document.createElement("div");
    div.innerHTML = text;
    output = div.textContent || div.innerText || "";
  }
  // CSV → JSON
  else if (sourceExt === "csv" && targetExt === "json") {
    output = csvToJson(text);
  }
  // JSON → CSV
  else if (sourceExt === "json" && targetExt === "csv") {
    output = jsonToCsv(text);
  }
  // CSV → HTML
  else if (sourceExt === "csv" && targetExt === "html") {
    output = csvToHtml(text);
  }
  // JSON → XML
  else if (sourceExt === "json" && targetExt === "xml") {
    output = jsonToXml(text);
  }
  // XML → JSON
  else if (sourceExt === "xml" && targetExt === "json") {
    output = xmlToJson(text);
  }

  const target = ALL_FORMATS.find((f) => f.ext === targetExt);
  const blob = new Blob([output], { type: target?.mime || "text/plain" });
  const name = file.name.replace(/\.[^.]+$/, `.${targetExt}`);
  onProgress({ stage: "Done!", percent: 100 });
  return { blob, fileName: name, mimeType: target?.mime || "text/plain", size: blob.size, downloadUrl: URL.createObjectURL(blob) };
}

// ── Video / Audio Conversions (FFmpeg WASM) ──

async function convertMedia(
  file: File,
  targetExt: string,
  category: "video" | "audio",
  onProgress: (p: ConversionProgress) => void
): Promise<ConversionResult> {
  onProgress({ stage: "Loading FFmpeg...", percent: 5 });

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
  });

  ffmpeg.on("progress", ({ progress }) => {
    onProgress({ stage: "Converting...", percent: Math.min(10 + Math.round(progress * 85), 95) });
  });

  const inputName = `input.${file.name.split(".").pop()}`;
  const outputName = `output.${targetExt}`;

  onProgress({ stage: "Reading file...", percent: 8 });
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  onProgress({ stage: "Converting...", percent: 15 });

  // Build FFmpeg args based on target
  const args: string[] = ["-i", inputName];

  if (category === "audio") {
    if (targetExt === "mp3") args.push("-codec:a", "libmp3lame", "-q:a", "2");
    else if (targetExt === "ogg") args.push("-codec:a", "libvorbis", "-q:a", "4");
    else if (targetExt === "aac") args.push("-codec:a", "aac", "-b:a", "192k");
    else if (targetExt === "flac") args.push("-codec:a", "flac");
    else if (targetExt === "wav") args.push("-codec:a", "pcm_s16le");
    else if (targetExt === "weba") args.push("-codec:a", "libvorbis");
    else if (targetExt === "m4a") args.push("-codec:a", "aac", "-b:a", "192k");
  } else {
    if (targetExt === "webm") args.push("-c:v", "libvpx", "-c:a", "libvorbis", "-b:v", "1M");
    else if (targetExt === "mp4") args.push("-c:v", "libx264", "-c:a", "aac", "-b:v", "1M");
    else if (targetExt === "avi") args.push("-c:v", "mpeg4", "-c:a", "mp3", "-b:v", "1M");
    else if (targetExt === "mkv") args.push("-c:v", "libx264", "-c:a", "aac", "-b:v", "1M");
    else if (targetExt === "mov") args.push("-c:v", "mpeg4", "-c:a", "aac", "-b:v", "1M");
  }

  args.push("-y", outputName);

  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile(outputName);
  const target = ALL_FORMATS.find((f) => f.ext === targetExt);
  const uint8 = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  const blob = new Blob([new Uint8Array(uint8)], { type: target?.mime });
  const name = file.name.replace(/\.[^.]+$/, `.${targetExt}`);

  onProgress({ stage: "Done!", percent: 100 });
  return { blob, fileName: name, mimeType: target?.mime || "", size: blob.size, downloadUrl: URL.createObjectURL(blob) };
}

// ── Main Convert Function ──

export async function convertFile(
  file: File,
  targetExt: string,
  onProgress: (p: ConversionProgress) => void
): Promise<ConversionResult> {
  const cat = getCategory(file);
  if (!cat) throw new Error(`Unsupported file type: ${file.type}`);

  switch (cat) {
    case "image":
      return convertImage(file, targetExt, onProgress);
    case "document":
      return convertDocument(file, targetExt, onProgress);
    case "video":
    case "audio":
      return convertMedia(file, targetExt, cat, onProgress);
    default:
      throw new Error(`Unsupported category: ${cat}`);
  }
}

// ── Utility Helpers ──

function markdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^\- (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Converted</title></head><body><p>${html}</p></body></html>`;
}

function csvToJson(csv: string): string {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return "[]";
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] || ""]));
  });
  return JSON.stringify(rows, null, 2);
}

function jsonToCsv(json: string): string {
  try {
    const data = JSON.parse(json);
    if (!Array.isArray(data) || data.length === 0) return "";
    const headers = Object.keys(data[0]);
    const rows = data.map((row: any) => headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","));
    return [headers.join(","), ...rows].join("\n");
  } catch {
    return json;
  }
}

function csvToHtml(csv: string): string {
  const lines = csv.trim().split("\n");
  const headers = lines[0]?.split(",").map((h) => `<th>${h.trim().replace(/^"|"$/g, "")}</th>`).join("") || "";
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => `<td>${c.trim().replace(/^"|"$/g, "")}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f4f4f4}</style></head><body><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function jsonToXml(json: string): string {
  try {
    const data = JSON.parse(json);
    const toXml = (obj: any, tag: string): string => {
      if (Array.isArray(obj)) return obj.map((item) => toXml(item, "item")).join("\n");
      if (typeof obj === "object" && obj !== null) {
        const inner = Object.entries(obj).map(([k, v]) => toXml(v, k)).join("\n");
        return `<${tag}>\n${inner}\n</${tag}>`;
      }
      return `<${tag}>${String(obj)}</${tag}>`;
    };
    return `<?xml version="1.0" encoding="UTF-8"?>\n<root>\n${toXml(data, "data")}\n</root>`;
  } catch {
    return `<?xml version="1.0"?><root>${json}</root>`;
  }
}

function xmlToJson(xml: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const nodeToObj = (node: Element): any => {
      if (node.children.length === 0) return node.textContent;
      const obj: any = {};
      Array.from(node.children).forEach((child) => {
        const key = child.tagName;
        const val = nodeToObj(child as Element);
        if (obj[key]) {
          if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
          obj[key].push(val);
        } else {
          obj[key] = val;
        }
      });
      return obj;
    };
    return JSON.stringify(nodeToObj(doc.documentElement), null, 2);
  } catch {
    return "{}";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
