import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { verifySignature } from '../desktop/updater.cjs'

test('updater accepts the release signer and rejects a modified payload', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pai-sign-test-'))
  try {
    const key = path.join(dir, 'temporary.key'), payload = path.join(dir, 'installer.bin')
    await fs.writeFile(payload, 'fixture')
    const signer = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url))
    const invoke = args => execFileSync(process.execPath, [signer, 'signer', ...args], { stdio: 'pipe' })
    invoke(['generate', '--ci', '-w', key])
    invoke(['sign', '-f', key, '-p', '', payload])
    const publicKey = (await fs.readFile(key + '.pub', 'utf8')).trim()
    const sig = (await fs.readFile(payload + '.sig', 'utf8')).trim()
    assert.equal(verifySignature(Buffer.from('fixture'), publicKey, sig), true)
    assert.equal(verifySignature(Buffer.from('changed'), publicKey, sig), false)
  } finally { await fs.rm(dir, { force: true, recursive: true }) }
})

test('legacy records, incremental merge, safe full replacement and retry', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pai-sync-test-'))
  const envKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const original = process.env[envKey]
  try {
    process.env[envKey] = dir
    const sync = createRequire(import.meta.url)('../desktop/sync.cjs')
    const state = path.join(dir, '.agentframework')
    await fs.mkdir(state)
    const src = path.join(dir, 'src'), dst = path.join(dir, 'dst')
    await fs.mkdir(src); await fs.mkdir(dst)
    await fs.writeFile(path.join(src, 'sample'), 'new')
    await fs.writeFile(path.join(dst, 'extra'), 'original')
    const row = { id: 'old', name: 'old', from_path: src, to_path: dst, created_at: '1' }
    await fs.writeFile(path.join(state, 'sync_records.json'), JSON.stringify([row]))
    assert.deepEqual(await sync.readRecords(), [row])
    const args = { fromPath: src, toPath: dst }
    await Promise.all([1,2].map(i => sync.saveRecord({ ...args, name: String(i) })))
    assert.equal((await sync.readRecords()).length, 3)
    await sync.deleteRecord('old')
    assert.equal((await sync.syncDirect({ ...args, syncMode: 'merge' })).files_copied, 1)
    assert.equal(await fs.readFile(path.join(dst, 'extra'), 'utf8'), 'original')
    await sync.syncDirect({ ...args, syncMode: 'full' })
    assert.deepEqual(await fs.readdir(dst), ['sample'])
    assert.equal((await sync.syncDirect({ fromPath: src, toPath: src })).skipped, true)
    await assert.rejects(sync.syncDirect({ fromPath: src, toPath: path.join(src, 'nested') }))
    await fs.rm(path.join(src, 'sample'))
    assert.ok((await sync.syncDirect(args)).error)
    assert.equal(await fs.readFile(path.join(dst, 'sample'), 'utf8'), 'new')
  } finally {
    if (original === undefined) delete process.env[envKey]; else process.env[envKey] = original
    await fs.rm(dir, { force: true, recursive: true })
  }
})

