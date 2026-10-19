// Central risk engine: combines signals into an explainable decision with false-positive control.
import type { Decision, RiskResult, RiskSignal } from "../types";
import { SECURITY_CONFIG } from "../config";

const ORDER: Decision[] = ["ALLOW", "REQUIRE_VERIFICATION", "TEMPORARILY_LIMIT", "RESTRICT", "DENY"];
export const decisionRank = (d: Decision) => ORDER.indexOf(d);

export function evaluateRisk(signals: RiskSignal[], t = SECURITY_CONFIG.thresholds): RiskResult {
  const score = Math.min(100, signals.reduce((n, s) => n + s.weight, 0));
  let decision: Decision =
    score >= t.deny ? "DENY" : score >= t.restrict ? "RESTRICT" : score >= t.limit ? "TEMPORARILY_LIMIT" : score >= t.verify ? "REQUIRE_VERIFICATION" : "ALLOW";
  // False-positive control: signals from a single category (e.g. only a VPN, only a shared network)
  // can at most require verification, unless a strong signal is present.
  const categories = new Set(signals.map((s) => s.category));
  const hasStrong = signals.some((s) => s.strong);
  if (!hasStrong && categories.size < 2 && decisionRank(decision) > decisionRank("REQUIRE_VERIFICATION")) decision = "REQUIRE_VERIFICATION";
  return { decision, score, reasons: signals.map((s) => s.id) };
}

/** Whether the decision blocks the current attempt. */
export const blocks = (d: Decision) => decisionRank(d) >= decisionRank("TEMPORARILY_LIMIT");
