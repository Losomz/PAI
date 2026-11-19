import assert from 'node:assert/strict'
import pngjs from 'pngjs'

// Compare the interior of the viewport, ignoring focus rings and toolbar state.
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

// The studio geometry has no violet in it. Count the portal itself, including when the camera moves.
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

export async function checkScene(page) {
  await page.getByRole('link', { name: /打开 3D 场景/ }).click()
  const viewport = page.getByRole('region', { name: '交互式 3D 场景' })
  await viewport.locator(':scope > canvas, :scope > svg').waitFor()
  const webgl = await viewport.locator(':scope > canvas').count() > 0
  const button = name => page.getByRole('button', { name, exact: true })
  const volume = button('立体版'), flat = button('原版')
  const frame = async () => {
    await viewport.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
    return pngjs.PNG.sync.read(await viewport.screenshot())
  }
  // The scene opens on the original portal in 2D, rendered by the library when there is one.
  assert.equal(await button('2D 视图').getAttribute('aria-pressed'), 'true')
  assert.equal(await flat.getAttribute('aria-pressed'), 'true')
  const deadline = Date.now() + 20000
  let initial = await frame()
  while (portalPixels(initial) < 500 && Date.now() < deadline) initial = await frame()
  assert.ok(portalPixels(initial) > 500, 'the original portal is visible in 2D')
  let playing = await frame()
  while (portalPixels(playing, initial) < 80 && Date.now() < deadline) playing = await frame()
  assert.ok(portalPixels(playing, initial) > 80, 'the original plays')
  await button('暂停特效').click()
  const flatHome = await frame()
  assert.equal(portalPixels(await frame(), flatHome), 0, 'pause holds the frame')
  const zoomText = page.locator('output[aria-label="缩放倍数"]')
  const zoom = Number.parseInt(await zoomText.textContent(), 10)
  assert.ok(zoom >= 2, 'the original is fitted at a whole zoom')
  if (webgl) assert.equal(blockPhases(flatHome, zoom).size, 1, 'each source pixel is a whole block of screen pixels')
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
  assert.ok(changedFraction(flatHome, await frame()) > 0.02, 'the wheel zooms in 2D')
  assert.notEqual(await zoomText.textContent(), zoom + '×')
  await drag('left', 90, 40)
  assert.ok(changedFraction(flatHome, await frame()) > 0.02, 'dragging pans in 2D')
  await button('重置视角').click()
  assert.ok(changedFraction(flatHome, await frame()) < 0.01, 'reset fits the original again')

  // 3D shows the portal's 3D version, at the paused time.
  await button('3D 视图').click()
  assert.equal(await volume.getAttribute('aria-pressed'), 'true', 'the 3D view opens the 3D version')
  let home = await frame()
  const volumeDeadline = Date.now() + 8000
  while (portalPixels(home) < 500 && Date.now() < volumeDeadline) home = await frame()
  assert.ok(portalPixels(home) > 500, 'the 3D portal is visible in the scene')
  assert.ok(changedFraction(flatHome, home) > 0.02, 'the 3D view looks at it differently')
  await button('播放特效').click()
  let moving = await frame()
  while (portalPixels(moving, home) < 80 && Date.now() < volumeDeadline) moving = await frame()
  assert.ok(portalPixels(moving, home) > 80, 'the portal animates with the camera still')
  await button('暂停特效').click()
  home = await frame()
  assert.equal(portalPixels(await frame(), home), 0, 'pause holds the portal frame')
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
  await button('背面').click()
  const back = await frame()
  assert.ok(portalPixels(back) > 500 && changedFraction(front, back) > 0.05, 'the back of the 3D portal is visible')
  await button('侧面').click()
  const side = await frame()
  assert.ok(portalPixels(side) > 1500, 'an edge-on view shows the walls of the 3D tunnel')
  await flat.click()
  await button('正面').click()
  const loadDeadline = Date.now() + 6000
  let original = await frame()
  while (portalPixels(original) < 500 && Date.now() < loadDeadline) original = await frame()
  assert.ok(portalPixels(original) > 500 && portalPixels(original, front) > 100, 'the original stands in the scene for comparison')
  await button('侧面').click()
  assert.ok(portalPixels(await frame()) < portalPixels(side) * 0.08, 'the flat original disappears edge-on at the same position')
  await volume.click()
  assert.ok(changedFraction(side, await frame()) < 0.01, 'switching versions retains camera and paused time')
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
  await button('环绕').click()
  await button('重置视角').click()
  assert.ok(changedFraction(home, await frame()) < 0.01, 'reset recovers the original perspective')
  await button('2D 视图').click()
  assert.equal(await flat.getAttribute('aria-pressed'), 'true', 'the 2D view goes back to the original')
  if (webgl) assert.equal(blockPhases(await frame(), zoom).size, 1, 'and is pixel exact again')
  await button('播放特效').click()
  const resumeDeadline = Date.now() + 4000
  let resumed = await frame()
  while (portalPixels(resumed, flatHome) < 80 && Date.now() < resumeDeadline) resumed = await frame()
  assert.ok(portalPixels(resumed, flatHome) > 80, 'the original resumes from pause')
  await checkEffects(page, frame)
  await page.locator('.arco-menu-item').filter({ hasText: '首页' }).click()
}

