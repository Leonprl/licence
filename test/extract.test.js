'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFromMessage, parseNumberList, extractRefs, looksAcademic } = require('../src/main/extract');

// Wednesday 28 October 2026, 10:00 local time.
const REF = new Date(2026, 9, 28, 10, 0).getTime();

test('finds an exam with time, room, chapters and revision list', () => {
  const r = extractFromMessage({
    subject: 'Partiel de Macroéconomie',
    date: REF,
    text: [
      'Bonjour à tous,',
      '',
      'Le partiel de macroéconomie aura lieu le jeudi 12 novembre à 14h en amphi B.',
      'Il portera sur les chapitres 1 à 4 du cours ainsi que sur les TD 1 à 3.',
      'Pensez à revoir :',
      '- les fiches de synthèse',
      '- les annales 2024',
      '',
      'Cordialement,',
    ].join('\n'),
  });
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.type, 'exam');
  assert.equal(e.confidence, 'sure');
  assert.equal(e.allDay, false);
  const d = new Date(e.start);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 10, 12, 14]);
  assert.equal(e.location, 'amphi B');
  assert.equal(e.title, 'Partiel de Macroéconomie', 'short subject used as title');
  assert.match(e.detail, /aura lieu le jeudi 12 novembre/);
  assert.ok(e.todo.some((t) => t.includes('chapitres 1 à 4')));
  assert.ok(e.todo.includes('les annales 2024'));
  assert.deepEqual(e.refs.find((x) => x.kind === 'chapitre').nums, [1, 2, 3, 4]);
  assert.deepEqual(e.refs.find((x) => x.kind === 'td').nums, [1, 2, 3]);
});

test('resolves "jeudi prochain" for a deadline and keeps it all-day', () => {
  const r = extractFromMessage({ subject: 'Dossier', date: REF, text: 'Le dossier de groupe est à rendre pour jeudi prochain sur Moodle.' });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'deadline');
  assert.equal(r.events[0].allDay, true);
  const d = new Date(r.events[0].start);
  assert.equal(d.getDay(), 4);
  assert.ok(d.getTime() > REF);
});

test('ignores messages that are not about studies', () => {
  const r = extractFromMessage({ subject: 'Soirée BDE', date: REF, text: 'Soirée d’intégration le vendredi 6 novembre ! Venez nombreux.' });
  assert.equal(r.events.length, 0);
  assert.equal(r.academic, false);
});

test('ignores quoted replies and forwarded headers', () => {
  const r = extractFromMessage({
    subject: 'RE: question',
    date: REF,
    text: [
      'Oui, c’est bien noté.',
      '',
      'Le mar. 27 oct. 2026 à 09:00, Etudiant <etu@univ.fr> a écrit :',
      '> Le partiel est bien le 30 novembre ?',
    ].join('\n'),
  });
  assert.equal(r.events.length, 0);

  const fwd = extractFromMessage({
    subject: 'TR: CC2 statistiques',
    date: REF,
    text: '---------- Message transféré ---------\nDe : Scolarité <scol@univ.fr>\nDate : mar. 27 oct. 2026 à 15:12\nObjet : CC2\n\nLe CC2 de statistiques se déroulera le mardi 10/11 de 10h à 12h salle C204.',
  });
  assert.equal(fwd.events.length, 1);
  assert.equal(fwd.events[0].type, 'exam');
  assert.equal(fwd.events[0].location, 'salle C204');
  assert.ok(fwd.events[0].end > fwd.events[0].start);
});

test('detects cancelled classes and make-up sessions as info, each with its own room', () => {
  const r = extractFromMessage({
    subject: 'Cours annulé lundi',
    date: REF,
    text: 'Le cours du lundi 2 novembre est annulé.\nRattrapage le samedi 7 novembre à 9h salle C204.',
  });
  assert.equal(r.events.length, 2);
  assert.deepEqual(r.events.map((e) => e.type), ['info', 'info']);
  assert.equal(r.events[0].location, '', 'the room of the make-up session is not copied');
  assert.equal(r.events[1].location, 'salle C204');
  assert.notEqual(r.events[0].title, 'Cours annulé lundi', 'two infos: keep the sentences as titles');
});

test('cleans up subjects used as titles', () => {
  const r = extractFromMessage({ subject: 'RE: [L2 ECO] Rappel : dossier de statistiques', date: REF, text: 'Le dossier est à rendre avant le vendredi 6 novembre à 23h59.' });
  assert.equal(r.events[0].title, 'Dossier de statistiques');
});

test('number lists and references', () => {
  assert.deepEqual(parseNumberList('1 à 4'), [1, 2, 3, 4]);
  assert.deepEqual(parseNumberList('2, 3 et 5'), [2, 3, 5]);
  assert.deepEqual(extractRefs('Révisez le chapitre 3 et le TD 2'), [
    { kind: 'chapitre', nums: [3] },
    { kind: 'td', nums: [2] },
  ]);
  assert.equal(looksAcademic({ subject: 'Promo -50%', text: 'Offre spéciale' }), false);
  assert.equal(looksAcademic({ subject: 'Rappel', text: 'Le DM est à rendre lundi' }), true);
});
