'use strict';

// Login through the university's web page (ENT / CAS / Shibboleth), exactly like the
// official Moodle app: open admin/tool/mobile/launch.php, let the student log in, then
// catch the "moodlemobile://token=…" redirect that carries the app token.

const crypto = require('crypto');
const { BrowserWindow, session } = require('electron');
const { parseLaunchToken } = require('./moodle');

const SCHEME = 'moodlemobile';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

/**
 * @param {{baseUrl: string, wwwroot: string, launchUrl: string}} cfg  from MoodleClient.getPublicConfig
 * @param {BrowserWindow} [parent]
 * @returns {Promise<{token: string, privateToken: string|null}>}
 */
function ssoLogin(cfg, parent) {
  const passport = crypto.randomBytes(16).toString('hex');
  const launch = new URL(cfg.launchUrl);
  launch.searchParams.set('service', 'moodle_mobile_app');
  launch.searchParams.set('passport', passport);
  launch.searchParams.set('urlscheme', SCHEME);

  // A fresh in-memory session: Moodle only hands out the token right after a real login.
  const partition = `sso-${Date.now()}`;
  const ses = session.fromPartition(partition, { cache: false });

  const win = new BrowserWindow({
    parent,
    modal: Boolean(parent),
    width: 960,
    height: 760,
    title: 'Connexion à Moodle',
    autoHideMenuBar: true,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (err, value) => {
      if (finished) return;
      finished = true;
      if (!win.isDestroyed()) win.destroy();
      ses.clearStorageData().catch(() => {});
      if (err) reject(err);
      else resolve(value);
    };

    const tryUrl = (url) => {
      if (!url || !url.toLowerCase().startsWith(`${SCHEME}://`)) return false;
      const parsed = parseLaunchToken(url);
      if (!parsed) {
        finish(new Error('Réponse de Moodle illisible.'));
        return true;
      }
      const expected = [md5(cfg.wwwroot + passport), md5(cfg.baseUrl + passport)];
      if (!expected.includes(parsed.signature)) {
        finish(new Error('Signature de connexion invalide.'));
        return true;
      }
      finish(null, { token: parsed.token, privateToken: parsed.privateToken });
      return true;
    };

    const guard = (event, url) => {
      if (tryUrl(url)) event.preventDefault();
    };
    win.webContents.on('will-redirect', (e, url) => guard(e, url));
    win.webContents.on('will-navigate', (e, url) => guard(e, url));
    win.webContents.on('will-frame-navigate', (details) => {
      if (tryUrl(details.url)) details.preventDefault();
    });
    win.webContents.on('did-fail-load', (_e, _code, _desc, url) => tryUrl(url));
    // If launch.php itself shows an error (site only allows in-app login), say so instead of leaving an error page open.
    win.webContents.on('did-finish-load', async () => {
      if (finished || !win.webContents.getURL().includes('/admin/tool/mobile/launch.php')) return;
      const error = await win.webContents
        .executeJavaScript("(document.querySelector('#launchapp') ? '' : ((document.querySelector('.errorbox, .alert-danger, .errormessage') || {}).textContent || ''))")
        .catch(() => '');
      if (error && error.trim()) {
        finish(
          new Error(
            `Ce Moodle n'autorise pas la connexion par la page de l'université (« ${error.trim().slice(0, 120)} »). Utilise ton identifiant et ton mot de passe Moodle, ou un jeton.`
          )
        );
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      tryUrl(url);
      return { action: 'deny' };
    });
    // Chromium asks for permission before handing a custom scheme to the OS.
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      if (permission === 'openExternal' && details && tryUrl(details.externalURL)) return callback(false);
      callback(false);
    });
    win.on('closed', () => finish(new Error('Fenêtre de connexion fermée.')));
    win.loadURL(launch.toString()).catch(() => {});
  });
}

module.exports = { ssoLogin };
