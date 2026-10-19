import { useState, useEffect, useCallback } from "react";
import { FileType, Download, ArrowRight, CheckCircle, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { persistExport } from '@/lib/drive-export';
import { downloadFile } from '@/lib/download';
import {
  convertFile,
  getTargetFormats,
  detectFormat,
  getCategory,
  formatFileSize,
  type ConversionProgress,
  type ConversionResult,
  type FormatInfo,
} from "@/lib/file-converter";

type Props = {
  file: File;
};

const CATEGORY_COLORS: Record<string, string> = {
  image: "text-emerald-400",
  document: "text-blue-400",
  video: "text-purple-400",
  audio: "text-amber-400",
};

const FileConverterCard = ({ file }: Props) => {
  const [targets, setTargets] = useState<FormatInfo[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<ConversionProgress>({ stage: "", percent: 0 });
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = detectFormat(file);
  const category = getCategory(file);

  useEffect(() => {
    const fmts = getTargetFormats(file);
    setTargets(fmts);
    if (fmts.length > 0) setSelectedTarget(fmts[0].ext);
  }, [file]);

  const handleConvert = useCallback(async () => {
    if (!selectedTarget) return;
    setConverting(true);
    setError(null);
    setResult(null);
    setProgress({ stage: "Starting...", percent: 0 });

    try {
      const res = await convertFile(file, selectedTarget, setProgress);
      const url = await persistExport(res.blob, res.fileName);
      URL.revokeObjectURL(res.downloadUrl);
      setResult({ ...res, downloadUrl: url });
    } catch (e: any) {
      setError(e.message || "Conversion failed");
    } finally {
      setConverting(false);
    }
  }, [file, selectedTarget]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    void downloadFile(result.downloadUrl, result.fileName).catch(e => setError(e.message));
  }, [result]);

  return (
    <Card className="bg-card/50 border-border/50 backdrop-blur-sm max-w-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
          <FileType className="w-4 h-4 text-primary" />
          File Format Converter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Source file info */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/30">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(file.size)} • {source?.label || "Unknown"}{" "}
              <span className={`${CATEGORY_COLORS[category || ""] || "text-muted-foreground"}`}>
                ({category || "unknown"})
              </span>
            </p>
          </div>
          {source && (
            <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-primary/10 text-primary border border-primary/20">
              .{source.ext.toUpperCase()}
            </span>
          )}
        </div>

        {/* Target format selection */}
        {targets.length > 0 && !result && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Convert to:</p>
            <div className="flex flex-wrap gap-1.5">
              {targets.map((fmt) => (
                <button
                  key={fmt.ext}
                  onClick={() => !converting && setSelectedTarget(fmt.ext)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-all border ${
                    selectedTarget === fmt.ext
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-muted/50 text-muted-foreground border-border/50 hover:bg-accent hover:text-accent-foreground"
                  }`}
                  disabled={converting}
                >
                  .{fmt.ext.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {targets.length === 0 && (
          <p className="text-xs text-muted-foreground">No supported conversions for this file type.</p>
        )}

        {/* Progress */}
        {converting && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">{progress.stage}</span>
            </div>
            <Progress value={progress.percent} className="h-1.5" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{result.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(result.size)} •{" "}
                  {result.size < file.size
                    ? `${Math.round((1 - result.size / file.size) * 100)}% smaller`
                    : `${Math.round((result.size / file.size - 1) * 100)}% larger`}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={handleDownload} className="flex-1 gap-1.5 text-xs">
                <Download className="w-3.5 h-3.5" />
                Download
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setResult(null); setError(null); }}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Convert Again
              </Button>
            </div>
          </div>
        )}

        {/* Convert button */}
        {!result && !converting && targets.length > 0 && (
          <Button size="sm" onClick={handleConvert} disabled={!selectedTarget} className="w-full gap-2 text-xs">
            <ArrowRight className="w-3.5 h-3.5" />
            Convert {source?.label} → {targets.find((t) => t.ext === selectedTarget)?.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default FileConverterCard;
