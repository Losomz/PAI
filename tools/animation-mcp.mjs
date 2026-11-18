import { z } from 'zod'
const service = () => import('./animation-service.mjs')

export function registerAnimationTools(server, result) {
  const id = z.string().describe('Animation ID, e.g. custom/orbit or fire/torch.')
  const revision = z.string().describe('Revision returned by animation_read.')
  const code = z.string().max(512 * 1024).describe('Complete JavaScript ES module source.')
  server.registerTool('animation_list', {
    description: 'Search the editable personal animation library, or original templates available to add.',
    inputSchema: { collection: z.enum(['library', 'templates']).default('library'), query: z.string().default(''),
      offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(250).default(50) },
  }, async ({ collection, query, offset, limit }) => {
    const data = (await service()).listAnimations()
    const items = (collection === 'templates' ? data.templates : data.items)
      .filter(item => (item.id + ' ' + item.name).toLowerCase().includes(query.trim().toLowerCase()))
    return result({ total: items.length, items: items.slice(offset, offset + limit) })
  })
  server.registerTool('animation_read', {
    description: 'Read editable source, codePath, runtime and revision. For PixelFX copies, relative imports resolve beside the read-only templatePath.',
    inputSchema: { id },
  }, async args => result((await service()).readAnimation(args.id)))
  server.registerTool('animation_create', {
    description: 'Create an independent animation module. Omit code for a runnable starter, or supply a PixelFX template ID to copy. Native modules export meta { name, size: [w,h], duration, fps, loop } and draw(rgba, timeInSeconds, {width,height}).',
    inputSchema: { id, name: z.string().trim().min(1).max(120), template: z.string().optional(), code: code.optional() },
  }, async args => result(await (await service()).createAnimation(args)))
  server.registerTool('animation_update', {
    description: 'Check the module and render its first frame, then replace the source only if revision still matches.',
    inputSchema: { id, revision, code },
  }, async args => result(await (await service()).updateAnimation(args)))
  server.registerTool('animation_delete', {
    description: 'Remove one animation from the personal library. Returns its archived directory.',
    inputSchema: { id, revision },
  }, async args => result((await service()).removeAnimation(args.id, args.revision)))
  server.registerTool('animation_render', {
    description: 'Render the current editable module headlessly to a transparent sprite sheet PNG and frame metadata JSON.',
    inputSchema: { id, outputDir: z.string().describe('Absolute output directory'), revision: revision.optional() },
  }, async args => result(await (await service()).exportAnimation(args.id, args.outputDir, args.revision)))
}
