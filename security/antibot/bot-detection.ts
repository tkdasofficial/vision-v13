// Request-level automation signals. Each is weak on its own except a filled honeypot.
import type { ClientHints, RequestFacts, RiskSignal } from "../types";

const AUTOMATION_UA = /(headlesschrome|phantomjs|puppeteer|playwright|selenium|python-requests|curl\/|wget\/|go-http-client|okhttp|scrapy|httpclient)/i;

export function botSignals(req: RequestFacts, hints: ClientHints | undefined, entry: "email" | "oauth"): RiskSignal[] {
  const s: RiskSignal[] = [];
  if (!req.userAgent) s.push({ id: "ua_missing", category: "bot", weight: 25 });
  else if (AUTOMATION_UA.test(req.userAgent)) s.push({ id: "ua_automation", category: "bot", weight: 25 });
  if (!req.acceptLanguage) s.push({ id: "no_accept_language", category: "bot", weight: 10 });
  if (entry === "email") {
    if (hints?.honeypot) s.push({ id: "honeypot_filled", category: "bot", weight: 60, strong: true });
    if (typeof hints?.elapsedMs === "number" && hints.elapsedMs >= 0 && hints.elapsedMs < 1500)
      s.push({ id: "form_too_fast", category: "bot", weight: 15 });
  }
  return s;
}
