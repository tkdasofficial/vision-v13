// Public entry point for the Vision security system.
export * from "./types";
export { SECURITY_CONFIG } from "./config";
export * from "./utils/crypto";
export * from "./network/ip";
export * from "./identity/email";
export { checkMailDomain } from "./identity/dns";
export { botSignals } from "./antibot/bot-detection";
export { evaluateRisk, blocks } from "./risk/risk-engine";
export { enforceLimits, RateLimitError, nowSec } from "./rate-limits/rate-limit-engine";
export { audit, redact } from "./audit/audit-logger";
export { isSameOriginRequest, SESSION_COOKIE_OPTIONS } from "./cookies/csrf";
export { isRestricted, restrict } from "./enforcement/restrictions";
export { grantInitialCredits } from "./credits/initial-credit-grant";
export { evaluateSignup, recordAccountCreated } from "./core/signup-pipeline";
export type { SignupKeys, SignupVerdict } from "./core/signup-pipeline";
export * from "./identity/domain-verification";
