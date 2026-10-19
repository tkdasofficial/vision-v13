import { createServerFn } from "@tanstack/react-start";

// Fact-check records for one of the caller's own chat replies (owner-only; other users' rows are never readable).
export const getClaimChecksFn = createServerFn({ method: "GET" })
  .inputValidator((input: { messageId: string }) => {
    if (!input || typeof input.messageId !== "string" || !/^[\w-]{8,64}$/.test(input.messageId)) throw new Error("Invalid message id");
    return input;
  })
  .handler(async ({ data }) => {
    const { getCaller } = await import("./auth.server");
    const caller = await getCaller();
    if (!caller) return { status: "signin" as const };
    const { d1 } = await import("./d1.server");
    const { claimCheckStore } = await import("@/lib/ai/factcheck.server");
    const row = await claimCheckStore(d1, caller.user.id).get(data.messageId);
    return row ? { status: "ok" as const, ...row } : { status: "missing" as const };
  });
