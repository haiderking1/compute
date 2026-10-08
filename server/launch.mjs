/**
 * Plugin entry: installs the pinned dependencies on first start (a plugin install
 * copies the repository without node_modules), then runs the MCP server.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

if (!existsSync(new URL("../node_modules/typebox/package.json", import.meta.url))) {
	process.stderr.write("compute: installing dependencies (first start)\n");
	// stdout carries MCP messages, so npm's output goes to stderr.
	const result = spawnSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
		cwd: root,
		stdio: ["ignore", process.stderr, process.stderr],
	});
	if (result.error || result.status !== 0) {
		process.stderr.write(`compute: npm ci failed in ${root}; run it there by hand\n`);
		process.exit(1);
	}
}

await import("./index.ts");
