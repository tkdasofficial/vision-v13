import { createServerFn } from "@tanstack/react-start";

type Res<T> = { data: T | null; error: string | null };

async function run<T>(fn: (m: typeof import("./enterprise.server")) => Promise<T>): Promise<Res<T>> {
  const m = await import("./enterprise.server");
  try {
    return { data: await fn(m), error: null };
  } catch (e) {
    if (e instanceof m.EnterpriseError) return { data: null, error: e.message };
    console.error("[enterprise]", (e as Error).message);
    return { data: null, error: "Something went wrong. Please try again." };
  }
}

export const enterpriseStateFn = createServerFn({ method: "GET" }).handler(() => run((m) => m.getState()));
export const enterpriseStartFn = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; domain: string }) => d)
  .handler(({ data }) => run((m) => m.start(data?.name, data?.domain)));
export const enterpriseCheckDomainFn = createServerFn({ method: "POST" }).handler(() => run((m) => m.checkDomain()));
export const enterpriseEmailFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => d)
  .handler(({ data }) => run((m) => m.submitEmail(data?.email)));
export const enterpriseResendFn = createServerFn({ method: "POST" }).handler(() => run((m) => m.resend()));
export const enterpriseVerifyFn = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => d)
  .handler(({ data }) => run((m) => m.verify(data?.code)));
export const enterpriseCancelFn = createServerFn({ method: "POST" }).handler(() => run((m) => m.cancel()));
export const enterpriseProfileFn = createServerFn({ method: "GET" }).handler(() => run((m) => m.getProfile()));
export const enterpriseOnboardFn = createServerFn({ method: "POST" })
  .inputValidator((d: import("./enterprise.server").OnboardingInput) => d)
  .handler(({ data }) => run((m) => m.completeOnboarding(data)));
