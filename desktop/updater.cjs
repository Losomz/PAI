const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { gt, valid } = require('semver')
const { once } = require('node:events')
const { pubkey, endpoints } = require('./update-source.json')

let pending
let installing = false
async function check(currentVersion) {
  const response = await fetch(endpoints[0], { signal: AbortSignal.timeout(15000), cache: 'no-store' })
  if (!response.ok) throw Error('更新源返回 HTTP ' + response.status)
  const manifest = await response.json()
  if (!valid(manifest.version)) throw Error('更新版本号无效')
  if (!gt(manifest.version, currentVersion)) { pending = null; return null }
  const artifact = manifest.platforms?.['windows-x86_64-nsis']
  if (process.platform !== 'win32' || process.arch !== 'x64') return null
  const url = new URL(artifact?.url)
  if (url.origin !== 'https://github.com' ||
      !url.pathname.startsWith('/Losomz/PAI/releases/download/v' + manifest.version + '/') ||
      !url.pathname.endsWith('.exe') || !artifact.signature) throw Error('无效的更新包')
  pending = { url: url.href, signature: artifact.signature }
  return { currentVersion, version: manifest.version }
}
// Tauri signer emits minisign packets, wrapped in base64 for latest.json.
function verifySignature(data, publicText, signatureText) {
  const packet = value => Buffer.from(Buffer.from(value, 'base64').toString('utf8').split(/\r?\n/)[1] || '', 'base64')
  const key = packet(publicText), sig = packet(signatureText)
  if (key.length !== 42 || sig.length !== 74 || !key.subarray(2, 10).equals(sig.subarray(2, 10))) return false
  const alg = sig.toString('ascii', 0, 2)
  if (alg !== 'Ed' && alg !== 'ED') return false
  const message = alg === 'ED' ? crypto.createHash('blake2b512').update(data).digest() : data
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)])
  return crypto.verify(null, message, { key: der, format: 'der', type: 'spki' }, sig.subarray(10))
}
async function install(onProgress) {
  if (!pending || installing) throw Error('请先检查更新')
  const artifact = pending
  installing = true
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pai-update-')).catch(error => { installing = false; throw error })
  const file = path.join(tmp, 'PAI-Setup.exe')
  let started = false
  try {
    const res = await fetch(artifact.url, { signal: AbortSignal.timeout(10 * 60 * 1000) })
    if (!res.ok || !res.body) throw Error('下载安装包失败')
    const handle = await fs.open(file, 'wx')
    try {
      const total = Number(res.headers.get('content-length'))
      let size = 0, previous = -1
      for await (const chunk of res.body) {
        await handle.writeFile(chunk)
        size += chunk.length
        const percent = total ? Math.min(99, Math.round(size * 100 / total)) : 0
        if (percent !== previous) { onProgress(percent); previous = percent }
      }
    } finally { await handle.close() }
    if (!verifySignature(await fs.readFile(file), pubkey, artifact.signature)) throw Error('更新包签名验证失败')
    const child = spawn(file, [], { detached: true, stdio: 'ignore' })
    await once(child, 'spawn')
    child.unref()
    started = true
    onProgress(100)
  } finally {
    installing = false
    if (!started) await fs.rm(tmp, { recursive: true, force: true })
  }
}
module.exports = { check, install, verifySignature }

