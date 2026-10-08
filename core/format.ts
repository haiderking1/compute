/**
 * Bytes as MiB, rounded up to two decimals with trailing zeros dropped
 * (4194304 -> "4", 4194306 -> "4.01"). Rounding up keeps a size that is over a
 * limit from printing as equal to it.
 */
export function formatMiB(bytes: number): string {
	return String(Math.ceil((bytes / (1024 * 1024)) * 100) / 100);
}
