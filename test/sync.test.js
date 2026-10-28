'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Storage } = require('../src/main/storage');
const { SyncEngine } = require('../src/main/sync');
const { ensureLocalFile } = require('../src/main/files');
const { fakeMoodle, fakeSafeStorage, DAY } = require('./helpers');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ma-licence-'));
}

test('storage encrypts secrets and never exposes them', () => {
  const dir = tmpDir();
  const s = new Storage(dir, fakeSafeStorage);
  s.updateSettings({ moodle: { baseUrl: 'https://m.fr', token: 'secret-token' }, mail: { password: 'pw' } });
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!raw.includes('secret-token'));
  assert.equal(new Storage(dir, fakeSafeStorage).secret('moodle', 'token'), 'secret-token');
  const pub = s.publicSettings();
  assert.equal(pub.moodle.hasToken, true);
  assert.equal(pub.moodle.token, undefined);
  assert.equal(pub.mail.hasPassword, true);
  assert.equal(pub.ai.hasApiKey, false);
});

test('a sync builds the agenda, then notifies new items and reminders once', async () => {
  const dir = tmpDir();
  let now = Date.now();
  const moodle = fakeMoodle({ now });
  const storage = new Storage(dir, fakeSafeStorage);
  storage.updateSettings({ moodle: { baseUrl: moodle.base, token: 'tok' } });
  const notes = [];
  const engine = new SyncEngine({ storage, fetchImpl: moodle.fetchImpl, notify: (title, body) => notes.push(title), now: () => now });

  const agenda = await engine.run();
  assert.ok(agenda.items.length >= 3);
  assert.equal(engine.status.state, 'ok');
  assert.equal(notes.length, 0, 'no "new" notifications on the very first sync');

  // A new exam appears in Moodle, due in 20 hours: one "new" + one reminder.
  const t = Math.floor(now / 1000);
  const moodle2 = fakeMoodle({
    now,
    extraEvents: [{ id: 3000, name: 'Examen surprise', description: '', courseid: 12, modulename: '', instance: 0, eventtype: 'course', timestart: t + 20 * 3600, timeduration: 0 }],
  });
  engine.fetchImpl = moodle2.fetchImpl;
  await engine.run();
  assert.ok(notes.some((n) => n.startsWith('Nouveau · Examen')));
  assert.ok(notes.some((n) => n.startsWith('Rappel · Examen')));
  const count = notes.length;
  now += 60 * 1000;
  await engine.run();
  assert.equal(notes.length, count, 'nothing is notified twice');

  // Cache survives a restart.
  const again = new Storage(dir, fakeSafeStorage);
  assert.ok(again.cache.agenda.items.some((i) => i.id === 'moodle-3000'));
});

test('an expired Moodle session is reported and old data is kept', async () => {
  const dir = tmpDir();
  const now = Date.now();
  const moodle = fakeMoodle({ now });
  const storage = new Storage(dir, fakeSafeStorage);
  storage.updateSettings({ moodle: { baseUrl: moodle.base, token: 'tok' } });
  const engine = new SyncEngine({ storage, fetchImpl: moodle.fetchImpl, now: () => now });
  await engine.run();
  storage.updateSettings({ moodle: { token: 'expired' } });
  const agenda = await engine.run();
  assert.equal(engine.status.state, 'error');
  assert.match(engine.status.errors.moodle, /expirée/);
  assert.ok(agenda.items.length >= 3);
});

test('Moodle documents are downloaded once into a folder per course', async () => {
  const dir = tmpDir();
  const now = Date.now();
  const moodle = fakeMoodle({ now });
  const storage = new Storage(dir, fakeSafeStorage);
  storage.updateSettings({ moodle: { baseUrl: moodle.base, token: 'tok' } });
  const engine = new SyncEngine({ storage, fetchImpl: moodle.fetchImpl, now: () => now });
  const agenda = await engine.run();
  const file = Object.values(agenda.fileIndex).find((f) => f.name === 'TD3_enonce.pdf');
  const ctx = { client: engine.moodleClient(), filesDir: storage.filesDir, attachmentsDir: storage.attachmentsDir, courseName: () => 'L2-MACRO' };
  const local = await ensureLocalFile(file, ctx);
  assert.equal(local, path.join(storage.filesDir, 'L2-MACRO', 'TD3_enonce.pdf'));
  assert.equal(fs.readFileSync(local, 'utf8'), '%PDF-1.4 fake');
  await assert.rejects(ensureLocalFile({ kind: 'mail', path: '/etc/passwd' }, ctx), /introuvable/);
  void DAY;
});

test('a settings change during a sync triggers a second sync afterwards', async () => {
  const dir = tmpDir();
  const now = Date.now();
  const moodle = fakeMoodle({ now });
  const storage = new Storage(dir, fakeSafeStorage);
  storage.updateSettings({ moodle: { baseUrl: moodle.base, token: 'tok' } });
  const engine = new SyncEngine({ storage, fetchImpl: moodle.fetchImpl, now: () => now });
  let runs = 0;
  engine.on('data', () => runs++);
  const first = engine.run('startup');
  engine.run('timer'); // ignored: already running
  engine.run('settings'); // queued
  await first;
  await new Promise((resolve) => engine.once('data', resolve));
  assert.equal(runs, 2);
});
