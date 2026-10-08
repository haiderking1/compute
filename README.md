# Compute

Compute is a tool I built to keep AI context clean. It runs operations in an isolated JavaScript worker and returns only the results the AI needs, instead of dumping walls of logs into the conversation.

Work in progress. Some Pi UI glitches remain. Tested on Linux only; macOS and Windows are untested.

## Install

With Pi, Node.js 22.19+ and npm installed:

1. Put this repo's folder at `~/.pi/agent/extensions/compute`.
2. Install its dependencies:

   ```sh
   cd ~/.pi/agent/extensions/compute
   npm install
   ```

3. Start Pi, or run `/reload` if it is already open.

Keep only one copy loaded. If Pi runs under Bun, launch it with `PI_COMPUTE_NODE="$(command -v node)" pi` so the worker uses Node.

### Claude Code

This repo is a Claude Code plugin and its own marketplace:

```
/plugin marketplace add haiderking1/compute
/plugin install compute@compute
```

The plugin runs the `compute` MCP server (`server/`) and installs its npm dependencies on first start. It also adds a hook (`claude-code/`) that shows a plan's `title` in the tool row instead of its code. Plans run in the directory Claude Code was started in. Set `COMPUTE_CWD` to override it. Run the hook's tests with `claude plugin test claude-code`.

For another MCP host, run `npm ci`, then point it at `node /absolute/path/to/compute/server/index.ts`.

## Usage

The AI calls Compute with a JavaScript plan using:

- `workspace.*` for files and searches.
- `system.exec` for direct commands, or `system.bash` for shell commands.
- `mcp.*` for tools discovered from the configured MCP server.

Compute keeps other tools inactive by default, except an available subagent tool. Pass `--keep-builtin-tools` to keep the built-ins too.

See [setup details](docs/setup.md) for optional MCP configuration and [testing](docs/testing.md) for test results and limitations. To run the tests, install Bun and run `npm test`.
