import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import pngjs from 'pngjs'

// Compare the interior of the viewport, ignoring focus rings and the hint in its corner.
function changedFraction(first, second) {
  let different = 0, total = 0
  for (let y = 30; y < first.height - 30; y += 3) {
    for (let x = 30; x < first.width - 30; x += 3) {
      const i = 4 * (y * first.width + x)
      const rgb = Math.abs(first.data[i] - second.data[i]) + Math.abs(first.data[i + 1] - second.data[i + 1]) +
        Math.abs(first.data[i + 2] - second.data[i + 2])
      if (rgb > 14) different++
      total++
    }
  }
  return different / total
}

// The studio has no violet in it. Count the portal itself, including when the camera moves.
const violet = (data, i) => data[i + 2] > data[i + 1] + 30 && data[i] > data[i + 1] + 13 && data[i + 2] > data[i] + 10
function portalPixels(image, previous) {
  let count = 0
  for (let i = 0; i < image.data.length; i += 4) {
    if (violet(image.data, i) && (!previous || Math.abs(image.data[i + 2] - previous.data[i + 2]) > 15)) count++
  }
  return count
}

// In 2D every source pixel is a zoom-by-zoom block, so along a row the colour only changes on one phase of the zoom.
function blockPhases(image, zoom) {
  const phases = new Set()
  const rows = []
  for (let y = 0; y < image.height; y++) {
    let lit = 0
    for (let x = 0; x < image.width; x++) if (violet(image.data, 4 * (y * image.width + x))) lit++
    if (lit > 40) rows.push(y)
  }
  // The upper half of the portal: the floor's edge-on line runs along its foot.
  for (const y of rows.slice(0, Math.floor(rows.length / 2)).filter((_, i) => i % 5 === 0)) {
    for (let x = 1; x < image.width; x++) {
      const i = 4 * (y * image.width + x)
      if (image.data[i] !== image.data[i - 4] || image.data[i + 1] !== image.data[i - 3] || image.data[i + 2] !== image.data[i - 2]) {
        phases.add(x % zoom)
      }
    }
  }
  return phases
}

const escape = text => text.replace(/[/\-.*+?^${}()|[\]\\]/g, '\\$&')
/** Find an effect in the list and wait until the stage shows it (it is rendered first). */
export async function choose(page, id, name = '') {
  await page.getByRole('searchbox', { name: '搜索特效' }).fill(id)
  await page.getByRole('button', { name: new RegExp(escape(name) + '.*' + escape(id) + '$') }).click()
  await page.locator(`[data-effect="${id}"]`).waitFor({ timeout: 30000 })
}

