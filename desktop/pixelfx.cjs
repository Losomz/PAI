const { app, protocol, Menu, shell } = require('electron')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const origin = 'pixelfx://gallery'
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' }
const fontPath = '/gallery/fonts/PatchPixel-Regular.woff2'

function serveGallery() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'tools/pixelfx/upstream')
    : path.join(__dirname, '../tools/pixelfx/upstream')
  protocol.handle('pixelfx', async request => {
    const url = new URL(request.url)
    const file = url.pathname
    if (request.method !== 'GET' || url.host !== 'gallery' ||
        !(file === '/gallery/index.html' || file === '/gallery/style.css' || file === '/gallery/app.js' ||
          file === fontPath || /^\/src\/(?:[\w-]+\/)*[\w-]+\.js$/.test(file))) {
      return new Response(null, { status: 404 })
    }
    if (app.isPackaged && file === fontPath) {
      return Response.redirect('https://patch-gg.github.io/pixelfx/fonts/PatchPixel-Regular.woff2')
    }
    try {
      const body = await readFile(path.join(root, file))
      return new Response(body, { headers: { 'Content-Type': mime[path.extname(file)] } })
    } catch (error) {
      if (error.code === 'ENOENT') return new Response(null, { status: 404 })
      throw error
    }
  })
}

function enableGalleryActions(window) {
  const contents = window.webContents
  contents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url)
    if (target.origin === 'https://patch.gg' ||
        (target.origin === 'https://github.com' && /^\/patch-gg\/pixelfx(?:\/|$)/.test(target.pathname))) {
      void shell.openExternal(target.href).catch(console.error)
    }
    return { action: 'deny' }
  })
  contents.on('context-menu', (_event, params) => {
    if (params.frameURL?.startsWith(origin + '/') && params.mediaType === 'image' && params.srcURL.startsWith('data:image/png;base64,')) {
      Menu.buildFromTemplate([{ label: '图片另存为…', click: () => contents.downloadURL(params.srcURL) }]).popup({ window })
    }
  })
}

module.exports = { serveGallery, enableGalleryActions, origin }
