# Pi integration

## Dependencies and loading

The package declares `pi.extensions: ["./index.ts"]`. Pi can load that entry directly with `pi -e /absolute/path/to/compute/index.ts`, or register the local package with `pi install /absolute/path/to/compute` after `npm ci`. Installing into Pi changes that Pi configuration; it is not part of snapshot creation. Do not load the original extension and this snapshot together. To try it without your normal agent configuration, use `PI_COMPUTE_NODE="$(command -v node)" PI_CODING_AGENT_DIR="$(mktemp -d)" pi -e /absolute/path/to/compute/index.ts`. That temporary agent directory requires its own model/login setup.

Runtime imports require `@earendil-works/pi-coding-agent` (workspace patches and image utilities), `@earendil-works/pi-tui` (rendering), and `typebox` (schemas and validation). They are direct, pinned dependencies, not assumed global packages. Node is needed for the worker; `PI_COMPUTE_NODE` overrides its executable. Without the override the code uses the host’s `process.execPath`, so set it explicitly when Pi runs under Bun. Bash is needed for `system.bash`; workspace search uses JavaScript rather than an external ripgrep executable.

At session start and before each agent turn, Compute narrows active tools to `compute`, preserving `subagent` if registered. An explicit active set excluding Compute is respected. Pass `--keep-builtin-tools` to opt out of narrowing. The `/compute` command reports providers, active tools, worker path, and MCP URL. Use `/reload` after extension changes.

Compute does not replace the system prompt. No `zz-tools-only-prompt.ts` file or dependency is needed. Source comments mentioning that extension describe the original environment, not a setup requirement. Subagent extensions are optional and not bundled.

## Optional MCP

The built-in workspace and process providers need no MCP server or API key. On the first session start, the implementation nevertheless attempts MCP discovery automatically. There is currently no dedicated disable flag.

- `EXA_MCP_URL` overrides the default `https://mcp.exa.ai/mcp`.
- `EXA_API_KEY`, if present, is sent as an Authorization Bearer header to that URL. Use only an endpoint you trust.
- The client implements Streamable HTTP JSON/SSE itself; no MCP SDK or local MCP server package is required.
- Discovery adds methods under `mcp` from the server’s advertised schemas. Available names depend on the server; do not assume a fixed list.
- Connection/request timeout is 15 seconds. Discovery failure produces a UI warning and leaves local providers available. The first discovery attempt is not automatically retried each session.

Supply your own environment variables outside the repository. Do not commit keys, authenticated URLs, Pi settings, or model credentials. Live MCP access was not tested for this snapshot.

## Platform and UI caveats

Linux is the only tested platform. macOS and Windows are untested and are not claimed as supported. Process cancellation uses Unix process groups and the shell provider calls Bash.

Known Pi UI glitches remain while this is work in progress. Tests cover completed results appearing once, pure skill-result suppression, mixed-result visibility, and renderer lifecycle behavior, but do not cover every interactive redraw or session transition. No manual interactive UI verification was performed for this snapshot.
