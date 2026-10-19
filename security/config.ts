// Tunable thresholds. Values are conservative so shared networks and privacy tools are not banned.

export type Limit = { max: number; windowSec: number };

export const SECURITY_CONFIG = {
  limits: {
    signupPerIp: { max: 10, windowSec: 3600 },
    signupPerEmail: { max: 5, windowSec: 900 },
    signupPerDevice: { max: 5, windowSec: 3600 },
    loginPerEmail: { max: 10, windowSec: 900 },
    loginPerIp: { max: 40, windowSec: 900 },
    otpVerifyPerEmail: { max: 10, windowSec: 900 },
    otpVerifyPerIp: { max: 30, windowSec: 900 },
    otpResendPerEmail: { max: 3, windowSec: 900 },
    otpResendPerIp: { max: 10, windowSec: 3600 },
    chatPerUser: { max: 60, windowSec: 60 },
    uploadPerUser: { max: 30, windowSec: 600 },
  } satisfies Record<string, Limit>,
  /** Accounts created per network / device before it counts as a burst signal. Network is high for CGNAT. */
  burst: { networkSignups24h: 8, deviceSignups24h: 3, verifyFailures1h: 10 },
  thresholds: { verify: 25, limit: 50, restrict: 70, deny: 90 },
  cooldownSec: { limit: 15 * 60, restrict: 60 * 60 },
  otp: { ttlSec: 10 * 60, maxAttempts: 5 },
  session: { days: 30, maxConcurrent: 10 },
  credits: {
    initialAmount: 100,
    /** Max initial grants per network / device within the window before grants are withheld for review. */
    maxGrantsPerNetwork: 5,
    maxGrantsPerDevice: 2,
    grantWindowSec: 30 * 86400,
  },
  dns: { timeoutMs: 1500, cacheTtlMs: 10 * 60 * 1000 },
  retention: { eventDays: 30 },
  /** Optional paid/external intelligence adapters; disabled unless configured. */
  providers: { networkIntelligence: false, emailIntelligence: false },
};

export type SecurityConfig = typeof SECURITY_CONFIG;
