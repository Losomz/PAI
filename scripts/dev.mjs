import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const vitePath = require.resolve('vite', { paths: [resolve('frontend')] })
const { createServer } = await import(pathToFileURL(vitePath))
const server = await createServer({ root: resolve('frontend'), server: { host: '127.0.0.1' } })
await server.listen()
const child = spawn(require('electron'), ['.'], { stdio: 'inherit', env: { ...process.env, PAI_DEV: '1' } })
child.on('exit', async code => { await server.close(); process.exitCode = code ?? 1 })

