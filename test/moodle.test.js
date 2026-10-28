'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { MoodleClient, MoodleError, flattenParams, normalizeBaseUrl, parseLaunchToken } = require('../src/main/moodle');
const { fakeMoodle } = require('./helpers');

test('flattens nested parameters like Moodle expects', () => {
  const p = flattenParams({ events: { courseids: [3, 4] }, options: { userevents: true, timestart: 10 } }, '', new URLSearchParams());
  assert.equal(p.toString(), 'events%5Bcourseids%5D%5B0%5D=3&events%5Bcourseids%5D%5B1%5D=4&options%5Buserevents%5D=1&options%5Btimestart%5D=10');
});

test('normalizes pasted Moodle addresses', () => {
  assert.equal(normalizeBaseUrl('moodle.univ.fr'), 'https://moodle.univ.fr');
  assert.equal(normalizeBaseUrl('https://moodle.univ.fr/login/index.php'), 'https://moodle.univ.fr');
  assert.equal(normalizeBaseUrl('https://ent.univ.fr/moodle/course/view.php?id=4'), 'https://ent.univ.fr/moodle');
  assert.equal(normalizeBaseUrl('https://moodle.univ.fr/my/'), 'https://moodle.univ.fr');
  assert.throws(() => normalizeBaseUrl(''), MoodleError);
});

test('reports an expired token as needing login', async () => {
  const { fetchImpl, base } = fakeMoodle();
  const c = new MoodleClient({ baseUrl: base, token: 'wrong', fetchImpl });
  await assert.rejects(c.getSiteInfo(), (e) => e instanceof MoodleError && e.needsLogin);
});

test('adds the token to file URLs only for the Moodle host', () => {
  const c = new MoodleClient({ baseUrl: 'https://moodle.univ.fr', token: 'abc' });
  assert.equal(
    c.authFileUrl('https://moodle.univ.fr/pluginfile.php/1/mod_resource/content/1/a.pdf'),
    'https://moodle.univ.fr/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf?token=abc'
  );
  assert.throws(() => c.authFileUrl('https://evil.example.com/pluginfile.php/1/a.pdf'), MoodleError);
});

test('decodes the SSO launch token', () => {
  const sig = crypto.createHash('md5').update('https://moodle.univ.fr' + 'pass').digest('hex');
  const token = 'a'.repeat(32);
  const url = `moodlemobile://token=${Buffer.from(`${sig}:::${token}:::priv`).toString('base64')}`;
  assert.deepEqual(parseLaunchToken(url), { signature: sig, token, privateToken: 'priv' });
  assert.equal(parseLaunchToken('moodlemobile://token=bad'), null);
});

test('downloads a full snapshot', async () => {
  const now = Date.now();
  const { fetchImpl, base, calls } = fakeMoodle({ now });
  const c = new MoodleClient({ baseUrl: base, token: 'tok', fetchImpl });
  const snap = await c.fetchSnapshot({ now });
  assert.equal(snap.site.fullName, 'Léa Martin');
  assert.deepEqual(snap.courses.map((x) => x.id), [11, 12], 'finished courses are skipped');
  assert.equal(snap.events.length, 4);
  const due = snap.events.find((e) => e.id === 1001);
  assert.equal(due.cmid, 102);
  assert.equal(due.url, `${base}/mod/assign/view.php?id=102`);
  assert.equal(snap.assignments[55].submitted, false);
  assert.equal(snap.assignments[55].intro, 'Rédiger le dossier & le déposer.');
  assert.equal(snap.assignments[55].attachments[0].name, 'Sujet_TD3.pdf');
  const files = snap.contents[11].flatMap((s) => s.modules.flatMap((m) => m.files));
  assert.deepEqual(files.map((f) => f.name), ['CM1_PIB.pdf', 'Chapitre2_inflation.pdf', 'TD3_enonce.pdf']);
  assert.equal(snap.contents[11][2].modules[2].links[0].url, 'https://www.insee.fr');
  assert.equal(snap.announcements.length, 1);
  assert.match(snap.announcements[0].message, /chapitres 1 et 2/);
  assert.deepEqual(snap.warnings, []);
  assert.ok(!calls.includes('core_course_get_contents') || calls.filter((x) => x === 'core_course_get_contents').length === 2);
});
