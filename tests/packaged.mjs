// Run against an unpacked Windows release, including its MCP companion and ASAR renderer.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _electron } from 'playwright-core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { checkMaker, checkEditing } from './maker.mjs'

const executable = path.resolve(process.argv[2] || 'release/windows/win-unpacked/PAI.exe')
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'pai-packaged-'))
const output = path.join(scratch, 'exports')
const animationHome = path.join(scratch, 'animations')
await fs.mkdir(output)
const client = new Client({ name: 'package-test', version: '1' })
let desktop
try {
  // Exercise the installed agent launcher before starting the desktop.
  await client.connect(new StdioClientTransport({ command: executable,
    args: [path.join(path.dirname(executable), 'resources/tools/pai-mcp.mjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PAI_ANIMATION_HOME: animationHome } }))
  const opts = { id: 'fire/torch', outputDir: output, seed: 4, palette: ['#0b173e','#155ca8','#35bce0','#aeffff','#ffffff'] }
  const reply = await client.callTool({ name: 'pixelfx_render', arguments: opts })
  assert.ok(!reply.isError, reply.content?.[0]?.text)
  const headless = reply.structuredContent
  assert.equal(headless.frames, 60)
  const tool = async (name, args) => {
    const reply = await client.callTool({ name: 'animation_' + name, arguments: args })
    if (reply.isError) throw Error(reply.content[0].text)
    return reply.structuredContent
  }
  const standalone = await tool('create', { id: 'custom/agent', name: 'Agent 动画' })
  assert.equal((await tool('render', { id: standalone.id, outputDir: output })).frames, 36)
  // A tool installation with just the animation module works without the optional PixelFX source tree.
  const minimalDir = path.join(scratch, 'standalone-tools')
  await fs.mkdir(minimalDir)
  for (const file of ['pai-mcp.mjs', 'animation-service.mjs', 'animation-worker.mjs']) {
    await fs.copyFile(path.join(path.dirname(executable), 'resources/tools', file), path.join(minimalDir, file))
  }
  const minimal = new Client({ name: 'minimal-animation-test', version: '1' })
  try {
    await minimal.connect(new StdioClientTransport({ command: executable, args: [path.join(minimalDir, 'pai-mcp.mjs')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PAI_ANIMATION_HOME: path.join(scratch, 'minimal-library') } }))
    assert.equal((await minimal.callTool({ name: 'animation_list', arguments: {} })).structuredContent.total, 0)
    const created = await minimal.callTool({ name: 'animation_create', arguments: { id: 'local/dot', name: 'Standalone' } })
    assert.ok(!created.isError, created.content[0].text)
    const rendered = await minimal.callTool({ name: 'animation_render', arguments: { id: 'local/dot', outputDir: output } })
    assert.equal(rendered.structuredContent.frames, 36)
  } finally { await minimal.close() }

  desktop = await _electron.launch({ executablePath: executable,
    args: ['--user-data-dir=' + path.join(scratch, 'profile'), '--headless'],
    env: { ...process.env, USERPROFILE: scratch, PAI_ANIMATION_HOME: animationHome } })
  await desktop.evaluate(({ dialog }, output) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [output] })
    globalThis.fetch = async () => new Response(JSON.stringify({ version: '0.0.1' }))
  }, output)
  const page = await desktop.firstWindow()
  await page.setViewportSize({ width: 1220, height: 800 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route(/^https?:\/\//, route => route.abort())
  await checkMaker(page)
  await checkEditing(page, tool, standalone)
  if (process.env.PAI_ANIMATION_SCREENSHOT) await page.screenshot({ path: process.env.PAI_ANIMATION_SCREENSHOT })
  assert.deepEqual(errors, [])
  console.log('Packaged independent MCP, effect maker, file reload and GUI export passed.')
} finally {
  await desktop?.close()
  await client.close()
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 })
}

