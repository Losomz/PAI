// Run against an unpacked Windows release, including its MCP companion and ASAR renderer.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _electron } from 'playwright-core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

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
  await page.getByRole('link', { name: /PixelFX/ }).click()
  const gallery = page.frameLocator('iframe[title="PixelFX 官方画廊"]')
  const search = gallery.getByRole('searchbox', { name: 'Search effects' })
  await gallery.locator('.tile').first().waitFor()
  assert.equal(await gallery.locator('.tile').count(), 244)
  assert.equal(await search.evaluate(() => typeof window.pai), 'undefined')
  await gallery.locator('[data-cat="fire"]').click()
  await search.fill('flamethrower')
  assert.equal(await gallery.locator('.tile:not([hidden])').count(), 1)
  await gallery.getByRole('figure', { name: /Flamethrower loop/ }).click()
  assert.equal(await gallery.locator('#d-id').innerText(), 'fire/flamethrower')
  const player = gallery.locator('#d-play')
  await player.click()
  assert.equal(await player.innerText(), 'play')
  const canvas = gallery.locator('#big')
  const paused = await canvas.evaluate(c => c.toDataURL())
  await canvas.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  assert.equal(await canvas.evaluate(c => c.toDataURL()), paused)
  await player.click()
  await canvas.evaluate((c, before) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Animation did not resume')), 4000)
    function check() {
      if (c.toDataURL() === before) return requestAnimationFrame(check)
      clearTimeout(timer)
      resolve()
    }
    requestAnimationFrame(check)
  }), paused)
  await gallery.locator('#d-make').click()
  const sheet = gallery.getByRole('img', { name: /flamethrower sprite sheet/i })
  assert.ok(await sheet.evaluate(img => img.src.startsWith('data:image/png;base64,')))
  assert.match(await gallery.locator('#d-sheet').innerText(), /48 frames/)
  if (process.env.PAI_SCREENSHOT) await page.screenshot({ path: process.env.PAI_SCREENSHOT })
  await gallery.locator('#d-close').click()
  await search.fill('no-such-effect')
  await gallery.getByText(/Nothing matches/).waitFor()

  await page.locator('.arco-menu-item').filter({ hasText: '动画库' }).click()
  await page.getByRole('heading', { name: 'Torch', exact: true }).waitFor()
  await page.getByLabel('Torch 动画预览').waitFor()
  const librarySearch = page.getByRole('searchbox', { name: '搜索动画' })
  await librarySearch.fill(standalone.id)
  await page.getByRole('button', { name: /Agent 动画 custom\/agent/ }).click()
  await page.getByLabel('Agent 动画 动画预览').waitFor()
  const updatedCode = standalone.code.replace('fps: 24', 'fps: 12')
  await tool('update', { id: standalone.id, revision: standalone.revision, code: updatedCode })
  await page.getByText(/12 FPS/).waitFor()
  await fs.writeFile(standalone.codePath, 'invalid source ???')
  await page.locator('.anim-stage [role=alert]').waitFor()
  await page.getByRole('tab', { name: '源代码' }).click()
  await page.getByText('invalid source ???', { exact: true }).waitFor()
  await fs.writeFile(standalone.codePath, updatedCode.replace('fps: 12', 'fps: 8'))
  await page.locator('.anim-code').filter({ hasText: 'fps: 8' }).waitFor()
  await page.getByRole('tab', { name: '动画预览' }).click()
  await page.getByText(/8 FPS/).waitFor()
  await page.getByRole('button', { name: '导出精灵图' }).click()
  await page.getByRole('status').filter({ hasText: '已导出到' }).waitFor()
  await page.getByRole('button', { name: '新建动画' }).click()
  await page.getByLabel('动画名称').fill('UI 创建')
  await page.getByLabel('动画 ID', { exact: true }).fill('custom/from-ui')
  await page.getByRole('button', { name: '创建动画' }).click()
  await page.getByLabel('UI 创建 动画预览').waitFor()
  assert.equal((await tool('read', { id: 'custom/from-ui' })).name, 'UI 创建')
  await page.getByRole('button', { name: '移除 UI 创建' }).click()
  await page.getByRole('button', { name: '移除动画', exact: true }).click()
  await page.getByText('已移除 UI 创建').waitFor()
  assert.equal((await tool('list', { query: 'custom/from-ui' })).total, 0)
  await page.getByRole('button', { name: '从素材添加' }).click()
  await page.getByLabel('搜索素材').fill('fire/flamethrower')
  await page.getByLabel('动画 ID', { exact: true }).fill('custom/flame')
  await page.getByRole('button', { name: '添加到动画库' }).click()
  await page.getByLabel('Flamethrower 动画预览').waitFor()
  assert.ok(await page.getByLabel('Flamethrower 动画预览').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect(), stage = canvas.parentElement.getBoundingClientRect()
    return rect.top >= stage.top && rect.bottom <= stage.bottom && rect.left >= stage.left && rect.right <= stage.right
  }))
  assert.equal((await tool('read', { id: 'custom/flame' })).template, 'fire/flamethrower')
  if (process.env.PAI_ANIMATION_SCREENSHOT) await page.screenshot({ path: process.env.PAI_ANIMATION_SCREENSHOT })
  assert.deepEqual(errors, [])
  console.log('Packaged offline gallery, independent MCP, editable animation library, file reload and GUI export passed.')
} finally {
  await desktop?.close()
  await client.close()
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 })
}

