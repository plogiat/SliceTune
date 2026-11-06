const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { decodeFile, processAudio, encodeFile } = require('./audio.cjs');
let win, language = 'ru';
const text = (ru, en) => language === 'ru' ? ru : en;
const autosavePath = () => path.join(app.getPath('userData'), 'recovery.slicetune');
async function atomicWrite(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  try { await fs.writeFile(temp, data); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
function checkProject(data) {
  if (typeof data !== 'string' || Buffer.byteLength(data) > 512 * 1024 * 1024) throw new Error('Project exceeds 512 MB limit');
  const project = JSON.parse(data);
  if (project.app !== 'SliceTune' || project.version !== 1 || !Array.isArray(project.tracks) || !project.assets) throw new Error('Invalid SliceTune project');
  return data;
}
function register() {
  ipcMain.handle('setLanguage', (_, value) => { language = value === 'en' ? 'en' : 'ru'; });
  ipcMain.handle('importAudio', async () => {
    const result = await dialog.showOpenDialog(win, { title: text('Добавить аудио или видео', 'Import audio or video'), properties: ['openFile', 'multiSelections'], filters: [{ name: text('Аудио и видео', 'Audio & video'), extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'aiff', 'opus', 'mp4', 'mkv', 'mov', 'webm', 'avi'] }] });
    if (result.canceled) return null;
    const files = [];
    for (const file of result.filePaths) {
      if ((await fs.stat(file)).size > 500 * 1024 * 1024) throw new Error(text('Файл больше 500 МБ', 'File exceeds 500 MB'));
      files.push({ name: path.basename(file), data: await decodeFile(file) });
    }
    return files;
  });
  ipcMain.handle('openProject', async () => {
    const result = await dialog.showOpenDialog(win, { title: text('Открыть проект', 'Open project'), filters: [{ name: 'SliceTune', extensions: ['slicetune'] }] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 512 * 1024 * 1024) throw new Error('Project exceeds 512 MB');
    return checkProject(await fs.readFile(file, 'utf8'));
  });
  ipcMain.handle('saveProject', async (_, data, name) => {
    checkProject(data);
    const result = await dialog.showSaveDialog(win, { title: text('Сохранить проект', 'Save project'), defaultPath: `${String(name).replace(/[<>:"/\\|?*]/g, '_')}.slicetune`, filters: [{ name: 'SliceTune', extensions: ['slicetune'] }] });
    if (result.canceled) return false;
    await atomicWrite(result.filePath, data);
    return true;
  });
  ipcMain.handle('autosave', async (_, data) => { checkProject(data); await atomicWrite(autosavePath(), data); return true; });
  ipcMain.handle('recoverProject', async () => { try { return checkProject(await fs.readFile(autosavePath(), 'utf8')); } catch { return null; } });
  ipcMain.handle('processAudio', (_, payload) => processAudio(payload));
  ipcMain.handle('exportAudio', async (_, data, format, name) => {
    if (!['wav', 'mp3', 'flac', 'ogg'].includes(format) || typeof data !== 'string' || data.length > 700000000) throw new Error('Invalid export');
    const result = await dialog.showSaveDialog(win, { title: text('Экспорт аудио', 'Export audio'), defaultPath: `${String(name).replace(/[<>:"/\\|?*]/g, '_')}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (result.canceled) return false;
    await encodeFile(data, result.filePath, format);
    return true;
  });
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = contents.getURL();
    callback(contents === win?.webContents && (url.startsWith('file://') || url.startsWith('http://127.0.0.1:5173/')) && permission === 'media' && details.mediaTypes?.every(type => type === 'audio'));
  });
  register();
  win = new BrowserWindow({ width: 1500, height: 970, minWidth: 1050, minHeight: 720, backgroundColor: '#241321', title: 'SliceTune', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', title: 'SliceTune', message: text('Есть несохранённые изменения или активная запись. Закрыть приложение?', 'There are unsaved changes or an active recording. Close the app?'), buttons: [text('Закрыть без сохранения', 'Close without saving'), text('Отмена', 'Cancel')], defaultId: 1, cancelId: 1 });
    if (response === 0) event.preventDefault();
  });
  win.loadFile(path.join(__dirname, '../dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
