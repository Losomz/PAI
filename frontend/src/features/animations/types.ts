export type AnimationItem = { id: string; name: string; template: string | null }
export type AnimationRecord = AnimationItem & { code: string; codePath: string; revision: string }
export type AnimationTemplate = Pick<AnimationItem, 'id' | 'name'>
export type AnimationInventory = { root: string; items: AnimationItem[]; templates: AnimationTemplate[] }
export type Preview = {
  width: number; height: number; fps: number; frames: number; columns: number
  loop: boolean; duration: number; name: string; image: string
}
export interface AnimationAPI {
  list(): Promise<AnimationInventory>
  read(id: string): Promise<AnimationRecord>
  create(input: {id: string; name: string; template?: string}): Promise<AnimationRecord>
  remove(id: string, revision: string): Promise<{ archivedPath: string }>
  preview(id: string, revision: string): Promise<Preview>
  cancelPreview(): Promise<void>
  export(id: string, revision: string): Promise<{ directory: string } | null>
  reveal(id: string): Promise<void>
  copyPath(id: string): Promise<void>
  onChange(callback: () => void): () => void
}

export function errorText(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
