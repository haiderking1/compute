import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const mode = process.argv[2] ?? "all";
if (!["all", "unit", "integration"].includes(mode)) throw new Error("Unknown test mode: " + mode);
const files = (await readdir(root, { recursive: true }))
  .filter(path => !path.startsWith("node_modules/") && !path.startsWith("claude-code/") && path.endsWith(".test.ts"))
  .filter(path => mode === "all" || path.endsWith(".integration.test.ts") === (mode === "integration"))
  .sort().map(path => "./" + path);
if (!files.length) throw new Error("No tests found");
const result = spawnSync("bun", ["test", ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PI_COMPUTE_NODE: process.env.PI_COMPUTE_NODE || process.execPath },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
