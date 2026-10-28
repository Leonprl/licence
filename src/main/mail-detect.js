'use strict';

// Finds the IMAP server from an e-mail address, like Thunderbird does:
// known providers first, then the domain's MX records, then the Thunderbird
// autoconfig database and the domain's own autoconfig file, then a best guess.

const KNOWN = [
  {
    // Students: prenom.nom@etu.sorbonne-universite.fr. Server given by the DSI's mail-app guides.
    domains: ['sorbonne-universite.fr'],
    settings: { host: 'imaps.sorbonne-universite.fr', port: 993, secure: true },
    provider: 'Sorbonne Université (Zimbra)',
    note: "Mot de passe : celui de ton compte Sorbonne (ENT). Si l'adresse est refusée, mets ton identifiant Sorbonne dans « Identifiant de connexion ».",
  },
  { domains: ['gmail.com', 'googlemail.com'], settings: { host: 'imap.gmail.com', port: 993, secure: true }, provider: 'Gmail', kind: 'google' },
  {
    domains: ['outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com'],
    settings: { host: 'outlook.office365.com', port: 993, secure: true },
    provider: 'Outlook',
    kind: 'microsoft',
  },
  { domains: ['yahoo.com', 'yahoo.fr', 'ymail.com'], settings: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, provider: 'Yahoo', note: 'Il faut un mot de passe d’application Yahoo.' },
  { domains: ['orange.fr', 'wanadoo.fr'], settings: { host: 'imap.orange.fr', port: 993, secure: true }, provider: 'Orange' },
  { domains: ['free.fr'], settings: { host: 'imap.free.fr', port: 993, secure: true }, provider: 'Free' },
  { domains: ['laposte.net'], settings: { host: 'imap.laposte.net', port: 993, secure: true }, provider: 'La Poste' },
  { domains: ['icloud.com', 'me.com', 'mac.com'], settings: { host: 'imap.mail.me.com', port: 993, secure: true }, provider: 'iCloud', note: 'Il faut un mot de passe d’application Apple.' },
];

const GOOGLE_NOTE =
  "Boîte hébergée par Google : il faut un « mot de passe d’application » (myaccount.google.com/apppasswords). Si ton établissement l'interdit, la lecture des mails ne sera pas possible.";
const MICROSOFT_NOTE =
  "Boîte hébergée par Microsoft 365 : beaucoup d'établissements bloquent la connexion par mot de passe. Si ça échoue, transfère automatiquement tes mails vers une adresse Gmail et connecte ce Gmail.";

function domainOf(email) {
  const m = String(email || '').trim().toLowerCase().match(/^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

function findKnown(domain) {
  return KNOWN.find((k) => k.domains.some((d) => domain === d || domain.endsWith(`.${d}`)));
}

/** Reads the first IMAP server of a Thunderbird autoconfig XML file. */
function parseAutoconfig(xml) {
  const block = String(xml || '').match(/<incomingServer[^>]*type="imap"[^>]*>([\s\S]*?)<\/incomingServer>/i);
  if (!block) return null;
  const tag = (name) => {
    const m = block[1].match(new RegExp(`<${name}>([^<]+)</${name}>`, 'i'));
    return m ? m[1].trim() : '';
  };
  const host = tag('hostname');
  if (!host || host.includes('%')) return null;
  const socket = tag('socketType').toUpperCase();
  return { host, port: Number(tag('port')) || 993, secure: socket !== 'STARTTLS' && socket !== 'PLAIN' };
}

/**
 * @param {string} email
 * @param {{fetchImpl?: Function, resolveMx?: (domain: string) => Promise<{exchange: string}[]>}} deps
 * @returns {Promise<{host, port, secure, provider, note, source}>}
 */
async function detectMailSettings(email, { fetchImpl = globalThis.fetch, resolveMx } = {}) {
  const domain = domainOf(email);
  if (!domain) throw new Error('Adresse e-mail invalide.');

  const known = findKnown(domain);
  if (known) {
    const note = known.note || (known.kind === 'google' ? GOOGLE_NOTE : known.kind === 'microsoft' ? MICROSOFT_NOTE : '');
    return { ...known.settings, provider: known.provider, note, source: 'known' };
  }

  let mx = [];
  if (resolveMx) {
    try {
      mx = (await resolveMx(domain)).map((r) => String(r.exchange).toLowerCase());
    } catch {
      mx = [];
    }
  }
  if (mx.some((h) => /(google|googlemail)\.com$/.test(h))) {
    return { host: 'imap.gmail.com', port: 993, secure: true, provider: 'Google (Gmail)', note: GOOGLE_NOTE, source: 'mx' };
  }
  if (mx.some((h) => /(outlook\.com|office365\.us|protection\.outlook\.com)$/.test(h))) {
    return { host: 'outlook.office365.com', port: 993, secure: true, provider: 'Microsoft 365', note: MICROSOFT_NOTE, source: 'mx' };
  }

  const tryXml = async (url) => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      return parseAutoconfig(await res.text());
    } catch {
      return null;
    }
  };
  const fromDb =
    (await tryXml(`https://autoconfig.thunderbird.net/v1.1/${domain}`)) ||
    (await tryXml(`https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`));
  if (fromDb) return { ...fromDb, provider: domain, note: '', source: 'autoconfig' };

  return {
    host: `imap.${domain}`,
    port: 993,
    secure: true,
    provider: domain,
    note: `Serveur deviné (imap.${domain}) : si la connexion échoue, cherche « IMAP » dans l'aide de ta messagerie et corrige-le dans les réglages avancés.`,
    source: 'guess',
  };
}

module.exports = { detectMailSettings, parseAutoconfig, domainOf };
