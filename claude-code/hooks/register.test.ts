import { test, expect } from 'claude-code/testing'

// Run with `claude plugin test claude-code`; the repo's bun suite skips this folder.

const ROW = {
  tool_use_id: 'toolu_1',
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
}

async function drawnInput($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], tool: string, input: unknown) {
  let drawn: unknown
  on('ui.render', { component: 'ToolUse' }, ($e, e) => {
    drawn = e.props.input
    const { Text } = $e.ui.resolve(e)
    return h(Text, null, 'row')
  })
  await $.ui.mount({ plugin: 'compute', surface: 'terminal', component: 'ToolUse', props: { ...ROW, tool, input } })
  return drawn
}

const PLAN = { title: 'Count files', code: 'async () => 1' }

test('plugin compute row draws the title alone', async ($, on) => {
  expect(await drawnInput($, on, 'mcp__plugin_compute_compute__compute', PLAN)).toEqual({ title: 'Count files' })
})

test('user-scope compute row draws the title alone', async ($, on) => {
  expect(await drawnInput($, on, 'mcp__compute__compute', PLAN)).toEqual({ title: 'Count files' })
})

test('a row without a title keeps its input', async ($, on) => {
  expect(await drawnInput($, on, 'mcp__compute__compute', { code: 'async () => 1' })).toEqual({ code: 'async () => 1' })
})

test('other tools are left alone', async ($, on) => {
  expect(await drawnInput($, on, 'Bash', { command: 'ls' })).toEqual({ command: 'ls' })
})

const CALL = { isRunning: false, isErrored: false, isInterrupted: false }

async function mountGroup($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], calls: unknown[]) {
  on('ui.render', { component: 'ToolGroup' }, ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return h(Text, null, 'engine line')
  })
  return $.ui.mount({
    plugin: 'compute',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { isActive: true, isExpanded: false, calls: calls as never },
  })
}

test('a folded group of compute plans shows their titles', async ($, on) => {
  const ui = await mountGroup($, on, [
    { ...CALL, tool: 'mcp__plugin_compute_compute__compute', input: PLAN },
    { ...CALL, isRunning: true, tool: 'mcp__plugin_compute_compute__compute', input: { title: 'Run tests', code: 'x' } },
  ])
  expect(await ui.find({ text: ' Count files' })).toBeDefined()
  expect(await ui.find({ text: ' Run tests' })).toBeDefined()
  expect(await ui.find({ text: 'engine line' })).toBeUndefined()
})

test('a mixed group is drawn by the engine', async ($, on) => {
  const ui = await mountGroup($, on, [
    { ...CALL, tool: 'mcp__plugin_compute_compute__compute', input: PLAN },
    { ...CALL, tool: 'Read', input: { file_path: '/a' } },
  ])
  expect(await ui.find({ text: 'engine line' })).toBeDefined()
})

test('a plan still being written shows a placeholder, not the engine line', async ($, on) => {
  const ui = await mountGroup($, on, [{ ...CALL, tool: 'mcp__plugin_compute_compute__compute', input: {} }])
  expect(await ui.find({ text: ' writing plan' })).toBeDefined()
  expect(await ui.find({ text: 'engine line' })).toBeUndefined()
})
