# Snapshot verification

Environment: Linux, Node.js 26.8.1, npm 11.19.0, Bun 1.4.0, Pi packages 0.85.1. Node 22.19.0 is the declared Pi minimum, not a version tested in this snapshot run.

- `npm install`: passed; 169 packages added, audit reported zero vulnerabilities.
- `npm ci`: passed from the committed lockfile contents; audit reported zero vulnerabilities.
- Initial `npm test`: 38 passed, 1 failed. The failure was the worker-path assertion hardcoding the original `extensions/compute` location.
- After making the worker-path assertion relative to the test and resolving the locally installed Pi package in the renderer test host, `npm test`: 39 passed, 0 failed (13 files, 167 assertions).
- After `npm ci`, `npm run test:unit`: 31 passed, 0 failed (9 files).
- After `npm ci`, `npm run test:integration`: 8 passed, 0 failed (4 files). These use the real Node worker, local providers, and locally installed Pi renderer host.
- Installed Pi CLI `--version`: passed, reported 0.85.1.

Install warnings: deprecated transitive `node-domexception@1.0.0`; npm reported unapproved install scripts for `@google/genai`, `esbuild`, and `protobufjs`. No install-script approval or global npm policy was changed. The tests and CLI version check passed with that installation.

`git diff --cached --check` reported an inherited extra blank line at EOF in `results/tool-result.ts` (exit 2). It was left unchanged to preserve the implementation snapshot.

Live MCP, model-backed sessions, and manual interactive Pi UI behavior were not tested. Known Pi UI glitches remain. Linux only was tested; macOS and Windows are untested and no support is claimed. No implementation changes were made to hide failures.
