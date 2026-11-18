import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'

await build({ entryPoints: { 'pai-mcp': 'tools/mcp.mjs', 'animation-service': 'tools/animation-service.mjs',
    'animation-worker': 'tools/animation-worker.mjs' }, outdir: 'dist/agent', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['./pixelfx/index.mjs', './pixelfx/animation-provider.mjs', './animation-service.mjs'], legalComments: 'eof',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })
// Use the installed Electron binary as Node for clients without a separate Node installation.
await mkdir('dist/agent', { recursive: true })
await mkdir('dist/agent/licenses', { recursive: true })
for (const pkg of ['pngjs', 'quickjs-emscripten-core', '@jitl/quickjs-singlefile-cjs-release-sync']) {
  await copyFile('node_modules/' + pkg + '/LICENSE', 'dist/agent/licenses/' + pkg.split('/').pop() + '.txt')
}
await writeFile('dist/agent/pai-mcp.cmd', '@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0..\\..\\PAI.exe" "%~dp0pai-mcp.mjs"\r\nexit /b %errorlevel%\r\n')

