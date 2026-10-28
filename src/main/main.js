'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, net, powerMonitor, safeStorage, shell } = require('electron');
const { Storage } = require('./storage');
const { SyncEngine } = require('./sync');
const { MoodleClient, MoodleError } = require('./moodle');
const { ssoLogin } = require('./moodle-sso');
const { testConnection, PRESETS } = require('./mail');
const { testApiKey } = require('./ai');
const { ensureLocalFile } = require('./files');

const APP_ID = 'fr.malicence.dashboard';
const ASSETS = path.join(__dirname, '..', '..', 'assets');

if (process.env.LICENCE_DASHBOARD_DATA_DIR) app.setPath('userData', path.resolve(process.env.LICENCE_DASHBOARD_DATA_DIR));
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

let win = null;
let tray = null;
let storage = null;
let engine = null;
let timer = null;
let quitting = false;
const startHidden = process.argv.includes('--hidden');

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function publicAgenda(agenda) {
  if (!agenda) return null;
  const { fileIndex, ...rest } = agenda;
  return rest;
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    title: 'Ma Licence',
    show: false,
    backgroundColor: '#f6f7f9',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  // The window never navigates away; links open in the browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (!quitting && storage.settings.general.closeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('show', () => {
    const last = engine && engine.status.lastSync;
    if (engine && isConfigured() && (!last || Date.now() - last > 10 * 60 * 1000)) engine.run('focus');
  });
}

function createTray() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const image = nativeImage.createFromPath(path.join(ASSETS, file));
  if (image.isEmpty()) return;
  tray = new Tray(image);
  tray.setToolTip('Ma Licence');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Ma Licence', click: showWindow },
      { label: 'Synchroniser maintenant', click: () => engine.run('tray') },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', showWindow);
}

function isConfigured() {
  const s = storage.settings;
  return Boolean((s.moodle.baseUrl && s.moodle.token) || (s.mail.enabled && s.mail.host));
}

function schedule() {
  if (timer) clearInterval(timer);
  const minutes = Math.max(5, Number(storage.settings.general.syncMinutes) || 20);
  timer = setInterval(() => {
    if (isConfigured()) engine.run('timer');
  }, minutes * 60 * 1000);
}

function notify(title, body, item) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(ASSETS, 'icon.png') });
  n.on('click', () => {
    showWindow();
    if (item) send('focus-item', item.id);
  });
  n.show();
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  const enabled = Boolean(storage.settings.general.openAtLogin);
  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'ma-licence.desktop');
    if (enabled) {
      const exec = process.env.APPIMAGE || process.execPath;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Ma Licence\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ['--hidden'] });
  }
}

function initialPayload() {
  return {
    settings: storage.publicSettings(),
    status: engine.status,
    agenda: publicAgenda(storage.cache.agenda),
    version: app.getVersion(),
    platform: process.platform,
    presets: PRESETS,
  };
}

