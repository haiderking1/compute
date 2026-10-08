import type { Register } from 'claude-code'

// Installed as a plugin the server is `plugin:compute:compute`; added with `claude mcp add` it is `compute`.
const COMPUTE_TOOL = /^mcp__(plugin_compute_)?compute__compute$/

type Call = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

/** The plan's title, or '' while the model is still writing the call. */
function planTitle(input: unknown): string {
  const title = (input as { title?: unknown } | null)?.title
  return typeof title === 'string' ? title.trim() : ''
}

function dotColor(call: Call) {
  if (call.isErrored || call.isInterrupted) return 'error'
  return call.isRunning ? 'subtle' : 'success'
}

/** Rows draw `title` alone, as Pi's renderer does; the model still sent the code. */
export const register: Register = on => {
  // A standalone or expanded row (--verbose, ctrl+o): the engine's own row, given only the title.
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const title = COMPUTE_TOOL.test(e.props.tool) ? planTitle(e.props.input) : ''
    return title ? next({ ...e, props: { ...e.props, input: { title } } }) : next(e)
  })

  // The folded line ("Calling plugin:compute:compute…"): one line per plan, by title.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    const { calls } = e.props
    if (e.props.isExpanded || calls.length === 0) return next(e)
    if (!calls.every(call => COMPUTE_TOOL.test(call.tool))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return h(
      Box,
      { flexDirection: 'column' },
      ...calls.map(call => {
        const title = planTitle(call.input)
        return h(
          Box,
          { flexDirection: 'row' },
          h(Text, { color: dotColor(call) }, '⏺ '),
          h(Text, { bold: true }, 'Compute'),
          title
            ? h(Text, { wrap: 'truncate-end' }, ` ${title}`)
            : h(Text, { dimColor: true }, ' writing plan'),
          call.isRunning || !title ? h(Text, { dimColor: true }, '…') : null,
        )
      }),
    )
  })
}
