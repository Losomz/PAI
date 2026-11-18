const { app, clipboard, shell } = require('electron')
const { watch } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

function registerAnimations(handle, getWindow, chooseDirectory) {
  const toolsDir = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, '../tools')
  const service = () => import(pathToFileURL(path.join(toolsDir, 'animation-service.mjs')).href)
  let watcher, timer, preview
  function watchLibrary(root) {
    if (watcher) return
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (filename?.split(/[\\/]/).some(part => part.startsWith('.'))) return
      clearTimeout(timer)
      timer = setTimeout(() => getWindow()?.webContents.send('animations:changed'), 180)
    })
    watcher.on('error', () => { watcher?.close(); watcher = null })
  }
  handle('animations:list', async () => {
    const data = (await service()).listAnimations()
    watchLibrary(data.root)
    return data
  })
  handle('animations:read', async id => (await service()).readAnimation(id))
  handle('animations:create', async args => (await service()).createAnimation(args))
  handle('animations:delete', async (id, revision) => (await service()).removeAnimation(id, revision))
  handle('animations:preview', async (id, revision) => {
    preview?.abort()
    const controller = new AbortController()
    preview = controller
    try { return await (await service()).previewAnimation(id, revision, controller.signal) }
    finally { if (preview === controller) preview = null }
  })
  handle('animations:cancel', () => { preview?.abort() })
  handle('animations:export', async (id, revision) => {
    const output = await chooseDirectory('导出动画精灵图')
    return output ? (await service()).exportAnimation(id, output, revision) : null
  })
  handle('animations:reveal', async id => { shell.showItemInFolder((await service()).readAnimation(id).codePath) })
  handle('animations:copy-path', async id => { clipboard.writeText((await service()).readAnimation(id).codePath) })
  app.on('will-quit', () => { watcher?.close(); clearTimeout(timer); preview?.abort() })
}

module.exports = { registerAnimations }
