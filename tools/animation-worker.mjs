import { parentPort, workerData } from 'node:worker_threads'
import { nativeEnvironment, renderCode } from './animation/render.mjs'

try {
  const { code, template, validateOnly } = workerData
  const environment = template
    ? (await import('./pixelfx/animation-provider.mjs')).pixelEnvironment(template, code)
    : nativeEnvironment()
  const result = await renderCode(code, environment, validateOnly)
  parentPort.postMessage({ result }, result.png ? [result.png.buffer].filter(b => b.byteLength === result.png.byteLength) : [])
} catch (error) {
  parentPort.postMessage({ error: error.message || String(error) })
}
