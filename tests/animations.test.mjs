import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import pngjs from 'pngjs'
import { AnimationLibrary, renderCode, nativeEnvironment, exportSheet } from '@pai/animation'

const code = `export const meta = {name: 'test', size:[2,2], fps:2, duration:1, loop:true};
export function draw(rgba,t) {rgba.set([t === 0 ? 100 : 200, 0, 0, 255])}`
const mcpScript = fileURLToPath(new URL('../tools/mcp.mjs', import.meta.url))
async function clientFor(root) {
  const client = new Client({ name: 'animation-test', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [mcpScript],
    env: { ...process.env, PAI_ANIMATION_HOME: root }, stderr: 'ignore' }))
  return client
}
async function call(client, name, args) {
  const reply = await client.callTool({ name: 'animation_' + name, arguments: args })
  if (reply.isError) throw Error(reply.content[0].text)
  return reply.structuredContent
}

test('independent animation module runs, stores and exports a JS animation without a provider', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pai-animation-'))
  const library = new AnimationLibrary(path.join(temp, 'library'))
  try {
    const item = library.create({ id: 'demo/test', name: 'Test', code })
    const result = await renderCode(library.read(item.id).code, nativeEnvironment())
    assert.equal(result.frames, 2)
    const files = await exportSheet(item.id, temp, result)
    const image = pngjs.PNG.sync.read(await fs.readFile(files.sheet))
    assert.deepEqual([...image.data.subarray(0, 4)], [100, 0, 0, 255])
    assert.deepEqual([...image.data.subarray(8, 12)], [200, 0, 0, 255])
    assert.equal(JSON.parse(await fs.readFile(files.atlas, 'utf8')).frames[1].duration, 500)
    assert.throws(() => library.read('../test'), /动画 ID/)
    assert.throws(() => library.read('demo/con'), /动画 ID/)
  } finally {
    library.close()
    await fs.rm(temp, { recursive: true, force: true })
  }
})

test('two agent processes edit and prune a shared library without changing upstream', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pai-animation-agents-'))
  const root = path.join(temp, 'library')
  const a = await clientFor(root), b = await clientFor(root)
  try {
    const [one, two] = await Promise.all([call(a, 'list', {}), call(b, 'list', {})])
    assert.equal(one.total, 244); assert.equal(two.total, 244)
    const source = new URL('../tools/pixelfx/upstream/src/fx/fire/torch.js', import.meta.url)
    const original = await fs.readFile(source, 'utf8')
    const torch = await call(a, 'read', { id: 'fire/torch' })
    assert.equal(torch.code, original)
    const copy = await call(a, 'create', { id: 'custom/torch', name: 'Torch copy', template: torch.id })
    const modified = original.replace('duration: 2,', 'duration: 1,')
    const v2 = await call(b, 'update', { id: copy.id, revision: copy.revision, code: modified })
    assert.equal((await call(a, 'read', { id: copy.id })).code, modified)
    assert.equal(await fs.readFile(source, 'utf8'), original)
    await assert.rejects(call(a, 'update', { id: copy.id, revision: copy.revision, code: original }), /重新读取/)
    const files = await call(a, 'render', { id: copy.id, revision: v2.revision, outputDir: temp })
    assert.equal(files.frames, 30)
    await assert.rejects(call(b, 'update', { id: copy.id, revision: v2.revision, code: 'export ???' }))
    assert.equal((await call(a, 'read', { id: copy.id })).revision, v2.revision)
    await call(b, 'delete', { id: torch.id, revision: torch.revision })
    await assert.rejects(call(a, 'read', { id: torch.id }))
    assert.equal((await call(a, 'list', { query: torch.id })).total, 0)
    assert.equal((await call(a, 'list', { collection: 'templates', query: torch.id })).total, 1)
    const c = await clientFor(root)
    try { await assert.rejects(call(c, 'read', { id: torch.id })) }
    finally { await c.close() }
    const restored = await call(a, 'create', { id: torch.id, template: torch.id, name: torch.name })
    assert.equal(restored.code, original)
    await assert.rejects(call(b, 'delete', { id: torch.id, revision: torch.revision }), /重新读取/)
    await fs.writeFile(copy.codePath, '// local editor\n' + modified)
    assert.notEqual((await call(a, 'read', { id: copy.id })).revision, v2.revision)
    const native = await call(a, 'create', { id: 'demo/dot', name: 'Dot', code })
    const writes = await Promise.allSettled([a, b].map((client, i) =>
      call(client, 'update', { id: native.id, revision: native.revision, code: code + '\n//' + i })))
    assert.equal(writes.filter(w => w.status === 'fulfilled').length, 1)
  } finally {
    await Promise.all([a.close(), b.close()])
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
  }
})
