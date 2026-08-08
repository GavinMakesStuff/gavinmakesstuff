'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanDuplicates: (rootDir) => ipcRenderer.invoke('scan-duplicates', rootDir),
  buildDuplicatePlan: (groups, quarantineRoot) => ipcRenderer.invoke('build-duplicate-plan', { groups, quarantineRoot }),
  executePlan: (plan, logPath, dryRun) => ipcRenderer.invoke('execute-plan', { plan, logPath, dryRun }),
  undoLog: (logPath) => ipcRenderer.invoke('undo-log', logPath),
  scanPhotography: (rootDir) => ipcRenderer.invoke('scan-photography', rootDir),
  scanMemories: (rootDir) => ipcRenderer.invoke('scan-memories', rootDir),
  buildRenamePlan: (suggestions) => ipcRenderer.invoke('build-rename-plan', suggestions),

  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (_event, data) => callback(data)),
  onExecuteProgress: (callback) => ipcRenderer.on('execute-progress', (_event, data) => callback(data)),
  onUndoProgress: (callback) => ipcRenderer.on('undo-progress', (_event, data) => callback(data)),
});
