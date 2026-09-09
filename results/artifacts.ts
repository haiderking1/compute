import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function saveOutput(text: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-compute-output-"));
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
