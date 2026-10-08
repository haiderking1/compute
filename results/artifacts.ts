import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeTempRoot } from "../providers/workspace/confine.ts";

/** Under Claude Code, results join its per-user temp root (/tmp/claude-<uid>) instead of Pi's prefix. */
async function outputPrefix(): Promise<string> {
  if (process.env.CLAUDECODE !== "1") return join(tmpdir(), "pi-compute-output-");
  const root = claudeTempRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  return join(root, "compute-output-");
}

export async function saveOutput(text: string): Promise<string> {
  const directory = await mkdtemp(await outputPrefix());
  const path = join(directory, "result.txt");
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    return path;
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
