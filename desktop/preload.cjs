const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('pai', {
  version: () => ipcRenderer.invoke('pai:version'),
  directory: title => ipcRenderer.invoke('pai:directory', title),
  animations: {
    list: () => ipcRenderer.invoke('animations:list'),
    read: id => ipcRenderer.invoke('animations:read', id),
    create: args => ipcRenderer.invoke('animations:create', args),
    remove: (id, revision) => ipcRenderer.invoke('animations:delete', id, revision),
    preview: (id, revision) => ipcRenderer.invoke('animations:preview', id, revision),
    cancelPreview: () => ipcRenderer.invoke('animations:cancel'),
    export: (id, revision) => ipcRenderer.invoke('animations:export', id, revision),
    reveal: id => ipcRenderer.invoke('animations:reveal', id),
    copyPath: id => ipcRenderer.invoke('animations:copy-path', id),
    onChange: callback => {
      const listener = () => callback()
      ipcRenderer.on('animations:changed', listener)
      return () => ipcRenderer.off('animations:changed', listener)
    },
  },
  listRecords: () => ipcRenderer.invoke('sync:list'),
  saveRecord: args => ipcRenderer.invoke('sync:save', args),
  deleteRecord: id => ipcRenderer.invoke('sync:delete', id),
  sync: args => ipcRenderer.invoke('sync:run', args),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onProgress: callback => {
    const listener = (_event, percent) => callback(percent)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.off('update:progress', listener)
  },
})

