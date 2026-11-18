import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { registerAnimationTools } from './animation-mcp.mjs'

const server = new McpServer({ name: 'pai-tools', version: '1.0.0' })
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data })
registerAnimationTools(server, result)
server.registerTool('pixelfx_list', {
  description: 'Find offline PixelFX animations by English category, name or tags. Results include exact IDs for pixelfx_render.',
  inputSchema: { query: z.string().optional(), offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(250).default(40) },
}, async ({ query, offset, limit }) => {
  const { listEffects } = await import('./pixelfx/index.mjs')
  const matches = listEffects(query)
  return result({ total: matches.length, effects: matches.slice(offset, offset + limit) })
})
server.registerTool('pixelfx_render', {
  description: 'Export using upstream PixelFX in a new directory inside outputDir. Returns absolute paths to the transparent sprite sheet PNG, Aseprite JSON and contact sheet PNG.',
  inputSchema: { id: z.string(), outputDir: z.string().describe('Absolute local directory for output'),
    seed: z.number().int().min(0).max(2147483647).optional(), fps: z.number().int().min(1).max(60).optional(),
    actor: z.boolean().optional().describe('Include character choreography for supported effects'),
    flip: z.boolean().optional(), palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(2).max(32).optional() },
}, async args => {
  const { exportEffect } = await import('./pixelfx/index.mjs')
  return result(await exportEffect(args))
})

await server.connect(new StdioServerTransport())

