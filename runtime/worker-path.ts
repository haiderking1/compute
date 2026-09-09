import { fileURLToPath } from "node:url";

export function workerPath(): string {
	return fileURLToPath(new URL("../worker.mjs", import.meta.url));
}
