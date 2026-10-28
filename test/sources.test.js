'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectMailSettings, parseAutoconfig } = require('../src/main/mail-detect');
const { parseIcs, parseIcsDate } = require('../src/main/ics');
const { extractFromMessage } = require('../src/main/extract');

const noFetch = async () => ({ ok: false, text: async () => '' });

test('finds the Sorbonne Université mail server from the address', async () => {
  const r = await detectMailSettings('lea.martin@etu.sorbonne-universite.fr', { fetchImpl: noFetch });
  assert.equal(r.host, 'imaps.sorbonne-universite.fr');
  assert.equal(r.port, 993);
  assert.equal(r.secure, true);
  assert.match(r.provider, /Sorbonne/);
});

test('uses MX records for Google and Microsoft hosted domains', async () => {
  const google = await detectMailSettings('x@sorbonne-nouvelle.fr', { fetchImpl: noFetch, resolveMx: async () => [{ exchange: 'ASPMX.L.GOOGLE.COM' }] });
  assert.equal(google.host, 'imap.gmail.com');
  assert.match(google.note, /mot de passe d’application/);
  const ms = await detectMailSettings('x@univ-exemple.fr', { fetchImpl: noFetch, resolveMx: async () => [{ exchange: 'univ-exemple-fr.mail.protection.outlook.com' }] });
  assert.equal(ms.host, 'outlook.office365.com');
});

test('reads Thunderbird autoconfig files, then falls back to a guess', async () => {
  const xml = `<clientConfig><emailProvider id="u.fr"><incomingServer type="pop3"><hostname>pop.u.fr</hostname></incomingServer>
    <incomingServer type="imap"><hostname>mail.u.fr</hostname><port>143</port><socketType>STARTTLS</socketType></incomingServer></emailProvider></clientConfig>`;
  assert.deepEqual(parseAutoconfig(xml), { host: 'mail.u.fr', port: 143, secure: false });
  const fetchImpl = async (url) => ({ ok: url.includes('thunderbird'), text: async () => xml });
  const r = await detectMailSettings('a@u.fr', { fetchImpl, resolveMx: async () => [{ exchange: 'mx1.relay.renater.fr' }] });
  assert.equal(r.host, 'mail.u.fr');
  const guess = await detectMailSettings('a@inconnu.fr', { fetchImpl: noFetch });
  assert.equal(guess.host, 'imap.inconnu.fr');
  assert.equal(guess.source, 'guess');
  await assert.rejects(detectMailSettings('pas-une-adresse', {}), /invalide/);
});

test('reads timetable calendars (.ics)', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'DTSTART;TZID=Europe/Paris:20261112T140000',
    'DTEND;TZID=Europe/Paris:20261112T160000',
    'SUMMARY:EXAMEN TERMINAL - Macroéconomie',
    'LOCATION:Amphi B',
    'DESCRIPTION:Groupe 1\\nApporter sa carte\\, merci',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:2',
    'DTSTART;VALUE=DATE:20261120',
    'SUMMARY:Rendu du dossier de statis',
    ' tiques',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:3',
    'DTSTART:20261113T080000Z',
    'SUMMARY:CM Histoire',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const ev = parseIcs(ics);
  assert.equal(ev.length, 3);
  const d = new Date(ev[0].start);
  assert.deepEqual([d.getMonth(), d.getDate(), d.getHours()], [10, 12, 14]);
  assert.equal(ev[0].end - ev[0].start, 2 * 3600 * 1000);
  assert.equal(ev[0].description, 'Groupe 1\nApporter sa carte, merci');
  assert.equal(ev[1].allDay, true);
  assert.equal(ev[1].summary, 'Rendu du dossier de statistiques');
  assert.equal(ev[2].start, Date.UTC(2026, 10, 13, 8));
  assert.equal(parseIcsDate('nope'), null);
});

test('course pages: only explicit dates with an exam or hand-in word count', () => {
  const ref = new Date(2026, 9, 28).getTime();
  const page = [
    'Bienvenue dans le cours. Les TD ont lieu le jeudi.',
    'Contrôle continu n°1 : le 18 novembre en amphi C.',
    'Le dossier est à rendre le 4 décembre.',
    'Séance du 9 novembre annulée.',
  ].join('\n');
  const r = extractFromMessage({ subject: 'Informations', text: page, date: ref }, { strict: true });
  assert.deepEqual(r.events.map((e) => e.type), ['exam', 'deadline']);
  assert.equal(new Date(r.events[0].start).getDate(), 18);
  const loose = extractFromMessage({ subject: 'Informations', text: page, date: ref });
  assert.ok(loose.events.length > 2, 'non-strict mode also keeps weekdays and infos');
});
