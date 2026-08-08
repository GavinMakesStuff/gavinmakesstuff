'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const { scanMediaFiles } = require('./core/scanner');
const { findDuplicateGroups } = require('./core/duplicateGrouper');
const { buildDuplicatePlan, buildRenamePlan } = require('./core/planner');
const { executePlan, undoFromLog } = require('./core/planExecutor');
const { parsePhotographyName, buildPhotographyName, indexUsedNumbers, nextFreeNumber } = require('./core/naming/photography');
const { parseMemoriesLocation, checkYearMatchesCaptureDate, classifyMemoryName } = require('./core/naming/memories');
const { isCameraGeneratedName, preferHumanName } = require('./core/naming/namingEngine');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-duplicates', async (event, rootDir) => {
  const entries = await scanMediaFiles(rootDir, {
    onProgress: (count, filePath) => send('scan-progress', { stage: 'scanning', count, path: filePath }),
  });

  const groups = await findDuplicateGroups(entries, {
    onProgress: (stage, done, total) => send('scan-progress', { stage, done, total }),
  });

  // Attach a per-group human-friendly "preferred name" suggestion so the
  // UI can show it without a second IPC round trip.
  for (const group of groups) {
    group.suggestedName = preferHumanName([group.keep, ...group.discard], group.keep);
  }

  return { totalFiles: entries.length, groups };
});

ipcMain.handle('build-duplicate-plan', async (event, { groups, quarantineRoot }) => {
  return buildDuplicatePlan(groups, { quarantineRoot });
});

ipcMain.handle('execute-plan', async (event, { plan, logPath, dryRun }) => {
  return executePlan(plan, {
    logPath,
    dryRun,
    onProgress: (done, total, action) => send('execute-progress', { done, total, action }),
  });
});

ipcMain.handle('undo-log', async (event, logPath) => {
  return undoFromLog(logPath, {
    onProgress: (done, total, entry) => send('undo-progress', { done, total, entry }),
  });
});

ipcMain.handle('scan-photography', async (event, rootDir) => {
  const entries = await scanMediaFiles(rootDir);
  const byFolder = new Map();
  for (const entry of entries) {
    const folder = path.dirname(entry.path);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(entry);
  }

  const report = [];
  for (const [folder, files] of byFolder) {
    const baseNames = files.map((f) => path.basename(f.name, f.ext));
    const used = indexUsedNumbers(baseNames);
    for (let i = 0; i < files.length; i++) {
      const base = baseNames[i];
      const parsed = parsePhotographyName(base);
      if (!parsed) {
        report.push({
          path: files[i].path,
          folder,
          currentName: base,
          issue: 'does-not-match-convention',
          cameraGenerated: isCameraGeneratedName(base),
          suggestedNextNumber: nextFreeNumber(used),
        });
      }
    }
  }
  return { totalFiles: entries.length, issues: report };
});

ipcMain.handle('scan-memories', async (event, rootDir) => {
  const entries = await scanMediaFiles(rootDir);
  const report = [];
  for (const entry of entries) {
    const location = parseMemoriesLocation(entry.path, rootDir);
    const yearIssue = checkYearMatchesCaptureDate(location.year, entry.birthtime);
    const nameClass = classifyMemoryName(location.baseName);
    const issues = [...location.issues];
    if (yearIssue) issues.push(yearIssue);
    if (nameClass !== 'named') issues.push(`File ${nameClass === 'blank' ? 'has no description' : 'still has a camera-generated name'}`);
    if (issues.length > 0) {
      report.push({ path: entry.path, year: location.year, group: location.group, nameClass, issues });
    }
  }
  return { totalFiles: entries.length, issues: report };
});

ipcMain.handle('build-rename-plan', async (event, suggestions) => {
  return buildRenamePlan(suggestions);
});

module.exports = { buildPhotographyName };
