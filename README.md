# Compute

Compute is a tool I built to keep AI context clean. It runs operations in an isolated JavaScript worker and returns only the results the AI needs, instead of dumping walls of logs into the conversation.

**Work in progress.** Known Pi UI glitches remain; renderer regression tests do not mean the interactive UI is glitch-free. Tested on Linux only. macOS and Windows are untested; no support is claimed for either.

## Setup

You need Node.js 22.19.0 or newer, npm, and Pi. This snapshot pins the inspected Pi packages to 0.85.1. Bun is also required for tests (tested with 1.4.0). Bash is required for `system.bash`; commands passed to `system.exec` must be installed separately.

```sh
npm ci
# From this checkout; a separate agent directory avoids duplicate extensions.
PI_COMPUTE_NODE="$(command -v node)" PI_CODING_AGENT_DIR="$(mktemp -d)" npx --no-install pi -e ./index.ts
npm test
```

The temporary Pi agent directory starts without your normal agent settings, credentials, or extensions. Configure your own model/login to run an AI session. Nothing here copies personal settings. See [integration and optional MCP](docs/setup.md) before using an existing Pi configuration.

## What it exposes

- `workspace`: read, write, edit, glob, grep, and image reads.
- `system.exec`: exact argument arrays, without shell parsing.
- `system.bash`: shell commands through `bash -lc`.
- Optional MCP methods discovered at session start, exposed under `mcp`.

Provider methods are callable inside a Compute plan, not as separate model-facing tools. Plans can filter results, branch, and combine calls. Oversized results go to temporary files for later readback; see [failure handling and recovery](docs/recovery.md).

The worker uses a child process and a Node VM, not a security boundary for hostile code. Provider calls run with the Pi user’s filesystem, process, and network permissions. The 64 MiB budget uses a heap watchdog, with a separate 128 MiB old-space cap; it is not a hard 64 MiB process-memory limit.

## Development

```sh
npm test
npm run test:unit
npm run test:integration
```

The runner selects the real Bun tests and sets `PI_COMPUTE_NODE` to Node unless already supplied. No build step is needed: Pi loads TypeScript and the worker is JavaScript.

See [test results and known limitations](docs/testing.md).

No open-source license has been assigned to this snapshot. Existing attribution comments remain; dependency licenses belong to their respective authors.
