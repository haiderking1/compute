import { realpathSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProcessImageFn } from "../../core/types.ts";

let processImageFn: ProcessImageFn | null = null;

/**
 * Locate the installed @earendil-works/pi-coding-agent package root by walking
 * up from pi's own entry script (process.argv[1]) until a package.json whose
 * name matches. import.meta.resolve cannot be used here: pi loads extensions
 * through a custom loader that maps the bare specifier for static imports, but
 * the default resolver (and therefore import.meta.resolve) has no
 * node_modules ancestor above ~/.pi.
 */
function piPackageDir(): string | null {
	const entry = process.argv[1];
	if (!entry) return null;
	try {
		let dir = dirname(realpathSync(entry));
		for (let hops = 0; hops < 8; hops++) {
			try {
				const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
				if (pkg.name === "@earendil-works/pi-coding-agent") return dir;
			} catch {
				/* keep walking */
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {
		/* entry unreadable */
	}
	return null;
}

/**
 * pi's processImage (convert-to-supported-format + auto-resize under the
 * inline-image byte cap). It lives in the package's utils but the exports map
 * only exposes the package root, so import the sibling util module directly
 * from pi's own installation.
 */
export async function loadProcessImage(): Promise<ProcessImageFn> {
	if (processImageFn) return processImageFn;
	const root = piPackageDir();
	if (root) {
		for (const rel of ["dist/utils/image-process.js", "src/utils/image-process.ts"]) {
			try {
				const mod: { processImage: ProcessImageFn } = await import(pathToFileURL(join(root, rel)).href);
				if (typeof mod.processImage === "function") {
					processImageFn = mod.processImage;
					return processImageFn;
				}
			} catch {
				/* try the next layout */
			}
		}
	}
	return null;
}

/**
 * Degrade gracefully when pi's resizer is unavailable: pass through formats
 * every vision API accepts, byte-capped. bmp needs conversion (only pi's
 * resizer can do that), and oversized images would blow the context window,
 * so both fail with an actionable message instead of attaching garbage.
 */
export function fallbackImageAttachment(bytes: Buffer, mimeType: string): { ok: true; data: string; mimeType: string; hints: string[] } | { ok: false; message: string } {
	const passthrough = ["image/png", "image/jpeg", "image/gif", "image/webp"];
	if (!passthrough.includes(mimeType)) {
		return { ok: false, message: "[Image omitted: " + mimeType + " requires conversion; pi's image resizer was not found.]" };
	}
	if (bytes.byteLength > 4_500_000) {
		return { ok: false, message: "[Image omitted: larger than the 4.5 MB inline-image limit and pi's image resizer was not found.]" };
	}
	return { ok: true, data: bytes.toString("base64"), mimeType, hints: [] };
}
