import { useState, useEffect, forwardRef } from "react";

export type ThinkingPhase = "thinking" | "creating" | "analyzing" | "working" | "researching" | "fetching" | "writing" | "optimizing";

const PHASE_LABELS: Record<ThinkingPhase, string> = {
  thinking: "Thinking",
  creating: "Creating",
  analyzing: "Analyzing",
  working: "Working",
  fetching: "Searching",
  researching: "Searching",
  writing: "Creating",
  optimizing: "Working",
};

type Props = {
  phase?: ThinkingPhase;
  /** Real backend stage label (from task events); overrides the local phase. */
  label?: string;
  detail?: string;
  /** Stages already passed, shown as a compact trail. */
  done?: string[];
};

const TypingIndicator = forwardRef<HTMLDivElement, Props>(({ phase = "thinking", label: stageLabel }, ref) => {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const label = stageLabel || PHASE_LABELS[phase] || "Thinking";
  const dotStr = ".".repeat(dots);

  return (
    <div ref={ref} role="status" aria-live="polite" className="mx-auto w-full max-w-2xl animate-fade-in px-3 sm:px-4 md:px-6 py-3">
      <span key={label} className="animate-fade-in text-sm font-medium text-foreground">{label}<span className="text-muted-foreground">{dotStr}</span></span>
    </div>
  );
});

TypingIndicator.displayName = "TypingIndicator";

export default TypingIndicator;

export function detectPhase(content: string, toolId?: string): ThinkingPhase {
  const lower = content.toLowerCase();
  
  if (/\b(analy[sz]e|review|evaluate|assess|compare)\b/.test(lower)) {
    return "analyzing";
  }
  if (/\b(research|find|search|look up|discover)\b/.test(lower)) {
    return "researching";
  }
  if (/\b(write|script|draft|compose|blog|article|story)\b/.test(lower)) {
    return "writing";
  }
  if (/\b(optimi[sz]e|seo|improve|enhance|boost)\b/.test(lower)) {
    return "optimizing";
  }
  
  if (toolId === "script-writer") return "writing";
  if (toolId === "seo-optimizer") return "optimizing";
  if (toolId === "content-optimizer") return "optimizing";
  if (toolId === "content-analyzer") return "analyzing";
  
  return "thinking";
}
