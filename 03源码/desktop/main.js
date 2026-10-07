"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, Menu, session, ipcMain, shell } = require("electron");
const { RecordStore } = require('./storage');
const { migrate } = require('../dist/app');

const APP_ID = "com.xiaojian.stickylife";
const ENTRY_FILE = path.join(__dirname, "..", "dist", "index.html");
const ENTRY_URL = pathToFileURL(ENTRY_FILE);
let mainWindow = null;
let recordStore = null;
let storeError = '';

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    denyRendererPermissions();
    try {
      recordStore = new RecordStore({ userData: app.getPath('userData'), installDirectory: path.dirname(app.getPath('exe')), fallbackDirectory: app.getPath('documents'), validate: migrate });
    } catch (error) { storeError = error.message; }
    registerStorageHandlers();
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "小笺",
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: "#f7f4ec",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedLocalUrl(targetUrl)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(ENTRY_FILE).catch((error) => {
    dialog.showErrorBox("小笺无法启动", `本地页面加载失败：${error.message}`);
    app.quit();
  });
}

function registerStorageHandlers() {
  const handle = (channel, handler) => ipcMain.handle(channel, async (event, input) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedLocalUrl(event.senderFrame.url)) throw Error('无效的数据访问来源');
      if (!recordStore) throw Error(storeError || '记录目录无法打开');
      return { ok: true, value: await handler(input) };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  handle('records:load', () => ({ data: recordStore.load(), info: recordStore.info() }));
  handle('records:info', () => recordStore.info());
  handle('records:save', data => recordStore.save(data));
  handle('records:backup', () => { const data = recordStore.load(); if (!data) throw Error('还没有可备份的记录，请先保存一条记录或设置'); return recordStore.backup(data); });
  handle('records:preferences', input => recordStore.setPreferences(input));
  handle('records:choose-data', async mode => {
    let folder;
    if (mode === 'install') folder = path.join(path.dirname(app.getPath('exe')), '小笺数据');
    else {
      const result = await dialog.showOpenDialog(mainWindow, { title: '选择记录文件夹（记录与备份将复制到这里）', defaultPath: recordStore.config.dataRoot, properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled) return null;
      folder = result.filePaths[0];
    }
    return recordStore.changeDataRoot(folder);
  });
  handle('records:choose-backup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择备份文件夹', defaultPath: recordStore.config.backupRoot, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : recordStore.changeBackupRoot(result.filePaths[0]);
  });
  handle('records:open-folder', async kind => {
    const folder = kind === 'data' ? recordStore.config.dataRoot : kind === 'backup' ? recordStore.config.backupRoot : null;
    if (!folder) throw Error('无效的文件夹类型');
    require('node:fs').mkdirSync(folder, { recursive: true });
    const error = await shell.openPath(folder); if (error) throw Error(error);
    return true;
  });
}

function denyRendererPermissions() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function isTrustedLocalUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "file:" && parsed.pathname === ENTRY_URL.pathname;
  } catch (_error) {
    return false;
  }
}