/** Watch an effect in the maker from both cameras. Needs the library's arcane/portal and fire/torch. */
export async function checkMaker(page) {
  await page.getByRole('link', { name: /打开特效制作器/ }).click()
  const viewport = page.getByRole('region', { name: '特效预览' })
  await viewport.locator(':scope > canvas, :scope > svg').waitFor()
  const webgl = await viewport.locator(':scope > canvas').count() > 0
  const button = name => page.getByRole('button', { name, exact: true })
  const frame = async () => {
    await viewport.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
    return pngjs.PNG.sync.read(await viewport.screenshot())
  }
  const until = async (test, ms, message) => {
    const deadline = Date.now() + ms
    let image = await frame()
    while (!test(image) && Date.now() < deadline) image = await frame()
    assert.ok(test(image), message)
    return image
  }
  await choose(page, 'arcane/portal')
  // The 2D camera looks straight at the effect and plays it.
  assert.equal(await button('2D 视图').getAttribute('aria-pressed'), 'true')
  const initial = await until(image => portalPixels(image) > 500, 20000, 'the portal is visible in 2D')
  await until(image => portalPixels(image, initial) > 80, 4000, 'it plays')
  await button('暂停').click()
  const flatHome = await frame()
  assert.equal(portalPixels(await frame(), flatHome), 0, 'pause holds the frame')
  const zoomText = page.locator('output[aria-label="缩放倍数"]')
  const zoom = Number.parseInt(await zoomText.textContent(), 10)
  assert.ok(zoom >= 2, 'the effect is fitted at a whole zoom')
  if (webgl) assert.equal(blockPhases(flatHome, zoom).size, 1, 'each source pixel is a whole block of screen pixels')

  // The transport steps through frames.
  const slider = page.getByRole('slider', { name: '预览帧' })
  const count = page.locator('.maker-count')
  const frames = Number((await count.textContent()).split('/')[1])
  assert.ok(frames > 1)
  await slider.press('End')
  await page.getByText(`${frames} / ${frames}`).waitFor()
  assert.ok(portalPixels(await frame(), flatHome) > 0, 'the last frame shows')
  await button('回到首帧').click()
  await page.getByText(`1 / ${frames}`).waitFor()
  const first = await frame()
  await slider.press('ArrowRight')
  await page.getByText(`2 / ${frames}`).waitFor()
  assert.ok(portalPixels(await frame(), first) > 0, 'stepping one frame changes the picture')
  assert.equal(await button('播放').count(), 1, 'stepping keeps it paused')
  await button('回到首帧').click()
  const held = await frame()

  const { x, y, width, height } = await viewport.boundingBox()
  const cx = x + width / 2, cy = y + height / 2
  const drag = async (mouseButton, dx, dy) => {
    await page.mouse.move(cx, cy)
    await page.mouse.down({ button: mouseButton })
    await page.mouse.move(cx + dx, cy + dy, { steps: 5 })
    await page.mouse.up({ button: mouseButton })
  }
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -120)
  assert.ok(changedFraction(held, await frame()) > 0.02, 'the wheel zooms in 2D')
  assert.notEqual(await zoomText.textContent(), zoom + '×')
  await drag('left', 90, 40)
  assert.ok(changedFraction(held, await frame()) > 0.02, 'dragging pans in 2D')
  await button('重置视角').click()
  assert.ok(changedFraction(held, await frame()) < 0.01, 'reset fits the effect again')

  // The 3D camera looks at the same card from an angle.
  await button('3D 视图').click()
  const home = await until(image => portalPixels(image) > 500, 4000, 'the portal stands in the 3D scene')
  assert.ok(changedFraction(held, home) > 0.02, 'the 3D view looks at it differently')
  assert.equal(portalPixels(await frame(), home), 0, 'switching cameras keeps the paused frame')
  await button('播放').click()
  await until(image => portalPixels(image, home) > 80, 4000, 'the portal animates in 3D')
  await button('回到首帧').click()
  assert.ok(changedFraction(home, await frame()) < 0.01, 'and holds its first frame again')
  if (process.env.PAI_SCENE_SCREENSHOT) await page.screenshot({ path: process.env.PAI_SCENE_SCREENSHOT })
  await drag('left', 110, 22)
  const orbited = await frame()
  assert.ok(changedFraction(home, orbited) > 0.02, 'orbit changes the rendered view')
  await drag('right', -50, -25)
  const panned = await frame()
  assert.ok(changedFraction(orbited, panned) > 0.01, 'right drag pans the view')
  await page.mouse.wheel(0, -200)
  assert.ok(changedFraction(panned, await frame()) > 0.01, 'wheel zooms')
  await button('自由漫游').click()
  const beforeFly = await frame()
  await page.keyboard.down('w')
  await new Promise(done => setTimeout(done, 300))
  await page.keyboard.up('w')
  const flown = await frame()
  assert.ok(changedFraction(beforeFly, flown) > 0.01, 'fly camera moves using WASD')
  await drag('left', -75, 12)
  assert.ok(changedFraction(flown, await frame()) > 0.02, 'fly camera turns in place')
  await button('俯视').click()
  const top = await frame()
  await button('正面').click()
  const front = await frame()
  assert.ok(changedFraction(top, front) > 0.05)
  assert.ok(portalPixels(front) > 500, 'the front view faces the card')
  await button('背面').click()
  assert.ok(portalPixels(await frame()) > 500, 'the card is seen from behind too')
  await button('侧面').click()
  assert.ok(portalPixels(await frame()) < portalPixels(front) * 0.08, 'edge on, the flat card all but disappears')
  await button('正面').click()
  await page.getByRole('slider', { name: '相机视野' }).press('End')
  assert.ok(changedFraction(front, await frame()) > 0.02, 'lens angle changes the view')
  const grid = button('网格')
  await grid.click()
  assert.equal(await grid.getAttribute('aria-pressed'), 'false')
  await grid.click()
  // Only WebGL draws a floor, so only it offers to hide one.
  const floor = button('地板')
  if (await floor.count()) {
    const floored = await frame()
    await floor.click()
    assert.equal(await floor.getAttribute('aria-pressed'), 'false')
    assert.ok(changedFraction(floored, await frame()) > 0.05, 'the floor can be hidden')
    await floor.click()
  }
  const dark = await frame()
  assert.equal(await button('暗场').getAttribute('aria-pressed'), 'true', 'the dark studio is the default')
  await button('暗场').click()
  assert.ok(changedFraction(dark, await frame()) > 0.3, 'the light studio replaces the dark one')
  await button('暗场').click()
  await button('环绕').click()
  await button('重置视角').click()
  assert.ok(changedFraction(home, await frame()) < 0.01, 'reset recovers the original perspective')
  await button('2D 视图').click()
  if (webgl) assert.equal(blockPhases(await frame(), zoom).size, 1, 'back in 2D it is pixel exact again')

  // Another effect takes the portal's place and starts playing; the source code is a tab away.
  const portal = await frame()
  await choose(page, 'fire/torch')
  const torch = await until(image => changedFraction(portal, image) > 0.02, 15000, 'the torch replaces the portal')
  await until(image => changedFraction(torch, image) > 0.002, 4000, 'and plays')
  await page.getByRole('tab', { name: '源代码' }).click()
  await page.getByLabel('特效源代码').waitFor()
  assert.ok(!(await viewport.isVisible()), 'the code takes the stage')
  await page.getByRole('tab', { name: '预览' }).click()
  await until(image => changedFraction(portal, image) > 0.02, 4000, 'the stage comes back')
  await choose(page, 'arcane/portal')
  await until(image => portalPixels(image) > 500, 15000, 'switching back restores the portal')
  await page.getByRole('searchbox', { name: '搜索特效' }).fill('')
  await page.locator('.arco-menu-item').filter({ hasText: '首页' }).click()
}

