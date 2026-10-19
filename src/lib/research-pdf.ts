// Builds a text PDF from the report's Markdown (headings, paragraphs, bullets, tables as rows).
export async function buildReportPdf(title: string, markdown: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 50;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const bottom = pdf.internal.pageSize.getHeight() - margin;
  let y = margin;

  const write = (text: string, size: number, bold = false, indent = 0) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    for (const line of pdf.splitTextToSize(text, width - indent) as string[]) {
      if (y + size > bottom) { pdf.addPage(); y = margin; }
      pdf.text(line, margin + indent, y + size);
      y += size * 1.4;
    }
  };
  const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  let body = markdown;
  if (body.trimStart().startsWith("# ")) body = body.trimStart().split("\n").slice(1).join("\n");
  write(title, 20, true);
  y += 8;
  for (const raw of body.split("\n")) {
    const l = raw.trim();
    if (!l) { y += 6; continue; }
    if (/^\|?\s*:?-{3,}/.test(l)) continue;
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { y += 6; write(plain(h[2]), h[1].length <= 2 ? 15 : 12, true); continue; }
    const b = l.match(/^([-*]|\d+\.)\s+(.*)/);
    if (b) { write(`• ${plain(b[2])}`, 11, false, 12); continue; }
    if (l.startsWith("|")) { write(plain(l.split("|").map((c) => c.trim()).filter(Boolean).join("  |  ")), 10); continue; }
    write(plain(l), 11);
  }
  return pdf.output("blob");
}

export function pdfFilename(title: string) {
  return `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "report"}.pdf`;
}
