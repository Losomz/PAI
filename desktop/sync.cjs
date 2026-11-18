const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID, createHash } = require('node:crypto')
const run = promisify(execFile)
const state = path.join(os.homedir(), '.agentframework')
const recordsFile = path.join(state, 'sync_records.json')

async function readRecords() {
  let raw
  try { raw = await fs.readFile(recordsFile, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  return raw.trim() ? JSON.parse(raw) : []
}
function serial() {
  let tail = Promise.resolve()
  return fn => {
    const result = tail.then(fn)
    tail = result.catch(() => {})
    return result
  }
}
const recordQueue = serial()
const syncQueue = serial()
async function mutateRecords(change) {
  return recordQueue(async () => {
    const records = await readRecords()
    const result = change(records)
    await fs.mkdir(state, { recursive: true })
    const tmp = recordsFile + '.' + randomUUID()
    try {
      await fs.writeFile(tmp, JSON.stringify(records, null, 2))
      await fs.rename(tmp, recordsFile)
    } finally { await fs.rm(tmp, { force: true }) }
    return result
  })
}
function saveRecord({ id, name, fromPath, toPath, refName }) {
  return mutateRecords(records => {
    if (![name, fromPath, toPath].every(s => typeof s === 'string' && s.trim())) throw Error('名称和路径不能为空')
    const row = id ? records.find(r => r.id === id) : {
      id: randomUUID(), created_at: String(Math.floor(Date.now() / 1000)), sync_mode: 'full' }
    if (!row) throw Error('记录不存在')
    Object.assign(row, { name, from_path: fromPath, to_path: toPath, ref_name: refName || null })
    if (!id) records.push(row)
    return row
  })
}
function deleteRecord(id) {
  return mutateRecords(records => {
    const index = records.findIndex(r => r.id === id)
    if (index < 0) throw Error('记录不存在')
    records.splice(index, 1)
  })
}
async function statIfExists(p) {
  try { return await fs.lstat(p) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
function inside(parent, child) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}
async function canonical(p) {
  if (await statIfExists(p)) return fs.realpath(p)
  if (p === path.dirname(p)) throw Error('目标磁盘不存在：' + p)
  return path.join(await canonical(path.dirname(p)), path.basename(p))
}
async function sourcePath(from, ref) {
  if (!/^(https?|git|ssh):\/\//i.test(from)) return fs.realpath(from)
  const split = from.indexOf('::', from.indexOf('://') + 3)
  const url = split < 0 ? from : from.slice(0, split)
  const sub = split < 0 ? '.' : from.slice(split + 2)
  if (!ref || ref.startsWith('-') || /[\s\\^~:?*\[]/.test(ref)) throw Error('Git 分支或标签无效')
  const cache = path.join(state, 'cache', 'electron-' + createHash('sha256').update(url).digest('hex'))
  const git = args => run('git', args, { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (!(await statIfExists(path.join(cache, '.git')))) {
    await fs.mkdir(path.dirname(cache), { recursive: true })
    const stage = await fs.mkdtemp(cache + '-')
    try {
      await git(['clone', '--depth', '1', '--branch', ref, '--', url, stage])
      await fs.rename(stage, cache)
    } finally { await fs.rm(stage, { recursive: true, force: true }) }
  } else {
    await git(['-C', cache, 'fetch', '--depth', '1', 'origin', ref])
    await git(['-C', cache, 'checkout', '--force', '--detach', 'FETCH_HEAD'])
  }
  const src = await fs.realpath(path.resolve(cache, sub))
  if (!inside(await fs.realpath(cache), src)) throw Error('仓库内路径超出仓库目录')
  return src
}
async function copyContents(src, dst) {
  const info = await fs.lstat(src)
  const existing = await statIfExists(dst)
  if (existing?.isSymbolicLink()) throw Error('目标中包含符号链接：' + dst)
  if (info.isSymbolicLink() && (await fs.stat(src)).isDirectory()) {
    await fs.mkdir(dst, { recursive: true })
    return 0
  }
  if (!info.isDirectory()) {
    await fs.copyFile(src, dst)
    return 1
  }
  await fs.mkdir(dst, { recursive: true })
  let count = 0
  for (const item of await fs.readdir(src)) {
    count += await copyContents(path.join(src, item), path.join(dst, item))
  }
  return count
}
function syncDirect({ fromPath, toPath, refName, syncMode = 'full' }) {
  return syncQueue(async () => {
    const src = await sourcePath(fromPath, refName || 'main')
    const inputTarget = path.resolve(toPath)
    if (!toPath.trim() || (await statIfExists(inputTarget))?.isSymbolicLink()) throw Error('目标路径无效')
    const dst = await canonical(inputTarget)
    const result = { from: fromPath, to: toPath, skipped: false, files_copied: 0, error: null }
    if (path.relative(src, dst) === '') return { ...result, skipped: true }
    if (inside(src, dst) || inside(dst, src) || dst === path.parse(dst).root) throw Error('源路径与目标路径不能互相包含')
    await fs.mkdir(path.dirname(dst), { recursive: true })
    if (['incremental', 'replace', 'merge'].includes(syncMode)) result.files_copied = await copyContents(src, dst)
    else if (['full', 'clean'].includes(syncMode)) {
      const stage = await fs.mkdtemp(path.join(path.dirname(dst), '.pai-sync-'))
      const next = path.join(stage, 'next'), old = path.join(stage, 'old')
      let moved = false
      try {
        result.files_copied = await copyContents(src, next)
        if (result.files_copied > 0) {
          if (await statIfExists(dst)) { await fs.rename(dst, old); moved = true }
          await fs.rename(next, dst)
          moved = false
        }
      } finally {
        if (moved) await fs.rename(old, dst)
        await fs.rm(stage, { recursive: true, force: true })
      }
    } else throw Error('未知同步模式')
    if (!result.files_copied) result.error = '源目录为空，未复制任何文件。请检查源路径。'
    return result
  })
}
module.exports = { readRecords, saveRecord, deleteRecord, syncDirect }

