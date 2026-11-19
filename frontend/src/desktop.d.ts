type SyncRecordData = {
  id: string; name: string; from_path: string; to_path: string; ref_name: string | null; created_at: string
}
interface Window {
  pai: {
    animations: import('./features/maker/types').AnimationAPI
    version(): Promise<string>
    directory(title: string): Promise<string | null>
    listRecords(): Promise<SyncRecordData[]>
    saveRecord(args: { id: string | null; name: string; fromPath: string; toPath: string; refName: string | null }): Promise<SyncRecordData>
    deleteRecord(id: string): Promise<void>
    sync(args: { fromPath: string; toPath: string; refName: string | null; syncMode: string }): Promise<{from: string; to: string; skipped: boolean; files_copied: number; error?: string}>
    checkUpdate(): Promise<{currentVersion: string; version: string} | null>
    installUpdate(): Promise<void>
    onProgress(fn: (percent: number) => void): () => void
  }
}

