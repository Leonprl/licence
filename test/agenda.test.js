'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MoodleClient } = require('../src/main/moodle');
const { buildAgenda, matchCourse, fileMatchesRefs, updateFileFirstSeen } = require('../src/main/agenda');
const { extractFromMessage } = require('../src/main/extract');
const { fakeMoodle, DAY } = require('./helpers');

const emptyState = () => ({ done: {}, hiddenItems: {}, hiddenCourses: [], fileFirstSeen: {}, notified: {} });

async function snapshot(now, opts) {
  const { fetchImpl, base } = fakeMoodle({ now, ...opts });
  return new MoodleClient({ baseUrl: base, token: 'tok', fetchImpl }).fetchSnapshot({ now });
}

function mail(key, subject, text, date) {
  return { key, subject, text, date, from: { name: 'Prof', address: 'prof@univ-test.fr' }, attachments: [] };
}

test('turns Moodle events into agenda items', async () => {
  const now = Date.now();
  const snap = await snapshot(now);
  const state = emptyState();
  updateFileFirstSeen(snap, state, now);
  const a = buildAgenda({ snapshot: snap, state, now });

  const dossier = a.items.find((i) => i.id === 'moodle-1001');
  assert.equal(dossier.type, 'deadline');
  assert.equal(dossier.title, 'Dossier TD 3');
  assert.equal(dossier.courseShort, 'L2-MACRO');
  assert.equal(dossier.status, 'todo');
  assert.equal(dossier.submitted, false);
  assert.equal(dossier.files[0].name, 'Sujet_TD3.pdf');
  // Files of the same section come first among course documents.
  assert.equal(dossier.related[0].name, 'CM1_PIB.pdf');

  const quiz = a.items.find((i) => i.id === 'moodle-1002');
  assert.equal(quiz.type, 'quiz');
  assert.equal(quiz.title, 'QCM chapitre 1');
  assert.ok(!a.items.some((i) => i.id === 'moodle-1003'), 'quiz opening is not a task');

  const partiel = a.items.find((i) => i.id === 'moodle-1004');
  assert.equal(partiel.type, 'exam');
  assert.equal(partiel.end - partiel.start, 2 * 3600 * 1000);

  assert.deepEqual(a.items.map((i) => i.start), [...a.items.map((i) => i.start)].sort((x, y) => x - y));
  assert.equal(a.courses.length, 2);
  assert.ok(a.fileIndex[dossier.files[0].id]);
});

test('marks submitted assignments as done', async () => {
  const now = Date.now();
  const snap = await snapshot(now, { submitted: true });
  const a = buildAgenda({ snapshot: snap, state: emptyState(), now });
  assert.equal(a.items.find((i) => i.id === 'moodle-1001').status, 'done');
});

test('merges an exam announced on Moodle and by e-mail, and recommends the chapters to revise', async () => {
  const now = Date.now();
  const snap = await snapshot(now);
  const examDay = new Date(now + 10 * DAY * 1000);
  const dateText = examDay.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const m = mail('INBOX:1:5', 'Partiel de macroéconomie', `Bonjour,\nLe partiel aura lieu le ${dateText}.\nRévisez les chapitres 2 et 3.`, now - 3600 * 1000);
  const extractions = { [m.key]: extractFromMessage(m) };
  const a = buildAgenda({ snapshot: snap, mails: [m], extractions, state: emptyState(), now });

  const exams = a.items.filter((i) => i.family === 'exam' && i.courseId === 11);
  assert.equal(exams.length, 1, 'mail and Moodle event are merged');
  const exam = exams[0];
  assert.ok(exam.sources.some((s) => s.kind === 'mail'));
  assert.ok(exam.todo.some((t) => t.includes('chapitres 2 et 3')));
  // Chapter 2 files (including the TD stored in the "Chapitre 2" section), not chapter 1.
  const recommended = exam.related.filter((f) => f.recommended).map((f) => f.name).sort();
  assert.deepEqual(recommended, ['Chapitre2_inflation.pdf', 'TD3_enonce.pdf']);
  assert.ok(exam.related.findIndex((f) => f.recommended) === 0, 'recommended documents come first');
  assert.ok(a.news.some((n) => n.kind === 'mail' && n.mailKey === m.key));
});

test('done flags, late items and hidden courses', async () => {
  const now = Date.now();
  const snap = await snapshot(now);
  snap.events.push({ id: 2000, name: 'Ancien devoir', description: '', courseId: 12, modulename: 'assign', instance: 999, eventtype: 'due', timestart: now - 2 * DAY * 1000, duration: 0, cmid: null, url: 'x' });
  const state = emptyState();
  state.done['moodle-1002'] = now;
  let a = buildAgenda({ snapshot: snap, state, now });
  assert.equal(a.items.find((i) => i.id === 'moodle-1002').status, 'done');
  assert.equal(a.items.find((i) => i.id === 'moodle-2000').status, 'late');

  state.hiddenCourses = [12];
  a = buildAgenda({ snapshot: snap, state, now });
  assert.ok(!a.items.some((i) => i.courseId === 12));
  assert.equal(a.courses.find((c) => c.id === 12).hidden, true);
});

test('matches courses from free text', () => {
  const courses = [
    { id: 1, shortName: 'L2-MACRO', fullName: 'Macroéconomie 1' },
    { id: 2, shortName: 'L2-STAT', fullName: 'Statistiques descriptives' },
    { id: 3, shortName: 'ANG3', fullName: 'Anglais S3' },
  ];
  assert.equal(matchCourse('Partiel de MACROECONOMIE jeudi', courses).id, 1);
  assert.equal(matchCourse('CC de statistiques', courses).id, 2);
  assert.equal(matchCourse('Réunion de rentrée', courses), null);
});

test('recognises chapter and TD numbers in file names', () => {
  const f = (name, sectionName = '') => ({ name, sectionName, moduleName: '' });
  assert.equal(fileMatchesRefs(f('CM3_monnaie.pdf'), [{ kind: 'chapitre', nums: [3] }]), true);
  assert.equal(fileMatchesRefs(f('TD_2-corrige.pdf'), [{ kind: 'td', nums: [2] }]), true);
  assert.equal(fileMatchesRefs(f('slides.pdf', 'Chapitre 4 : Croissance'), [{ kind: 'chapitre', nums: [4] }]), true);
  assert.equal(fileMatchesRefs(f('cours 2024.pdf'), [{ kind: 'chapitre', nums: [20] }]), false);
  assert.equal(fileMatchesRefs(f('TD3.pdf'), [{ kind: 'chapitre', nums: [3] }]), false);
});
