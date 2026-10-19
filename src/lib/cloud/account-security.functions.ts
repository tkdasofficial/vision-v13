import { createServerFn } from "@tanstack/react-start";

// Settings → Security: password status and change. 2FA is not yet implemented.
export const securityStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireCaller } = await import("./auth.server");
  const { d1 } = await import("./d1.server");
  const caller = await requireCaller();
  const row: any = (await d1("SELECT password_hash FROM auth_users WHERE id = ?", [caller.user.id]))[0];
  const ids = await d1<any>("SELECT provider FROM auth_identities WHERE user_id = ?", [caller.user.id]);
  return { hasPassword: !!row?.password_hash, providers: ids.map((i) => String(i.provider)), email: caller.user.email };
});

export const changePasswordFn = createServerFn({ method: "POST" })
  .inputValidator((input: { current: string; next: string }) => {
    if (!input || typeof input.current !== "string" || typeof input.next !== "string") throw new Error("Invalid input");
    return input;
  })
  .handler(async ({ data }) => {
    const S = await import("./security.server");
    try { S.assertSameOrigin(S.currentFacts()); } catch (e: any) { return { error: e.message as string }; }
    const a = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const caller = await a.requireCaller();
    if (data.next.length < 8 || data.next.length > 128) return { error: "New password must be 8–128 characters." };
    if (data.next === data.current) return { error: "New password must be different." };
    try { await a.rateLimit(`pwchange:${caller.user.id}`, 5, 900); } catch { return { error: "Too many attempts. Try again later." }; }
    const row: any = (await d1("SELECT password_hash, salt FROM auth_users WHERE id = ?", [caller.user.id]))[0];
    if (!row?.password_hash) return { error: "This account signs in with Google or GitHub and has no password." };
    if (!(await a.verifyPassword(data.current, row.salt, row.password_hash))) return { error: "Current password is incorrect." };
    const salt = a.randomToken(16);
    await d1("UPDATE auth_users SET password_hash = ?, salt = ? WHERE id = ?", [await a.hashPassword(data.next, salt), salt, caller.user.id]);
    // Sign out every other device, then start a fresh session here.
    await d1("DELETE FROM auth_sessions WHERE user_id = ?", [caller.user.id]);
    await a.startSession(caller.user.id);
    return { error: null };
  });
