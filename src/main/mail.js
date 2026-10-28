'use strict';

// Reads recent e-mails over IMAP. Messages already downloaded are kept in the
// cache (keyed by mailbox + UIDVALIDITY + UID), so each sync only downloads new mail.

const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { htmlToText, safeFileName, shortHash } = require('./util');

const DAY = 24 * 3600 * 1000;
// Attachments worth keeping: course documents, not signatures or logos.
const DOC_EXT = /\.(pdf|docx?|odt|pptx?|odp|xlsx?|ods|txt|rtf|zip|csv|py|r|ipynb|java|c|cpp|tex)$/i;

const PRESETS = {
  gmail: { host: 'imap.gmail.com', port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
  orange: { host: 'imap.orange.fr', port: 993, secure: true },
  free: { host: 'imap.free.fr', port: 993, secure: true },
  laposte: { host: 'imap.laposte.net', port: 993, secure: true },
};

function friendlyImapError(e, host) {
  const msg = String((e && (e.responseText || e.message)) || e);
  if (e && (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(msg))) {
    if (/office365|outlook/i.test(host)) {
      return "Connexion refusée. Les comptes Microsoft 365 n'acceptent souvent plus le mot de passe en IMAP : voir le README (transfert vers Gmail).";
    }
    if (/gmail/i.test(host)) {
      return 'Connexion refusée. Pour Gmail, il faut un « mot de passe d’application » (voir le README), pas ton mot de passe habituel.';
    }
    return 'Identifiant ou mot de passe refusé par le serveur mail.';
  }
  if (e && (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN')) return `Serveur mail introuvable : ${host}.`;
  if (e && (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET')) return `Le serveur mail ${host} ne répond pas (port bloqué ?).`;
  if (e && /certificate|self[- ]signed/i.test(msg)) return `Certificat TLS du serveur ${host} invalide.`;
  return `Erreur mail : ${msg}`;
}

function makeClient(cfg) {
  return new ImapFlow({
    host: cfg.host,
    port: Number(cfg.port) || 993,
    secure: cfg.secure !== false,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    socketTimeout: 90 * 1000,
    connectionTimeout: 30 * 1000,
  });
}

async function testConnection(cfg) {
  const client = makeClient(cfg);
  try {
    await client.connect();
    const boxes = (cfg.mailboxes && cfg.mailboxes.length ? cfg.mailboxes : ['INBOX']);
    const result = [];
    for (const box of boxes) {
      const status = await client.status(box, { messages: true });
      result.push({ mailbox: box, messages: status.messages });
    }
    return result;
  } catch (e) {
    throw new Error(friendlyImapError(e, cfg.host));
  } finally {
    await client.logout().catch(() => {});
  }
}

function matchesSenderFilter(from, filter) {
  const parts = String(filter || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return true;
  const addr = `${from.name || ''} ${from.address || ''}`.toLowerCase();
  return parts.some((p) => addr.includes(p));
}

async function parseMessage(source, { key, uid, mailbox, flags, attachmentsDir }) {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const fromObj = (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
  const text = (parsed.text && parsed.text.trim()) || htmlToText(parsed.html || '');
  const date = parsed.date ? parsed.date.getTime() : Date.now();
  const attachments = [];
  const docs = (parsed.attachments || []).filter((a) => a.filename && DOC_EXT.test(a.filename) && a.content);
  if (docs.length && attachmentsDir) {
    const dir = path.join(attachmentsDir, shortHash(key, 16));
    fs.mkdirSync(dir, { recursive: true });
    for (const a of docs) {
      const name = safeFileName(a.filename);
      const file = path.join(dir, name);
      fs.writeFileSync(file, a.content);
      attachments.push({ name, mimetype: a.contentType || '', size: a.size || a.content.length, path: file });
    }
  }
  return {
    key,
    uid,
    mailbox,
    messageId: parsed.messageId || key,
    subject: parsed.subject || '(sans objet)',
    from: { name: fromObj.name || '', address: fromObj.address || '' },
    date,
    seen: Boolean(flags && flags.has && flags.has('\\Seen')),
    text: text.slice(0, 40000),
    attachments,
  };
}

/**
 * Fetches e-mails received in the last `cfg.sinceDays` days.
 * @param {object} cfg  {host, port, secure, user, password, mailboxes, sinceDays, maxMessages, senderFilter}
 * @param {object} opts {cache: {key: mail}, attachmentsDir, now, onProgress}
 * @returns {Promise<object[]>} mails, newest first
 */
async function fetchMails(cfg, { cache = {}, attachmentsDir, now = Date.now(), onProgress = () => {} } = {}) {
  const sinceDays = Number(cfg.sinceDays) || 30;
  const maxMessages = Number(cfg.maxMessages) || 300;
  const boxes = cfg.mailboxes && cfg.mailboxes.length ? cfg.mailboxes : ['INBOX'];
  const client = makeClient(cfg);
  const out = [];
  try {
    onProgress('Mails : connexion');
    await client.connect();
    for (const mailbox of boxes) {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const uidValidity = String(client.mailbox.uidValidity);
        const since = new Date(now - sinceDays * DAY);
        const uids = ((await client.search({ since }, { uid: true })) || []).sort((a, b) => a - b).slice(-maxMessages);
        const keyOf = (uid) => `${mailbox}:${uidValidity}:${uid}`;
        const missing = uids.filter((uid) => !cache[keyOf(uid)]);
        let done = 0;
        if (missing.length) {
          for await (const msg of client.fetch(missing, { uid: true, source: true, flags: true }, { uid: true })) {
            done++;
            if (done % 10 === 0) onProgress(`Mails : ${done}/${missing.length} nouveaux`);
            const key = keyOf(msg.uid);
            try {
              cache[key] = await parseMessage(msg.source, { key, uid: msg.uid, mailbox, flags: msg.flags, attachmentsDir });
            } catch (e) {
              cache[key] = { key, uid: msg.uid, mailbox, subject: '(message illisible)', from: {}, date: now, text: '', attachments: [], error: e.message };
            }
          }
        }
        for (const uid of uids) {
          const m = cache[keyOf(uid)];
          if (m && matchesSenderFilter(m.from || {}, cfg.senderFilter)) out.push(m);
        }
      } finally {
        lock.release();
      }
    }
  } catch (e) {
    throw new Error(friendlyImapError(e, cfg.host));
  } finally {
    await client.logout().catch(() => {});
  }
  return out.sort((a, b) => b.date - a.date);
}

module.exports = { fetchMails, testConnection, matchesSenderFilter, PRESETS, friendlyImapError };