/**
 * Edit an effect's source from outside, as an agent would, and use the maker's own actions. `tool` calls the
 * agent's animation_* tools; `standalone` is an effect the agent made before the window opened.
 */
export async function checkEditing(page, tool, standalone) {
  await page.getByRole('link', { name: /打开特效制作器/ }).click()
  await choose(page, standalone.id, standalone.name)
  const updatedCode = standalone.code.replace('fps: 24', 'fps: 12')
  await tool('update', { id: standalone.id, revision: standalone.revision, code: updatedCode })
  await page.getByText(/12 FPS/).waitFor()
  await fs.writeFile(standalone.codePath, 'invalid source ???')
  await page.locator('.maker-problem').waitFor()
  await page.getByRole('tab', { name: '源代码' }).click()
  await page.getByText('invalid source ???', { exact: true }).waitFor()
  await fs.writeFile(standalone.codePath, updatedCode.replace('fps: 12', 'fps: 8'))
  await page.locator('.maker-code').filter({ hasText: 'fps: 8' }).waitFor()
  await page.getByRole('tab', { name: '预览' }).click()
  await page.getByText(/8 FPS/).waitFor()
  await page.locator('.maker-problem').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '导出精灵图' }).click()
  await page.getByRole('status').filter({ hasText: '已导出到' }).waitFor()
  await page.getByRole('button', { name: '新建特效' }).click()
  await page.getByLabel('特效名称').fill('UI 创建')
  await page.getByLabel('特效 ID', { exact: true }).fill('custom/from-ui')
  await page.getByRole('button', { name: '创建特效' }).click()
  await page.locator('[data-effect="custom/from-ui"]').waitFor({ timeout: 30000 })
  assert.equal((await tool('read', { id: 'custom/from-ui' })).name, 'UI 创建')
  await page.getByRole('button', { name: '移除 UI 创建' }).click()
  await page.getByRole('button', { name: '移除特效', exact: true }).click()
  await page.getByText('已移除 UI 创建').waitFor()
  assert.equal((await tool('list', { query: 'custom/from-ui' })).total, 0)
  await page.getByRole('button', { name: '从素材添加' }).click()
  await page.getByLabel('搜索素材').fill('fire/flamethrower')
  await page.getByLabel('特效 ID', { exact: true }).fill('custom/flame')
  await page.getByRole('button', { name: '添加特效' }).click()
  await page.locator('[data-effect="custom/flame"]').waitFor({ timeout: 30000 })
  assert.equal((await tool('read', { id: 'custom/flame' })).template, 'fire/flamethrower')
}
