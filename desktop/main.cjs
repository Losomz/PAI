const { app, BrowserWindow, ipcMain, dialog, session, protocol } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const gallery = require('./pixelfx.cjs')
const { registerAnimations } = require('./animations.cjs')
const sync = require('./sync.cjs')
const updater = require('./updater.cjs')

const entry = pathToFileURL(path.join(__dirname, '../frontend/dist/index.html')).href
const dev = !app.isPackaged && process.env.PAI_DEV === '1'
const startUrl = dev ? 'http://127.0.0.1:5173/' : entry
protocol.registerSchemesAsPrivileged([{ scheme: 'pixelfx', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
let window
function createWindow() {
  window = new BrowserWindow({ width: 1220, height: 820, minWidth: 760, minHeight: 550,
    title: 'PAI · 个人工具箱', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  gallery.enableGalleryActions(window)
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== startUrl) event.preventDefault() })
  window.on('closed', () => { window = null })
  return window.loadURL(startUrl)
}
function handle(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url.split('#')[0] !== startUrl) throw Error('不允许此页面调用桌面功能')
    return fn(...args)
  })
}
async function directory(title) {
  const result = await dialog.showOpenDialog(window, { title, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
  app.whenReady().then(() => {
    gallery.serveGallery()
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(wc === window?.webContents && permission === 'clipboard-sanitized-write' && details.requestingUrl.startsWith(gallery.origin + '/'))
    })
    handle('pai:version', () => app.getVersion())
    handle('pai:directory', directory)
    registerAnimations(handle, () => window, directory)
    handle('sync:list', sync.readRecords)
    handle('sync:save', sync.saveRecord)
    handle('sync:delete', sync.deleteRecord)
    handle('sync:run', sync.syncDirect)
    handle('update:check', () => app.isPackaged ? updater.check(app.getVersion()) : null)
    handle('update:install', async () => {
      await updater.install(percent => window?.webContents.send('update:progress', percent))
      app.quit()
    })
    return createWindow()
  }).catch(err => { console.error(err); app.exit(1) })
  app.on('activate', () => { if (!window) createWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

