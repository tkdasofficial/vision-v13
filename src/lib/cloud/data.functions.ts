import { createServerFn } from "@tanstack/react-start";
import type { QuerySpec } from "./query-types";

const ACTIONS = ["select", "insert", "update", "upsert", "delete"];

export const runDataQuery = createServerFn({ method: "POST" })
  .inputValidator((input: QuerySpec) => {
    if (!input || typeof input.table !== "string" || !ACTIONS.includes(input.action) || !Array.isArray(input.filters) || !Array.isArray(input.orders))
      throw new Error("Invalid request");
    return input;
  })
  .handler(async ({ data }) => {
    const { getCaller } = await import("./auth.server");
    const { runQuery } = await import("./query.server");
    if (data.action !== "select") {
      const { assertSameOrigin, currentFacts } = await import("./security.server");
      assertSameOrigin(currentFacts());
    }
    const caller = await getCaller();
    const res = await runQuery(data, caller);
    return res;
  });
