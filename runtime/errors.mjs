const MAX_ERROR_BYTES = 16 * 1024;
const MAX_ERROR_LINES = 40;
export const PLAN_LINE_OFFSET = 2;

export class ProviderCallError extends Error {
  constructor(provider, method, message) {
    super(message);
    this.name = "ProviderCallError";
    this.provider = provider;
    this.method = method;
  }

  toJSON() {
    return { name: this.name, provider: this.provider, method: this.method, message: this.message };
  }
}

function field(error, key) {
  try {
    const value = error?.[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function planLocation(error) {
  const match = field(error, "stack")?.match(/compute-plan\.js:(\d+)(?::(\d+))?/);
  if (!match) return "";
  const line = Number(match[1]) - PLAN_LINE_OFFSET;
  if (line < 1) return "";
  return "\n[plan line " + line + (match[2] ? ", column " + match[2] : "") + "]";
}

function bounded(text) {
  const suffix = "\n[error truncated]";
  const budget = MAX_ERROR_BYTES - Buffer.byteLength(suffix);
  let output = "", bytes = 0, lines = 1;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > budget || (char === "\n" && lines >= MAX_ERROR_LINES - 1)) return output + suffix;
    output += char;
    bytes += size;
    if (char === "\n") lines++;
  }
  return output;
}

export function formatPlanError(error) {
  let message = field(error, "message");
  if (message === undefined) {
    try { message = String(error ?? "Unknown JavaScript error"); }
    catch { message = "Unknown JavaScript error"; }
  }
  const provider = field(error, "provider"), method = field(error, "method");
  if (provider && method) message = provider + "." + method + ": " + message;
  else {
    const name = field(error, "name");
    if (name && name !== "Error") message = name + ": " + message;
  }
  return bounded(message + planLocation(error));
}
