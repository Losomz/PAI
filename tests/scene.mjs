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
function portalPixels(image, previous) {
  let count = 0
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2]
    if (b > g + 30 && r > g + 13 && b > r + 10 && (!previous || Math.abs(b - previous.data[i + 2]) > 15)) count++
  }
  return count
}

export async function checkScene(page) {
  await page.getByRole('link', { name: /打开 3D 场景/ }).click()
  const viewport = page.getByRole('region', { name: '交互式 3D 场景' })
  await viewport.locator(':scope > canvas, :scope > svg').waitFor()
  const volume = page.getByRole('button', { name: '立体 3D' })
  const flat = page.getByRole('button', { name: '原版 2D' })
  assert.equal(await volume.getAttribute('aria-pressed'), 'true')
  const frame = async () => {
    await viewport.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
    return pngjs.PNG.sync.read(await viewport.screenshot())
  }
  const deadline = Date.now() + 8000
  let initial = await frame()
  while (portalPixels(initial) < 500 && Date.now() < deadline) initial = await frame()
  assert.ok(portalPixels(initial) > 500, 'the 3D portal is visible in the scene')
  let playing = await frame()
  while (portalPixels(playing, initial) < 80 && Date.now() < deadline) playing = await frame()
  assert.ok(portalPixels(playing, initial) > 80, 'the portal animates with the camera still')
  await page.getByRole('button', { name: '暂停传送门' }).click()
  const home = await frame()
  assert.equal(portalPixels(await frame(), home), 0, 'pause holds the portal frame')
  if (process.env.PAI_SCENE_SCREENSHOT) await page.screenshot({ path: process.env.PAI_SCENE_SCREENSHOT })
  const { x, y, width, height } = await viewport.boundingBox()
  const cx = x + width / 2, cy = y + height / 2
  const drag = async (button, dx, dy) => {
    await page.mouse.move(cx, cy)
    await page.mouse.down({ button })
    await page.mouse.move(cx + dx, cy + dy, { steps: 5 })
    await page.mouse.up({ button })
  }
  await drag('left', 110, 22)
  const orbited = await frame()
  assert.ok(changedFraction(home, orbited) > 0.02, 'orbit changes the rendered view')
  await drag('right', -50, -25)
  const panned = await frame()
  assert.ok(changedFraction(orbited, panned) > 0.01, 'right drag pans the view')
  await page.mouse.wheel(0, -200)
  assert.ok(changedFraction(panned, await frame()) > 0.01, 'wheel zooms')
  await page.getByRole('button', { name: '自由漫游' }).click()
  const beforeFly = await frame()
  await page.keyboard.down('w')
  await new Promise(done => setTimeout(done, 300))
  await page.keyboard.up('w')
  const flown = await frame()
  assert.ok(changedFraction(beforeFly, flown) > 0.01, 'fly camera moves using WASD')
  await drag('left', -75, 12)
  assert.ok(changedFraction(flown, await frame()) > 0.02, 'fly camera turns in place')
  await page.getByRole('button', { name: '俯视', exact: true }).click()
  const top = await frame()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  const front = await frame()
  assert.ok(changedFraction(top, front) > 0.05)
  await page.getByRole('button', { name: '背面', exact: true }).click()
  const back = await frame()
  assert.ok(portalPixels(back) > 500 && changedFraction(front, back) > 0.05, 'the back of the 3D portal is visible')
  const sideView = page.getByRole('button', { name: '侧面', exact: true })
  await sideView.click()
  const side = await frame()
  assert.ok(portalPixels(side) > 1500, 'an edge-on view shows the walls of the 3D tunnel')
  await flat.click()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  const loadDeadline = Date.now() + 6000
  let original = await frame()
  while (portalPixels(original) < 500 && Date.now() < loadDeadline) original = await frame()
  assert.ok(portalPixels(original) > 500 && portalPixels(original, front) > 100, 'the original sprite is available for comparison')
  await sideView.click()
  assert.ok(portalPixels(await frame()) < portalPixels(side) * 0.08, 'the flat original disappears edge-on at the same position')
  await volume.click()
  assert.ok(changedFraction(side, await frame()) < 0.01, 'switching versions retains camera and paused time')
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.getByRole('slider', { name: '相机视野' }).press('End')
  assert.ok(changedFraction(front, await frame()) > 0.02, 'lens angle changes the view')
  const grid = page.getByRole('button', { name: '网格', exact: true })
  await grid.click()
  assert.equal(await grid.getAttribute('aria-pressed'), 'false')
  await grid.click()
  await page.getByRole('button', { name: '环绕', exact: true }).click()
  await page.getByRole('button', { name: '重置视角' }).click()
  assert.ok(changedFraction(home, await frame()) < 0.01, 'reset recovers the original perspective')
  await page.getByRole('button', { name: '播放传送门' }).click()
  const resumeDeadline = Date.now() + 4000
  let resumed = await frame()
  while (portalPixels(resumed, home) < 80 && Date.now() < resumeDeadline) resumed = await frame()
  assert.ok(portalPixels(resumed, home) > 80, 'the portal resumes from pause')
  await flat.click()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  const flatDeadline = Date.now() + 6000
  let flatStart = await frame()
  while (portalPixels(flatStart) < 500 && Date.now() < flatDeadline) flatStart = await frame()
  let flatPlaying = await frame()
  while (portalPixels(flatPlaying, flatStart) < 80 && Date.now() < flatDeadline) flatPlaying = await frame()
  assert.ok(portalPixels(flatStart) > 500 && portalPixels(flatPlaying, flatStart) > 80, 'the original still plays after switching')
  await page.locator('.arco-menu-item').filter({ hasText: '首页' }).click()
}
