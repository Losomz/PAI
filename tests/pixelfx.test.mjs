import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { execFileSync } from 'node:child_process'
import { listEffects, exportEffect } from '../tools/pixelfx/index.mjs'

const upstream = fileURLToPath(new URL('../tools/pixelfx/upstream/', import.meta.url))

test('character sheets match upstream act.mjs --sheet', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pai-actor-'))
  try {
    const reference = path.join(dir, 'reference')
    await mkdir(reference)
    for (const part of ['src', 'tools', 'package.json']) {
      await cp(path.join(upstream, part), path.join(reference, part), { recursive: true })
    }
    execFileSync(process.execPath, [path.join(reference, 'tools/act.mjs'), 'melee/sword-slash', '--sheet'])
    const result = await exportEffect({ id: 'melee/sword-slash', actor: true, outputDir: dir })
    const base = path.join(reference, 'records/act/melee-sword-slash.sheet')
    assert.deepEqual(await readFile(result.sheet), await readFile(base + '.png'))
    assert.deepEqual(await readFile(result.atlas), await readFile(base + '.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('stdio MCP discovers effects and renders deterministic, independent atlas exports', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'pai-mcp-test-'))
  const client = new Client({ name: 'test', version: '1' })
  try {
    const args = [fileURLToPath(new URL('../tools/mcp.mjs', import.meta.url))]
    await client.connect(new StdioClientTransport({ command: process.execPath, args }))
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).filter(name => name.startsWith('pixelfx_')).sort(), ['pixelfx_list', 'pixelfx_render'])
    const list = (await client.callTool({ name: 'pixelfx_list', arguments: { query: 'torch' } })).structuredContent
    assert.ok(list.effects.some(e => e.id === 'fire/torch'))
    assert.equal(listEffects().length, 244)
    const options = { id: 'fire/flamethrower', outputDir, fps: 30, seed: 3 }
    const render = async () => (await client.callTool({ name: 'pixelfx_render', arguments: options })).structuredContent
    const a = await render(), b = await render()
    assert.notEqual(a.directory, b.directory)
    const sheet = await readFile(a.sheet)
    assert.deepEqual(sheet, await readFile(b.sheet))
    assert.equal(sheet.readUInt32BE(0), 0x89504e47)
    assert.equal((await readFile(a.preview)).readUInt32BE(0), 0x89504e47)
    const atlas = JSON.parse(await readFile(a.atlas, 'utf8'))
    assert.equal(a.frames, 48)
    assert.equal(atlas.frames.length, a.frames)
    assert.equal(atlas.meta.image, path.basename(a.sheet))
    assert.deepEqual(atlas.meta.size, { w: sheet.readUInt32BE(16), h: sheet.readUInt32BE(20) })
    const reference = path.join(outputDir, 'reference')
    execFileSync(process.execPath, [path.join(upstream, 'tools/render.mjs'), options.id,
      '--sheet', '--out', reference, '--seed', '3', '--fps', '30'])
    for (const file of [a.sheet, a.atlas, a.preview]) {
      assert.deepEqual(await readFile(file), await readFile(path.join(reference, options.id, path.basename(file))))
    }
    const bad = await client.callTool({ name: 'pixelfx_render', arguments: { ...options, id: '../../unknown' } })
    assert.equal(bad.isError, true)
  } finally {
    await client.close()
    await rm(outputDir, { recursive: true, force: true })
  }
})

