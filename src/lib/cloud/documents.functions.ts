import { createServerFn } from "@tanstack/react-start";

// Research documents: owner-only. Not exposed through the generic data query layer.
export const saveDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((input: { title: string; content: string }) => {
    if (!input || typeof input.title !== "string" || typeof input.content !== "string" || !input.content.trim()) throw new Error("Invalid document");
    return { title: input.title.trim().slice(0, 200) || "Research report", content: input.content.slice(0, 200_000) };
  })
  .handler(async ({ data }) => {
    const { assertSameOrigin, currentFacts } = await import("./security.server");
    assertSameOrigin(currentFacts());
    const { requireCaller } = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const caller = await requireCaller();
    const id = crypto.randomUUID();
    await d1("INSERT INTO research_documents (id, user_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)", [id, caller.user.id, data.title, data.content, Date.now()]);
    return { id, title: data.title };
  });

export type DocumentResult =
  | { status: "ok"; doc: { id: string; title: string; content: string; createdAt: number } }
  | { status: "signin" | "denied" | "missing" };

export const getDocumentFn = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => {
    if (!input || typeof input.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id)) throw new Error("Invalid document id");
    return input;
  })
  .handler(async ({ data }): Promise<DocumentResult> => {
    const { getCaller } = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const caller = await getCaller();
    if (!caller) return { status: "signin" };
    const rows = await d1<any>("SELECT id, user_id, title, content, created_at FROM research_documents WHERE id = ?", [data.id]);
    const row = rows[0];
    if (!row) return { status: "missing" };
    if (row.user_id !== caller.user.id) return { status: "denied" };
    return { status: "ok", doc: { id: row.id, title: row.title, content: row.content, createdAt: row.created_at } };
  });

export const listDocumentsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireCaller } = await import("./auth.server");
  const { d1 } = await import("./d1.server");
  const caller = await requireCaller();
  const rows = await d1<any>("SELECT id, title, created_at FROM research_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 200", [caller.user.id]);
  return rows.map((r) => ({ id: r.id as string, title: r.title as string, createdAt: Number(r.created_at) }));
});

/** Deletes one owned document, or all of the caller's documents when id is "all". */
export const deleteDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => {
    if (!input || typeof input.id !== "string" || !(input.id === "all" || /^[0-9a-f-]{36}$/i.test(input.id))) throw new Error("Invalid document id");
    return input;
  })
  .handler(async ({ data }) => {
    const { assertSameOrigin, currentFacts } = await import("./security.server");
    assertSameOrigin(currentFacts());
    const { requireCaller } = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const caller = await requireCaller();
    if (data.id === "all") await d1("DELETE FROM research_documents WHERE user_id = ?", [caller.user.id]);
    else await d1("DELETE FROM research_documents WHERE id = ? AND user_id = ?", [data.id, caller.user.id]);
    return { ok: true };
  });
