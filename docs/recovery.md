# Failure handling and result recovery

## Independent calls

Use native Promise.allSettled when one failed read or search should not discard another result. Provider failures now serialize their name, provider, method, and message. They remain exceptions, so existing try/catch and Promise.all behavior is unchanged.

```js
async () => {
  const results = await Promise.allSettled([
    workspace.read({ path: "README.md", limit: 30 }),
    workspace.read({ path: "optional-notes.md", limit: 30 }),
  ]);
  return results.map((result, index) => result.status === "fulfilled"
    ? { index, value: result.value }
    : { index, error: result.reason });
}
```

Use this for independent operations. It does not make writes transactional. A system.exec command with a nonzero exitCode still fulfills its promise; check that field explicitly. Compute does not retry failed calls automatically.

Uncaught provider failures identify the provider and method. JavaScript errors include the original plan line and column when the VM supplies a location. Diagnostics omit host stacks and stay within UTF-8 byte and line budgets.

## Large results

Results over 8,000 UTF-8 bytes or 2,000 lines no longer require rerunning the plan. Compute saves the full textual result to a private temporary directory and returns a short preview, the file path, byte count, and line count.

The directory has mode 0700 and result.txt has mode 0600. Returned details include codeModeOutput with truncated, path, bytes, and lines. Call traces remain available. Image attachments stay attached and do not count against the text budget.

Read a portion with workspace.read using offset and limit, or filter the saved result in a follow-up plan. Small results retain their original representation. Large JSON results remain complete JSON in the file.

The original operations have already finished. Do not repeat them just to retrieve output. If saving fails, compute reports that failure with a bounded preview and the call trace, and warns that side effects may already have occurred.

These files are temporary, not a durable store. They remain until explicitly removed or cleaned by the operating system. There is no automatic result replay or background-subagent scheduling.

## Verification

Run bun test from this extension directory. Integration tests use the real Node worker and local providers, including a failed parallel read, malformed JavaScript, saved-output readback, a counter that must not be incremented twice, and a real temporary-directory failure.

Reload Pi with /reload to load parent-side extension and tool-description changes.