/** Wraps IPC handlers so errors reach the window as {error: message}. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

function registerIpc() {
  handle('init', () => initialPayload());
  handle('sync-now', () => engine.run('manual').then(() => true));

  handle('moodle-check', async (url) => MoodleClient.getPublicConfig(url, net.fetch));

  handle('moodle-login', async ({ url, method, username, password, token }) => {
    const cfg = await MoodleClient.getPublicConfig(url, net.fetch).catch((e) => {
      if (method === 'token') return { baseUrl: MoodleClient.normalizeBaseUrl(url), siteName: '' };
      throw e;
    });
    let creds;
    if (method === 'sso') creds = await ssoLogin(cfg, win);
    else if (method === 'password') creds = await MoodleClient.loginWithPassword(cfg.baseUrl, username, password, net.fetch);
    else if (method === 'token') creds = { token: String(token || '').trim() };
    else throw new Error('Méthode de connexion inconnue.');

    const client = new MoodleClient({ baseUrl: cfg.baseUrl, token: creds.token, fetchImpl: net.fetch });
    const info = await client.getSiteInfo().catch((e) => {
      throw e instanceof MoodleError && e.needsLogin ? new Error('Jeton refusé par Moodle.') : e;
    });
    storage.updateSettings({
      moodle: { baseUrl: cfg.baseUrl, siteName: info.siteName || cfg.siteName, userName: info.fullName, token: creds.token, loginMethod: method },
    });
    storage.cache.moodle = null;
    storage.saveCache();
    engine.run('login');
    return storage.publicSettings();
  });

  handle('moodle-logout', () => {
    storage.updateSettings({ moodle: { token: '', userName: '', loginMethod: '' } });
    storage.cache.moodle = null;
    engine.rebuild();
    return storage.publicSettings();
  });

  handle('mail-test', async (cfg) => {
    const password = cfg.password || storage.secret('mail', 'password');
    if (!password) throw new Error('Indique le mot de passe.');
    return testConnection({ ...cfg, password });
  });

  handle('ai-test', async (apiKey) => testApiKey(apiKey || storage.secret('ai', 'apiKey')));

  handle('save-settings', async (partial) => {
    // Empty secret fields mean "keep the saved one".
    if (partial.mail && !partial.mail.password) delete partial.mail.password;
    if (partial.ai && !partial.ai.apiKey) delete partial.ai.apiKey;
    const before = JSON.stringify({ mail: storage.settings.mail, ai: storage.settings.ai });
    const result = storage.updateSettings(partial);
    applyLoginItem();
    schedule();
    const after = JSON.stringify({ mail: storage.settings.mail, ai: storage.settings.ai });
    if (before !== after && isConfigured()) engine.run('settings');
    return result;
  });

  handle('set-done', (id, done) => {
    if (done) storage.state.done[id] = Date.now();
    else delete storage.state.done[id];
    return publicAgenda(engine.rebuild());
  });

  handle('hide-item', (id) => {
    storage.state.hiddenItems[id] = Date.now();
    return publicAgenda(engine.rebuild());
  });

  handle('set-course-hidden', (courseId, hidden) => {
    const set = new Set(storage.state.hiddenCourses);
    if (hidden) set.add(courseId);
    else set.delete(courseId);
    storage.state.hiddenCourses = [...set];
    const agenda = engine.rebuild();
    if (!hidden) engine.run('course-shown');
    return publicAgenda(agenda);
  });

  handle('open-file', async (fileId) => {
    const file = storage.cache.agenda && storage.cache.agenda.fileIndex[fileId];
    if (!file) throw new Error('Document introuvable, relance une synchronisation.');
    const courseName = (id) => {
      const c = ((storage.cache.moodle && storage.cache.moodle.courses) || []).find((x) => x.id === id);
      return c ? c.shortName || c.fullName : '';
    };
    const local = await ensureLocalFile(file, {
      client: engine.moodleClient(),
      filesDir: storage.filesDir,
      attachmentsDir: storage.attachmentsDir,
      courseName,
    });
    const err = await shell.openPath(local);
    if (err) throw new Error(err);
    return true;
  });

  handle('open-files-folder', async () => {
    fs.mkdirSync(storage.filesDir, { recursive: true });
    await shell.openPath(storage.filesDir);
    return true;
  });

  handle('open-external', async (url) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('Lien non pris en charge.');
    await shell.openExternal(url);
    return true;
  });

  handle('get-mail', (key) => {
    const m = (storage.cache.mailStore || {})[key];
    if (!m) throw new Error('Mail introuvable.');
    const files = (storage.cache.agenda && storage.cache.agenda.fileIndex) || {};
    return {
      subject: m.subject,
      from: m.from,
      date: m.date,
      text: m.text,
      attachments: Object.values(files).filter((f) => f.kind === 'mail' && f.mailKey === key),
    };
  });
}

app.whenReady().then(() => {
  storage = new Storage(app.getPath('userData'), safeStorage);
  engine = new SyncEngine({ storage, fetchImpl: (url, opts) => net.fetch(url, opts), notify });
  engine.on('status', (s) => send('sync-status', s));
  engine.on('data', (agenda) => send('data-updated', publicAgenda(agenda)));

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }

  registerIpc();
  createWindow();
  createTray();
  applyLoginItem();
  schedule();
  powerMonitor.on('resume', () => {
    if (isConfigured()) setTimeout(() => engine.run('resume'), 15000);
  });
  if (isConfigured()) setTimeout(() => engine.run('startup'), 1500);

  app.on('activate', showWindow);
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!tray) app.quit();
});
