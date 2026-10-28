'use strict';

// Orchestrates one synchronisation: Moodle + e-mails → extraction → agenda → notifications.

const { EventEmitter } = require('events');
const { MoodleClient, MoodleError } = require('./moodle');
const { fetchMails } = require('./mail');
const { extractFromMessage, looksAcademic } = require('./extract');
const { extractWithClaude } = require('./ai');
const { buildAgenda, updateFileFirstSeen } = require('./agenda');
const { dayKey } = require('./util');

const DAY = 24 * 3600 * 1000;
// Bump when the rule-based extractor changes, so cached results are recomputed.
const RULES_VERSION = 'rules-4';
const AI_VERSION = 'ai-1';
const MAX_AI_CALLS_PER_SYNC = 40;

const TYPE_LABELS = { exam: 'Examen', quiz: 'Test en ligne', deadline: 'À rendre', info: 'Info', event: 'Événement' };

function formatWhen(item) {
  const d = new Date(item.start);
  const date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (item.allDay) return date;
  return `${date} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

class SyncEngine extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./storage').Storage} deps.storage
   * @param {Function} [deps.fetchImpl]  fetch used for Moodle (Electron's net.fetch in the app)
   * @param {Function} [deps.notify]     (title, body, item) => void
   * @param {Function} [deps.now]
   */
  constructor({ storage, fetchImpl, notify = () => {}, now = () => Date.now() }) {
    super();
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.notify = notify;
    this.now = now;
    this.running = null;
    this.status = { state: 'idle', step: '', lastSync: storage.cache.lastSync || null, errors: storage.cache.lastErrors || {} };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  /** Runs a sync, or returns the one already running. */
  run(reason = 'manual') {
    if (!this.running) {
      this.running = this._run(reason)
        .catch((e) => {
          this.setStatus({ state: 'error', step: '', errors: { general: `Erreur inattendue : ${e.message}` } });
          return this.storage.cache.agenda || null;
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  moodleClient() {
    const s = this.storage.settings.moodle;
    const token = this.storage.secret('moodle', 'token');
    if (!s.baseUrl || !token) return null;
    return new MoodleClient({ baseUrl: s.baseUrl, token, fetchImpl: this.fetchImpl });
  }

  async _run(reason) {
    const { storage } = this;
    const cache = storage.cache;
    const settings = storage.settings;
    const now = this.now();
    const errors = {};
    this.setStatus({ state: 'running', step: 'Démarrage…' });
    const onProgress = (step) => this.setStatus({ step });

    // Moodle
    const client = this.moodleClient();
    if (client) {
      try {
        cache.moodle = await client.fetchSnapshot({ now, hiddenCourseIds: storage.state.hiddenCourses, onProgress });
        if (cache.moodle.warnings.length) errors.moodleWarnings = cache.moodle.warnings.slice(0, 5);
      } catch (e) {
        errors.moodle = e instanceof MoodleError && e.needsLogin ? 'Session Moodle expirée : reconnecte-toi dans les réglages.' : e.message;
        if (e instanceof MoodleError && e.needsLogin) errors.moodleLogin = true;
      }
    }

    // E-mails
    const mailCfg = settings.mail;
    if (mailCfg.enabled && mailCfg.host && mailCfg.user) {
      try {
        cache.mailStore = cache.mailStore || {};
        const mails = await fetchMails(
          { ...mailCfg, password: storage.secret('mail', 'password') },
          { cache: cache.mailStore, attachmentsDir: storage.attachmentsDir, now, onProgress }
        );
        cache.mails = mails.map((m) => m.key);
        // Forget messages that left the time window.
        const keep = new Set(cache.mails);
        for (const k of Object.keys(cache.mailStore)) {
          if (!keep.has(k) && cache.mailStore[k].date < now - (Number(mailCfg.sinceDays) || 30) * DAY) delete cache.mailStore[k];
        }
      } catch (e) {
        errors.mail = e.message;
      }
    }

    // Extraction (cached per message)
    await this.extractAll(onProgress, errors);

    // Agenda
    onProgress('Mise à jour du tableau');
    updateFileFirstSeen(cache.moodle, storage.state, now);
    const previousIds = new Set(((cache.agenda && cache.agenda.items) || []).map((i) => i.id));
    const firstBuild = !cache.agenda;
    cache.agenda = buildAgenda({
      snapshot: cache.moodle || null,
      mails: this.mails(),
      extractions: cache.extractions || {},
      state: storage.state,
      now,
    });
    cache.lastSync = now;
    cache.lastErrors = errors;
    storage.saveCache();

    if (!firstBuild) this.notifyChanges(previousIds, now);
    this.remindSoon(now);
    storage.saveState();

    this.setStatus({ state: Object.keys(errors).some((k) => !k.endsWith('Warnings')) ? 'error' : 'ok', step: '', lastSync: now, errors, reason });
    this.emit('data', cache.agenda);
    return cache.agenda;
  }

  /** Recomputes the agenda from cached data (after ticking an item, hiding a course…). */
  rebuild() {
    const { storage } = this;
    storage.cache.agenda = buildAgenda({
      snapshot: storage.cache.moodle || null,
      mails: this.mails(),
      extractions: storage.cache.extractions || {},
      state: storage.state,
      now: this.now(),
    });
    storage.saveCache();
    storage.saveState();
    this.emit('data', storage.cache.agenda);
    return storage.cache.agenda;
  }

  mails() {
    const store = this.storage.cache.mailStore || {};
    return (this.storage.cache.mails || []).map((k) => store[k]).filter(Boolean);
  }

  async extractAll(onProgress, errors) {
    const { storage } = this;
    const cache = storage.cache;
    cache.extractions = cache.extractions || {};
    const ai = storage.settings.ai;
    const apiKey = ai.enabled ? storage.secret('ai', 'apiKey') : '';
    const wanted = apiKey ? AI_VERSION : RULES_VERSION;
    const courseNames = ((cache.moodle && cache.moodle.courses) || []).map((c) => c.fullName);

    const sources = [];
    for (const m of this.mails()) {
      sources.push({ key: m.key, msg: { subject: m.subject, text: m.text, date: m.date, from: `${m.from.name || ''} <${m.from.address || ''}>` } });
    }
    for (const a of (cache.moodle && cache.moodle.announcements) || []) {
      sources.push({ key: `ann:${a.id}:${a.time}`, msg: { subject: a.subject, text: a.message, date: a.created || a.time, from: a.author } });
    }

    const fresh = {};
    let aiCalls = 0;
    let aiError = null;
    for (const { key, msg } of sources) {
      const prev = cache.extractions[key];
      if (prev && prev.version === wanted) {
        fresh[key] = prev;
        continue;
      }
      let result = null;
      if (apiKey && aiCalls < MAX_AI_CALLS_PER_SYNC && looksAcademic(msg)) {
        aiCalls++;
        onProgress(`Analyse IA des messages (${aiCalls})`);
        try {
          result = { ...(await extractWithClaude({ apiKey, msg, courseNames })), version: AI_VERSION };
        } catch (e) {
          aiError = e.message;
        }
      }
      if (!result) {
        // Without AI (or if it failed) use the rules; keep the rules version so AI retries next time.
        result = { ...extractFromMessage(msg), version: apiKey && looksAcademic(msg) ? RULES_VERSION + '+retry' : wanted };
      }
      fresh[key] = result;
    }
    cache.extractions = fresh;
    if (aiError) errors.ai = `Analyse IA : ${aiError}`;
  }

  notifyChanges(previousIds, now) {
    if (!this.storage.settings.general.notifications) return;
    const items = this.storage.cache.agenda.items.filter((i) => !previousIds.has(i.id) && i.status === 'todo' && i.start > now);
    const important = items.filter((i) => i.family !== 'info' || i.type === 'info');
    for (const item of important.slice(0, 5)) {
      this.notify(`Nouveau · ${TYPE_LABELS[item.type] || 'Échéance'}${item.courseShort ? ` · ${item.courseShort}` : ''}`, `${item.title}\n${formatWhen(item)}`, item);
    }
    if (important.length > 5) this.notify('Ma Licence', `${important.length - 5} autres nouveautés dans ton tableau.`);
    const newFiles = this.storage.cache.agenda.news.filter((n) => n.kind === 'files' && n.time >= now - 5 * 60 * 1000);
    for (const group of newFiles.slice(0, 3)) {
      const names = group.files.slice(0, 3).map((f) => f.name).join(', ');
      this.notify(`Nouveaux documents${group.courseShort ? ` · ${group.courseShort}` : ''}`, names + (group.files.length > 3 ? '…' : ''));
    }
  }

  /** One reminder per item when it gets close (default: 24 h before). */
  remindSoon(now) {
    const { state, settings } = this.storage;
    if (!settings.general.notifications) return;
    const horizon = (Number(settings.general.reminderHours) || 24) * 3600 * 1000;
    for (const item of this.storage.cache.agenda.items) {
      if (item.status !== 'todo' || item.family === 'info') continue;
      const when = item.allDay ? new Date(dayKey(item.start) + 'T08:00:00').getTime() : item.start;
      if (when < now || when - now > horizon) continue;
      const key = `remind:${item.id}`;
      if (state.notified[key]) continue;
      state.notified[key] = now;
      this.notify(`Rappel · ${TYPE_LABELS[item.type] || 'Échéance'}${item.courseShort ? ` · ${item.courseShort}` : ''}`, `${item.title}\n${formatWhen(item)}`, item);
    }
    for (const [k, t] of Object.entries(state.notified)) if (t < now - 60 * DAY) delete state.notified[k];
  }
}

module.exports = { SyncEngine, RULES_VERSION, TYPE_LABELS };
