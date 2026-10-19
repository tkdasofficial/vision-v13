import { useState, useCallback } from "react";
import { FileText, Download, Copy, Check, Eye, EyeOff, FileCode, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { exportToDrive } from '@/lib/drive-export';

type Props = {
  file: {
    fileName: string;
    content: string;
    mimeType: string;
    format: string;
  };
};

const FORMAT_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  txt: FileText,
  md: FileText,
  html: FileCode,
  csv: FileSpreadsheet,
  json: FileCode,
  xml: FileCode,
  js: FileCode,
  ts: FileCode,
  py: FileCode,
  css: FileCode,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
};

const FileCreatorCard = ({ file }: Props) => {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const Icon = FORMAT_ICONS[file.format] || FileText;
  const isExcel = file.format === "xlsx" || file.format === "xls";

  // For Excel, parse the JSON content for preview
  let excelData: any = null;
  let previewText = "";
  if (isExcel) {
    try {
      excelData = typeof file.content === "string" ? JSON.parse(file.content) : file.content;
      // Build a text preview from sheet data
      const sheets = excelData.sheets || [];
      previewText = sheets.map((sheet: any) => {
        const headers = (sheet.columns || []).map((c: any) => c.header).join(" | ");
        const rows = (sheet.rows || []).slice(0, 5).map((row: any) =>
          (sheet.columns || []).map((c: any) => row[c.key] ?? "").join(" | ")
        );
        const more = (sheet.rows || []).length > 5 ? `\n... ${(sheet.rows || []).length - 5} more rows` : "";
        return `📊 ${sheet.name}\n${headers}\n${"─".repeat(40)}\n${rows.join("\n")}${more}`;
      }).join("\n\n");
    } catch {
      previewText = file.content;
    }
  }

  const lines = isExcel ? previewText.split("\n") : file.content.split("\n");
  const previewLines = lines.slice(0, 20);
  const hasMore = lines.length > 20;

  const handleDownload = useCallback(async () => {
    if (isExcel && excelData) {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "AI File Creator";
      workbook.created = new Date();

      const sheets = excelData.sheets || [];
      for (const sheetData of sheets) {
        const ws = workbook.addWorksheet(sheetData.name || "Sheet1");
        const styles = sheetData.styles || {};

        // Set columns
        ws.columns = (sheetData.columns || []).map((col: any) => ({
          header: col.header,
          key: col.key,
          width: col.width || 15,
        }));

        // Style header row
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: styles.headerBold !== false, color: { argb: styles.headerColor || "FFFFFFFF" }, size: 11 };
        headerRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF" + (styles.headerBg || "4472C4") },
        };
        headerRow.alignment = { vertical: "middle", horizontal: "center" };
        headerRow.height = 24;

        // Add data rows
        for (let i = 0; i < (sheetData.rows || []).length; i++) {
          const row = sheetData.rows[i];
          const wsRow = ws.addRow(row);

          // Alternate row coloring
          if (styles.alternateRows && i % 2 === 0) {
            wsRow.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FF" + (styles.altRowBg || "D9E2F3") },
            };
          }

          // Handle formulas
          wsRow.eachCell((cell: any, colNum: number) => {
            const val = cell.value;
            if (typeof val === "string" && val.startsWith("=")) {
              cell.value = { formula: val.substring(1) };
            }
            // Apply column-specific formatting
            const colDef = (sheetData.columns || [])[colNum - 1];
            if (colDef?.format === "currency") {
              cell.numFmt = "$#,##0.00";
            } else if (colDef?.format === "percentage") {
              cell.numFmt = "0.00%";
            } else if (colDef?.format === "date") {
              cell.numFmt = "yyyy-mm-dd";
            }
          });
        }

        // Borders
        if (styles.borders) {
          ws.eachRow((row: any) => {
            row.eachCell((cell: any) => {
              cell.border = {
                top: { style: "thin", color: { argb: "FFD0D0D0" } },
                left: { style: "thin", color: { argb: "FFD0D0D0" } },
                bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
                right: { style: "thin", color: { argb: "FFD0D0D0" } },
              };
            });
          });
        }

        // Freeze header
        if (styles.freezeHeader !== false) {
          ws.views = [{ state: "frozen", ySplit: 1 }];
        }

        // Auto-filter
        if (ws.columns.length > 0) {
          ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: ws.columns.length },
          };
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      await exportToDrive(blob, file.fileName);
      return;
    }

    // PDF via jspdf
    if (file.format === "pdf") {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const margin = 15;
      const maxWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      pdf.setFont("helvetica");
      pdf.setFontSize(11);
      const splitLines = pdf.splitTextToSize(file.content, maxWidth);
      let y = margin;
      const lineHeight = 5.5;
      for (const line of splitLines) {
        if (y + lineHeight > pdf.internal.pageSize.getHeight() - margin) {
          pdf.addPage();
          y = margin;
        }
        pdf.text(line, margin, y);
        y += lineHeight;
      }
      await exportToDrive(pdf.output('blob'), file.fileName);
      return;
    }

    const blob = new Blob([file.content], { type: file.mimeType });
    await exportToDrive(blob, file.fileName);
  }, [file, isExcel, excelData]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(isExcel ? previewText : file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [file.content, isExcel, previewText]);

  return (
    <Card className="bg-card/50 border-border/50 backdrop-blur-sm max-w-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
          <Icon className="w-4 h-4 text-primary" />
          {isExcel ? "Generated Spreadsheet" : "Generated File"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* File info */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/30">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-mono font-bold text-primary uppercase">.{file.format}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{file.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {isExcel && excelData
                ? `${excelData.sheets?.length || 1} sheet(s) • ${excelData.sheets?.reduce((t: number, s: any) => t + (s.rows?.length || 0), 0) || 0} rows`
                : `${lines.length} lines • ${(new Blob([file.content]).size / 1024).toFixed(1)} KB`}
            </p>
          </div>
        </div>

        {/* Excel sheet tabs */}
        {isExcel && excelData?.sheets?.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {excelData.sheets.map((s: any, i: number) => (
              <span key={i} className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary font-medium whitespace-nowrap">
                {s.name}
              </span>
            ))}
          </div>
        )}

        {/* Content preview */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showPreview ? "Hide" : "Show"} Preview
            </button>
            <span className="text-[10px] text-muted-foreground font-mono">{file.format.toUpperCase()}</span>
          </div>

          {showPreview && (
            <div className="rounded-lg bg-muted/30 border border-border/30 overflow-hidden">
              <pre className="p-3 text-xs font-mono text-foreground/80 overflow-x-auto max-h-[240px] overflow-y-auto leading-relaxed whitespace-pre-wrap break-words">
                {previewLines.join("\n")}
                {hasMore && (
                  <span className="text-muted-foreground">{"\n"}... {lines.length - 20} more lines</span>
                )}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button size="sm" onClick={handleDownload} className="flex-1 gap-1.5 text-xs">
            <Download className="w-3.5 h-3.5" />
            Download {file.format.toUpperCase()}
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5 text-xs">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default FileCreatorCard;
