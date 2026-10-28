'use strict';

// Settings, cached data and user state, stored as JSON files in the app data folder.
// Passwords and tokens are encrypted with the OS keychain (Electron safeStorage) when available.

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  moodle: { baseUrl: '', siteName: '', userName: '', token: '', loginMethod: '' },
  mail: {
    enabled: false,
    preset: 'custom',
    email: '',
    provider: '',
    host: '',
    port: 993,
    secure: true,
    user: '',
    password: '',
    mailboxes: ['INBOX'],
    sinceDays: 30,
    senderFilter: '',
  },
  ai: { enabled: false, apiKey: '' },
  // Timetable links (.ics): [{url, name, all}]
  calendars: [],
  general: { syncMinutes: 20, openAtLogin: true, notifications: true, closeToTray: true, reminderHours: 24 },
};

const SECRET_PATHS = [
  ['moodle', 'token'],
  ['mail', 'password'],
  ['ai', 'apiKey'],
];

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

class Storage {
  /**
   * @param {string} dir data folder
   * @param {{isEncryptionAvailable(): boolean, encryptString(s): Buffer, decryptString(b): string}} [safeStorage]
   */
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    fs.mkdirSync(dir, { recursive: true });
    this.settings = deepMerge(DEFAULT_SETTINGS, this._read('settings.json', {}));
    this.cache = this._read('cache.json', {});
    this.state = deepMerge({ done: {}, hiddenItems: {}, hiddenCourses: [], fileFirstSeen: {}, notified: {} }, this._read('state.json', {}));
  }

  get filesDir() {
    return path.join(this.dir, 'fichiers');
  }

  get attachmentsDir() {
    return path.join(this.dir, 'pieces-jointes');
  }

  _read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  _write(name, data) {
    const file = path.join(this.dir, name);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  _encrypt(value) {
    if (!value) return '';
    if (this.safe && this.safe.isEncryptionAvailable()) return `enc:${this.safe.encryptString(value).toString('base64')}`;
    return `plain:${Buffer.from(value, 'utf8').toString('base64')}`;
  }

  _decrypt(stored) {
    if (!stored) return '';
    try {
      if (stored.startsWith('enc:')) return this.safe.decryptString(Buffer.from(stored.slice(4), 'base64'));
      if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
    } catch {
      return '';
    }
    return stored;
  }

  /** Returns a secret in clear text, e.g. secret('mail', 'password'). */
  secret(section, key) {
    return this._decrypt(this.settings[section][key]);
  }

  /** Merges a partial settings object. Secrets given in clear text are encrypted before saving. */
  updateSettings(partial) {
    const copy = JSON.parse(JSON.stringify(partial || {}));
    for (const [section, key] of SECRET_PATHS) {
      if (copy[section] && typeof copy[section][key] === 'string') {
        copy[section][key] = this._encrypt(copy[section][key]);
      }
    }
    this.settings = deepMerge(this.settings, copy);
    this._write('settings.json', this.settings);
    return this.publicSettings();
  }

  /** Settings safe to send to the window: secrets replaced by booleans. */
  publicSettings() {
    const s = JSON.parse(JSON.stringify(this.settings));
    for (const [section, key] of SECRET_PATHS) {
      s[section][`has${key[0].toUpperCase()}${key.slice(1)}`] = Boolean(s[section][key]);
      delete s[section][key];
    }
    // On Linux without a keyring Electron falls back to a fixed key ("basic_text"): not real protection.
    const backend = this.safe && this.safe.getSelectedStorageBackend ? this.safe.getSelectedStorageBackend() : '';
    s.encryption = Boolean(this.safe && this.safe.isEncryptionAvailable()) && backend !== 'basic_text';
    return s;
  }

  saveCache() {
    this._write('cache.json', this.cache);
  }

  saveState() {
    this._write('state.json', this.state);
  }
}

module.exports = { Storage, DEFAULT_SETTINGS, deepMerge };
