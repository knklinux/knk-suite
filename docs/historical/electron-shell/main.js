'use strict';

// ============================================================================
// desktop/main.js — knkLinux Desktop (Electron)
//
// El shell arranca el backend local, espera un health check autenticado y abre
// el workbench. En desarrollo usa la raíz del repositorio; en una distribución
// empaquetada usa resources/backend y resources/frontend/dist.
// ============================================================================

const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const DEV_ROOT = path.join(__dirname, '..');
const APP_ROOT = app.isPackaged ? process.resourcesPath : DEV_ROOT;
const PORT = parseInt(process.env.KNK_PORT || '8086', 10);
const HOST = '127.0.0.1';
const URL = `http://${HOST}:${PORT}`;
const BACKEND_ENTRY = path.join(APP_ROOT, 'backend', 'index.js');

let backend = null;
let win = null;
let assistWin = null;

function apiToken() {
  if (process.env.KNK_API_TOKEN) return process.env.KNK_API_TOKEN.trim();
  try {
    return fs.readFileSync(path.join(os.homedir(), '.knk-suite', 'api-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

function waitBackend(retries = 40) {
  return new Promise((resolve, reject) => {
    const probe = (n) => {
      const token = apiToken();
      const req = http.get(`${URL}/api/health`, {
        headers: token ? { 'X-KNK-Token': token } : {},
      }, (r) => {
        r.resume();
        if (r.statusCode === 200) return resolve();
        retry(n);
      });
      req.on('error', () => retry(n));
      req.setTimeout(1500, () => { req.destroy(); retry(n); });
    };
    const retry = (n) => (n <= 0
      ? reject(new Error(`Backend no arrancó en ${URL}`))
      : setTimeout(() => probe(n - 1), 500));
    probe(retries);
  });
}

// better-sqlite3/node-pty se compilan para el Node del sistema en desarrollo.
// KNK_NODE_EXE permite fijarlo; si no existe, Electron se intenta como Node y
// el backend muestra el error de ABI de forma visible en lugar de fingir salud.
function resolveNode() {
  const cands = [
    process.env.KNK_NODE_EXE,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'node.exe') : null,
    process.platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : null,
    process.platform === 'win32' ? null : 'node',
  ].filter(Boolean);
  for (const candidate of cands) {
    if (candidate === 'node') return candidate;
    try { if (fs.existsSync(candidate)) return candidate; } catch {}
  }
  return process.execPath;
}

function startBackend() {
  if (!fs.existsSync(BACKEND_ENTRY)) {
    throw new Error(`No existe el backend empaquetado: ${BACKEND_ENTRY}`);
  }
  const nodeExe = resolveNode();
  const usingElectronNode = nodeExe === process.execPath;
  console.log('[backend] entry:', BACKEND_ENTRY);
  console.log('[backend] node:', nodeExe);
  backend = spawn(nodeExe, [BACKEND_ENTRY], {
    cwd: APP_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      KNK_HOST: HOST,
      KNK_PORT: String(PORT),
      ...(usingElectronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      NODE_PATH: [path.join(APP_ROOT, 'node_modules'), process.env.NODE_PATH || '']
        .filter(Boolean).join(path.delimiter),
    },
  });
  backend.on('error', (e) => console.error('[backend]', e.message));
  backend.on('exit', (code, signal) => {
    if (code !== 0 && !app.isQuitting) console.error('[backend] exit', code, signal || '');
  });
  backend.stdout.on('data', (d) => process.stdout.write('[backend] ' + d));
  backend.stderr.on('data', (d) => process.stderr.write('[backend!] ' + d));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d1117',
    icon: path.join(APP_ROOT, 'assets', 'knklinux.ico'),
    title: 'knkLinux // Security Workbench',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function createAssistantWindow() {
  if (assistWin && !assistWin.isDestroyed()) { assistWin.show(); assistWin.focus(); return; }
  assistWin = new BrowserWindow({
    width: 380,
    height: 520,
    minWidth: 320,
    minHeight: 380,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0d1117',
    icon: path.join(APP_ROOT, 'assets', 'knklinux.ico'),
    title: 'KNK Assistant',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  assistWin.loadURL(URL + '/#assistant');
  assistWin.setAlwaysOnTop(true, 'screen-saver');
  assistWin.on('closed', () => { assistWin = null; });
}

// Ventana flotante sin marco: solo se aceptan desplazamientos relativos y
// acotados; el renderer nunca puede fijar coordenadas arbitrarias de pantalla.
ipcMain.on('assistant-window-move', (ev, payload = {}) => {
  const w = BrowserWindow.fromWebContents(ev.sender);
  const { dx, dy } = payload;
  if (!w || typeof dx !== 'number' || typeof dy !== 'number') return;
  const [x, y] = w.getPosition();
  w.setPosition(
    x + Math.max(-200, Math.min(200, dx)),
    y + Math.max(-200, Math.min(200, dy)),
  );
});
ipcMain.on('assistant-window-close', (ev) => {
  const w = BrowserWindow.fromWebContents(ev.sender);
  if (w) w.close();
});

app.isQuitting = false;
app.whenReady().then(async () => {
  try {
    startBackend();
    await waitBackend();
  } catch (e) {
    console.error('[startup]', e.message);
  }
  createWindow();

  const okK = globalShortcut.register('Control+Alt+K', () => {
    createAssistantWindow();
    assistWin?.webContents.send('assistant-hotkey', { pushToTalk: true });
  });
  const okW = globalShortcut.register('Control+Alt+W', () => {
    if (win) { win.show(); win.focus(); }
  });
  if (!okK) console.warn('[hotkeys] Control+Alt+K ocupado');
  if (!okW) console.warn('[hotkeys] Control+Alt+W ocupado');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  if (backend && !backend.killed) {
    try { backend.kill(); } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
