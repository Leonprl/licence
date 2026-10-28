'use strict';

// Login through the university's web page (ENT / CAS / Shibboleth), exactly like the
// official Moodle app: open admin/tool/mobile/launch.php, let the student log in, then
// catch the "<scheme>://token=…" redirect that carries the app token.

const crypto = require('crypto');
const { BrowserWindow, session } = require('electron');
const { parseLaunchToken } = require('./moodle');

const SCHEME = 'moodlemobile';
// Universities with their own branded app replace "moodlemobile" by their own scheme
// (Moodle setting "forcedurlscheme"), so any custom scheme followed by "token=" is accepted.
const TOKEN_URL_RE = /^([a-z][a-z0-9+.-]*):\/\/token=/i;
const NOT_APP_SCHEMES = /^(https?|file|data|about|blob|javascript|chrome|devtools|ws|wss)$/i;
const LAUNCH_PATH = '/admin/tool/mobile/launch.php';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

/**
 * @param {{baseUrl: string, wwwroot: string, launchUrl: string, identityProviders?: {name, url}[]}} cfg
 *   from MoodleClient.getPublicConfig
 * @param {BrowserWindow} [parent]
 * @returns {Promise<{token: string, privateToken: string|null}>}
 */
function ssoLogin(cfg, parent) {
  const passport = crypto.randomBytes(16).toString('hex');
  const launch = new URL(cfg.launchUrl);
  launch.searchParams.set('service', 'moodle_mobile_app');
  launch.searchParams.set('passport', passport);
  launch.searchParams.set('urlscheme', SCHEME);
  const site = new URL(cfg.baseUrl);
  const sitePath = site.pathname.replace(/\/$/, '');

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
    let lastUrl = '';
    let loginPageTried = false;
    let identityProviderTried = false;
    let relaunches = 0;
    const providers = (cfg.identityProviders || []).filter((p) => /^https?:\/\//i.test(p.url || ''));
    const isLoginPath = (path) => /\/login\//.test(path);

    const finish = (err, value) => {
      if (finished) return;
      finished = true;
      if (!win.isDestroyed()) win.destroy();
      ses.clearStorageData().catch(() => {});
      if (err) reject(err);
      else resolve(value);
    };

    const tryUrl = (url) => {
      const m = TOKEN_URL_RE.exec(url || '');
      if (!m || NOT_APP_SCHEMES.test(m[1])) return false;
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

    const onSite = (url) => {
      try {
        const u = new URL(url);
        return u.host === site.host && u.pathname.startsWith(sitePath + '/');
      } catch {
        return false;
      }
    };

    const run = (js, fallback) => win.webContents.executeJavaScript(js).catch(() => fallback);

    const guard = (event, url) => {
      if (tryUrl(url)) event.preventDefault();
    };
    // Last URL of the current navigation chain, to know where a redirect comes from.
    let lastHop = '';
    win.webContents.on('did-start-navigation', (details, url) => {
      if (details && details.isMainFrame === false) return;
      lastHop = (details && details.url) || url || lastHop;
    });
    win.webContents.on('will-redirect', (e, url) => {
      const target = (e && e.url) || url;
      const from = lastHop;
      lastHop = target;
      if (tryUrl(target)) return e.preventDefault();
      // Older Moodle versions forget the app after a login started from the login page: when the login
      // page redirects into the site (login complete, still "just logged in"), go back to launch.php.
      if (loginPageTried && onSite(from) && isLoginPath(new URL(from).pathname) && onSite(target)) {
        const path = new URL(target).pathname;
        if (!isLoginPath(path) && !path.endsWith(LAUNCH_PATH) && relaunches < 2) {
          relaunches++;
          e.preventDefault();
          win.loadURL(launch.toString()).catch(() => {});
        }
      }
    });
    win.webContents.on('will-navigate', (e, url) => guard(e, url));
    win.webContents.on('will-frame-navigate', (details) => {
      if (tryUrl(details.url)) details.preventDefault();
    });
    win.webContents.on('did-fail-load', (_e, _code, _desc, url) => tryUrl(url));
    win.webContents.on('did-navigate', (_e, url) => {
      lastUrl = url;
    });

    win.webContents.on('did-finish-load', async () => {
      if (finished) return;
      const url = win.webContents.getURL();
      if (!onSite(url)) return;
      const path = new URL(url).pathname;

      if (path.endsWith(LAUNCH_PATH)) {
        const error = await run(
          "(document.querySelector('#launchapp') ? '' : ((document.querySelector('.errorbox, .alert-danger, .errormessage') || {}).textContent || ''))",
          ''
        );
        if (!error || !error.trim() || finished) return;
        // Sites set to "log in inside the app" refuse launch.php until the user has just logged in:
        // send the window to the login page; Moodle comes back to launch.php right after the login.
        if (!loginPageTried) {
          loginPageTried = true;
          const single = providers.length === 1;
          identityProviderTried = single;
          win.loadURL(single ? providers[0].url : `${cfg.baseUrl}/login/index.php`).catch(() => {});
          return;
        }
        finish(
          new Error(
            `Moodle refuse de donner l'accès à l'appli (« ${error.trim().slice(0, 160)} »). Essaie avec ton identifiant et ton mot de passe Moodle, ou avec un jeton.`
          )
        );
        return;
      }

      // Moodle's own login page while the site uses a single university login (CAS…): go straight to it.
      if (isLoginPath(path) && providers.length === 1 && !identityProviderTried && !new URL(url).searchParams.has('ticket')) {
        identityProviderTried = true;
        win.loadURL(providers[0].url).catch(() => {});
        return;
      }

      // Logged in but left on another Moodle page (dashboard…): ask for the token again.
      if (!isLoginPath(path) && relaunches < 2) {
        const userId = Number(await run('(window.M && M.cfg && M.cfg.userId) || 0', 0));
        if (userId > 0 && !finished) {
          relaunches++;
          win.loadURL(launch.toString()).catch(() => {});
        }
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
    win.on('closed', () => {
      let where = '';
      try {
        const u = new URL(lastUrl);
        where = ` Dernière page : ${u.host}${u.pathname}.`;
      } catch {}
      finish(new Error(`La connexion n'a pas abouti (fenêtre fermée avant la fin).${where}`));
    });
    win.loadURL(launch.toString()).catch(() => {});
  });
}

module.exports = { ssoLogin, TOKEN_URL_RE };