// Other effects replace the portal on the same spot: the ones with 3D versions in both views, and (with the desktop
// library) one without, which 2D shows as it is. Waits for a frame that differs, since effects redraw on their own
// frame steps and library ones are rendered first.
async function checkEffects(page, frame) {
  const button = name => page.getByRole('button', { name, exact: true })
  const until = async (previous, fraction, ms) => {
    const deadline = Date.now() + ms
    let next = await frame()
    while (changedFraction(previous, next) <= fraction && Date.now() < deadline) next = await frame()
    return next
  }
  const option = id => page.getByRole('option', { name: new RegExp(id.replace(/[/-]/g, '\\$&') + '\\s*(立体)?\\s*$') })
  async function pick(id) {
    await button('选择特效').click()
    await page.getByRole('searchbox', { name: '搜索特效' }).fill(id)
    const found = await option(id).count() > 0
    if (!found) {
      await page.keyboard.press('Escape')
      return false
    }
    await option(id).click()
    // Library animations are rendered before they replace what is shown.
    await page.locator(`[data-effect="${id}"]`).waitFor({ timeout: 30000 })
    return true
  }
  await button('3D 视图').click()
  await button('正面').click()
  const portal = await frame()
  for (const id of ['scifi/hologram', 'arcane/arcane-orb']) {
    assert.ok(await pick(id), `${id} can be picked`)
    const shown = await until(portal, 0.02, 15000)
    assert.ok(changedFraction(portal, shown) > 0.02, `${id} replaces the portal`)
    assert.equal(await button('立体版').getAttribute('aria-pressed'), 'true', `${id} opens as its 3D version in 3D`)
    assert.ok(changedFraction(shown, await until(shown, 0.002, 3000)) > 0.002, `${id} animates in 3D`)
    await button('原版').click()
    const original = await until(shown, 0.01, 6000)
    assert.ok(changedFraction(shown, original) > 0.01, `${id} has its original for comparison`)
    await button('立体版').click()
  }
  const dark = await frame()
  assert.equal(await button('暗场').getAttribute('aria-pressed'), 'true', 'the dark studio is the default')
  await button('暗场').click()
  assert.equal(await button('暗场').getAttribute('aria-pressed'), 'false')
  assert.ok(changedFraction(dark, await frame()) > 0.3, 'the light studio replaces the dark one')
  await button('暗场').click()
  if (await pick('fire/torch')) {
    const torch = await until(dark, 0.02, 15000)
    assert.ok(changedFraction(dark, torch) > 0.02, 'an effect without a 3D version still shows')
    assert.ok(await button('立体版').isDisabled(), 'and offers no 3D version')
    assert.equal(await button('原版').getAttribute('aria-pressed'), 'true')
    await button('2D 视图').click()
    assert.ok(changedFraction(torch, await until(torch, 0.02, 3000)) > 0.02, 'it plays in 2D')
    await button('3D 视图').click()
  }
  assert.ok(await pick('arcane/portal'))
  assert.ok(portalPixels(await until(dark, 0.02, 15000)) > 500, 'switching back restores the portal')
}
