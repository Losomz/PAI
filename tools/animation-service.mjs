import path from 'node:path'
import os from 'node:os'
import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { AnimationLibrary, checkCode, checkId } from './animation/library.mjs'
import { starterCode } from './animation/starter.mjs'
import { exportSheet } from './animation/export.mjs'
const provider = existsSync(new URL('./pixelfx/upstream/src/fx/index.js', import.meta.url))
  ? await import('./pixelfx/animation-provider.mjs') : null
const templates = provider?.templates ?? []

let storage
export function library() {
  if (!storage) {
    const root = process.env.PAI_ANIMATION_HOME || path.join(os.homedir(), '.agentframework', 'animations')
    if (!path.isAbsolute(root)) throw Error('PAI_ANIMATION_HOME 须为绝对路径')
    const db = new AnimationLibrary(root)
    try {
      if (provider) db.install('pixelfx', () => templates.map(t => ({ ...t, template: t.id, code: provider.templateCode(t.id) })))
      storage = db
    } catch (error) {
      db.close()
      throw error
    }
  }
  return storage
}

function render({ code, template }, validateOnly, signal) {
  checkCode(code)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('预览已取消'))
    const worker = new Worker(new URL('./animation-worker.mjs', import.meta.url), {
      workerData: { code, template, validateOnly }, execArgv: [],
    })
    const abort = () => { reject(Error('预览已取消')); void worker.terminate() }
    const timer = setTimeout(() => { reject(Error('动画运行超时')); void worker.terminate() }, 100_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', ({ result, error }) => error ? reject(Error(error)) : resolve(result))
    worker.once('error', reject)
    worker.once('exit', () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(Error('动画渲染进程已退出'))
    })
  })
}

export function listAnimations() {
  return { root: library().root, items: library().list(), templates }
}
export function readAnimation(id) {
  const item = library().read(id)
  return { ...item, runtime: item.template ? 'pixelfx' : 'rgba',
    templatePath: item.template && provider ? provider.templatePath(item.template) : null }
}
export const removeAnimation = (id, revision) => library().remove(id, revision)

export async function createAnimation({ id, name, template = null, code }) {
  checkId(id)
  if (existsSync(library().directory(id))) throw Error('动画 ID 已存在：' + id)
  if (template && !provider) throw Error('尚未安装 PixelFX 素材源')
  const source = template ? provider.templateCode(template) : starterCode(name)
  const record = { id, name, template, code: code ?? source }
  await render(record, true)
  return library().create(record)
}
export async function updateAnimation({ id, revision, code }) {
  const record = library().current(id, revision)
  await render({ ...record, code }, true)
  return library().update(id, revision, code)
}
export async function previewAnimation(id, revision, signal) {
  const record = library().current(id, revision)
  const { png, ...info } = await render(record, false, signal)
  return { ...info, image: 'data:image/png;base64,' + Buffer.from(png).toString('base64') }
}
export async function exportAnimation(id, outputDir, revision) {
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) throw Error('导出目录须为绝对路径')
  const record = revision ? library().current(id, revision) : library().read(id)
  return { ...await exportSheet(id, outputDir, await render(record, false)), revision: record.revision }
}
