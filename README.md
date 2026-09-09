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

## Usage

The AI calls Compute with a JavaScript plan using:

- `workspace.*` for files and searches.
- `system.exec` for direct commands, or `system.bash` for shell commands.
- `mcp.*` for tools discovered from the configured MCP server.

Compute keeps other tools inactive by default, except an available subagent tool. Pass `--keep-builtin-tools` to keep the built-ins too.

See [setup details](docs/setup.md) for optional MCP configuration and [testing](docs/testing.md) for test results and limitations. To run the tests, install Bun and run `npm test`.
