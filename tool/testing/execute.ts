import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export async function executePlan(cwd: string, code: string, environment: Record<string, string> = {}) {
  const entry = fileURLToPath(new URL("../../index.ts", import.meta.url));
  const script = "const { makeComputeToolDefinition } = await import(" + JSON.stringify(entry) + ");\n" +
    "const result = await makeComputeToolDefinition().execute(\"test\", " +
    JSON.stringify({ title: "Test compute recovery", code, timeout: 10 }) +
    ", undefined, undefined, { cwd: " + JSON.stringify(cwd) + ", model: { input: [\"text\"] } });\n" +
    "console.log(JSON.stringify(result));";
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: homedir(), env: { ...process.env, PI_COMPUTE_NODE: "node", ...environment }, stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error("Test process failed: " + stderr);
  return JSON.parse(stdout);
}
