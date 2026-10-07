"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, Menu, session } = require("electron");

const APP_ID = "com.xiaojian.stickylife";
const ENTRY_FILE = path.join(__dirname, "..", "dist", "index.html");
const ENTRY_URL = pathToFileURL(ENTRY_FILE);
let mainWindow = null;

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
    icon: path.join(__dirname, "..", "assets", "icon.png"),
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
