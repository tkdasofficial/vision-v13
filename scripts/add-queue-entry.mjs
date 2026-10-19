// Post-build: installs worker/entry.mjs (Queue consumer wrapper) next to nitro's server
// output and points the generated deploy config at it. Keeps nitro's unbundled, lazily
// loaded modules, so a queue run only loads the code it needs (Worker memory is limited).
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("worker/entry.mjs", "utf8").replace('from "../dist/server/index.mjs"', 'from "./index.mjs"');
if (!src.includes('from "./index.mjs"')) throw new Error("worker/entry.mjs must import ../dist/server/index.mjs");
writeFileSync("dist/server/worker-entry.mjs", src);

const cfgPath = "dist/server/wrangler.json";
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
cfg.main = "worker-entry.mjs";
if (!cfg.queues?.consumers?.some((c) => c.queue === "vision-story")) throw new Error("vision-story queue consumer missing from generated config");
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log("queue entry installed: dist/server/worker-entry.mjs");
