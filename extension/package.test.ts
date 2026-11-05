import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Pi supplies host packages through wildcard peer dependencies", () => {
	for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"]) {
		expect(manifest.peerDependencies[name]).toBe("*");
		expect(manifest.dependencies?.[name]).toBeUndefined();
		expect(manifest.devDependencies[name]).toBeDefined();
	}
});
