'use strict';

// Rule-based extraction of exams, deadlines and "what to study" from French
// e-mails and Moodle announcements. Works offline; the optional AI mode
// (ai.js) produces the same output shape.

const chrono = require('chrono-node');
const { truncate } = require('./util');

// Words that make a sentence about an exam.
const EXAM_RE = /\b(examens?|exams?|partiels?|contr[ôo]les?(?: continus?)?|interros?|interrogations?|qcm|soutenances?|oraux|épreuves?|epreuves?|évaluations?|evaluations?|tests? notés?)\b/i;
// Abbreviations are only trusted in upper case ("CC2", "DS 3"), otherwise "cc" would match e-mail headers.
const EXAM_ABBR_RE = /\b(CC|DS|CT|QCM|DST)\s?\d*\b/;
// Strong signals of something to hand in.
const DEADLINE_STRONG_RE = /(à rendre|a rendre|\brendre\b|\brendus?\b|remise|à déposer|a deposer|\bdéposer\b|\bdépôt\b|\bdepot\b|date limite|deadline|au plus tard|à remettre|à envoyer|à soumettre)/i;
// Weaker signals: kinds of work that usually have a due date.
const DEADLINE_WEAK_RE = /\b(devoirs?|DM|dossiers?|projets?|comptes?[- ]rendus?|rapports?|exposés?|mémoires?|memoires?)\b/i;
// Schedule changes and other dated course information.
const INFO_RE = /(annul|report|déplac|deplac|rattrapage|changement de salle|\bséances?\b|\bseances?\b|\bcours\b|\bTD\b|\bTP\b|\bCM\b|réunion|reunion|\bamphi|\bsalle\b|rentrée|inscription)/i;
// Sentences telling what to work on.
const TODO_RE = /(révis|revis|revoir|travaill|prépar|prepar|\blire\b|relire|lecture|chapitres?|\bchap\.?\s*\d|exercices?|\bexos?\b|programme|porter?a?\s+sur|porte\s+sur|notions|apprendre|connaître|connaitre|fiches?|annales?|\bà faire\b)/i;
const LOCATION_RE = /\b(amphi(?:th[ée][âa]tre)?\s*[A-Z0-9][\w-]*|salle\s+[A-Z0-9][\w.-]*)/i;
// Lines that are headers of a quoted or forwarded message, not content.
const HEADER_LINE_RE = /^(date|envoyé|envoye|sent|de|from|à|a|to|cc|objet|subject)\s*:/i;
const REPLY_MARKER_RE = /^(le .{4,120} a écrit\s*:|on .{4,120} wrote:)\s*$/im;

const MAX_FUTURE_MS = 300 * 24 * 3600 * 1000;

/** Removes quoted replies so that old messages do not produce duplicate events. */
function cleanBody(text) {
  if (!text) return '';
  let body = String(text).replace(/\r/g, '');
  const marker = body.search(REPLY_MARKER_RE);
  if (marker > 0) body = body.slice(0, marker);
  return body
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .slice(0, 20000);
}

/** Splits text into sentences while keeping bullet points as separate entries. */
function splitSentences(text) {
  const out = [];
  for (const rawLine of String(text || '').split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const parts = line.split(/(?<=[.!?])\s+(?=[A-ZÀÂÉÈÊÎÔÛÇ])/);
    for (const p of parts) {
      const s = p.replace(/^[-•*–·]\s*/, '').trim();
      if (s) out.push({ text: s, bullet: /^[-•*–·]\s/.test(rawLine.trim()), endsWithColon: /:\s*$/.test(s) });
    }
  }
  return out;
}

function classifySentence(sentence) {
  if (DEADLINE_STRONG_RE.test(sentence)) return 'deadline';
  if (EXAM_RE.test(sentence) || EXAM_ABBR_RE.test(sentence)) return 'exam';
  if (DEADLINE_WEAK_RE.test(sentence)) return 'deadline';
  if (INFO_RE.test(sentence)) return 'info';
  return null;
}

function classifySubject(subject) {
  if (!subject) return null;
  if (EXAM_RE.test(subject) || EXAM_ABBR_RE.test(subject)) return 'exam';
  if (DEADLINE_STRONG_RE.test(subject) || DEADLINE_WEAK_RE.test(subject)) return 'deadline';
  return null;
}

/** Parses "1 à 4", "2, 3 et 5", "3-4" into a list of numbers. */
function parseNumberList(str) {
  const nums = new Set();
  const tokens = String(str).split(/\s*(?:,|\bet\b|&)\s*/i);
  for (const tok of tokens) {
    const range = tok.match(/(\d{1,2})\s*(?:à|a|-|–|au)\s*(\d{1,2})/i);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b >= a && b - a < 30) for (let i = a; i <= b; i++) nums.add(i);
      continue;
    }
    const single = tok.match(/(\d{1,2})/);
    if (single) nums.add(Number(single[1]));
  }
  return [...nums];
}

const REF_KINDS = [
  { kind: 'td', re: /\bTDs?\b/i },
  { kind: 'tp', re: /\bTPs?\b/i },
  { kind: 'chapitre', re: /\b(chapitres?|chap\.?|ch\.|cm|cours|parties?|le[çc]ons?|th[èe]mes?|séances?|seances?|modules?)/i },
];

/** Finds references such as "chapitres 1 à 3" or "TD 4" to recommend matching course files. */
function extractRefs(text) {
  const refs = [];
  const re = /\b(chapitres?|chap\.?|ch\.|cm|cours|parties?|le[çc]ons?|th[èe]mes?|séances?|seances?|modules?|tds?|tps?)\s*(?:n°|no|num[ée]ro)?\s*((?:\d{1,2})(?:\s*(?:,|\bet\b|à|-|–|au)\s*\d{1,2})*)/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const word = m[1];
    const kind = (REF_KINDS.find((k) => k.re.test(word)) || REF_KINDS[2]).kind;
    const nums = parseNumberList(m[2]);
    if (nums.length) refs.push({ kind, nums });
  }
  return refs;
}

function isUsefulDate(result, ref) {
  const known = result.start;
  if (!(known.isCertain('day') || known.isCertain('weekday'))) return false;
  const t = known.date().getTime();
  return t >= ref.getTime() - 24 * 3600 * 1000 && t <= ref.getTime() + MAX_FUTURE_MS;
}

function makeTitle(sentence) {
  return truncate(sentence.replace(/\s+/g, ' ').trim(), 160);
}

/** "RE: [L2] Rappel : partiel de macro" → "Partiel de macro". */
function cleanSubject(subject) {
  const s = String(subject || '')
    .replace(/^\s*((re|tr|fwd?|réf)\s*:\s*)+/i, '')
    .replace(/^\s*(\[[^\]]{1,40}\]\s*)+/, '')
    .replace(/^\s*(rappel|important|urgent|info(rmation)?s?|attention|nouveau)\s*[:!\-–]\s*/i, '')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function subjectFits(subject, type) {
  if (subject.length < 6 || subject.length > 80) return false;
  if (type === 'info') return INFO_RE.test(subject);
  return classifySubject(subject) === type;
}

/**
 * Extracts dated events from a message.
 * @param {{subject?: string, text?: string, date?: string|number|Date}} msg
 * @returns {{events: Array, todo: string[], refs: Array, academic: boolean}}
 */
function extractFromMessage(msg) {
  const ref = msg.date ? new Date(msg.date) : new Date();
  const subject = String(msg.subject || '').replace(/^\s*((re|tr|fwd?|réf)\s*:\s*)+/i, '').trim();
  const sentences = splitSentences(cleanBody(msg.text));
  const subjectType = classifySubject(subject);

  const events = [];
  const todoIdx = [];
  let inTodoList = false;

  sentences.forEach((s, idx) => {
    // A line ending with ":" that talks about what to study starts a list of bullets.
    if (TODO_RE.test(s.text)) {
      todoIdx.push(idx);
      inTodoList = s.endsWithColon;
    } else if (inTodoList && s.bullet) {
      todoIdx.push(idx);
    } else {
      inTodoList = false;
    }

    if (HEADER_LINE_RE.test(s.text)) return;
    let results;
    try {
      results = chrono.fr.parse(s.text, ref, { forwardDate: true });
    } catch {
      results = [];
    }
    for (const r of results) {
      if (!isUsefulDate(r, ref)) continue;
      let type = classifySentence(s.text);
      let confidence = 'probable';
      if (!type && subjectType) {
        type = subjectType;
        confidence = 'faible';
      }
      if (!type) continue;
      if (type !== 'info' && (EXAM_RE.test(s.text) || DEADLINE_STRONG_RE.test(s.text) || EXAM_ABBR_RE.test(s.text))) {
        confidence = 'sure';
      }
      const start = r.start.date();
      const hasTime = r.start.isCertain('hour');
      if (!hasTime) start.setHours(0, 0, 0, 0);
      const end = r.end && r.end.isCertain('hour') ? r.end.date().getTime() : null;
      // A room in the next sentence belongs to this event unless that sentence has its own date.
      const next = sentences[idx + 1] && sentences[idx + 1].text;
      const loc = s.text.match(LOCATION_RE) || (next && !chrono.fr.parse(next, ref).length && next.match(LOCATION_RE));
      events.push({
        type,
        title: makeTitle(s.text),
        detail: '',
        start: start.getTime(),
        end,
        allDay: !hasTime,
        location: loc ? loc[1].replace(/[.,;:]+$/, '') : '',
        sentenceIndex: idx,
        confidence,
        todo: [],
        refs: [],
      });
    }
  });

  // Deduplicate: same type on the same day within one message.
  const seen = new Set();
  const unique = events.filter((e) => {
    const k = `${e.type}|${new Date(e.start).toDateString()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Attach each "to study" sentence to the exam/deadline announced just before it
  // (teachers write "Exam on X. It covers ..."), or to the first one after it.
  const workEvents = unique.filter((e) => e.type !== 'info');
  const todo = todoIdx.map((i) => truncate(sentences[i].text, 220));
  for (const i of todoIdx) {
    if (!workEvents.length) break;
    const before = workEvents.filter((e) => e.sentenceIndex <= i);
    const best = before.length ? before[before.length - 1] : workEvents[0];
    const line = truncate(sentences[i].text, 220);
    if (best.todo.length < 8 && !best.todo.includes(line)) best.todo.push(line);
  }
  // A short subject ("Partiel de macro") makes a better title than the whole sentence,
  // when the message announces only one thing of that kind.
  const cleanSubj = cleanSubject(subject);
  for (const e of unique) {
    e.refs = extractRefs(e.todo.join(' ') + ' ' + e.title);
    if (unique.filter((x) => x.type === e.type).length === 1 && subjectFits(cleanSubj, e.type)) {
      e.detail = e.title;
      e.title = cleanSubj;
    }
    delete e.sentenceIndex;
  }

  const academic = Boolean(
    unique.length ||
      subjectType ||
      EXAM_RE.test(subject) ||
      INFO_RE.test(subject) ||
      TODO_RE.test(subject)
  );
  return { events: unique, todo: todo.slice(0, 8), refs: extractRefs(todo.join(' ')), academic };
}

/** Quick check used to decide whether a message is worth sending to the AI extractor. */
function looksAcademic(msg) {
  const s = `${msg.subject || ''}\n${String(msg.text || '').slice(0, 4000)}`;
  return EXAM_RE.test(s) || EXAM_ABBR_RE.test(s) || DEADLINE_STRONG_RE.test(s) || DEADLINE_WEAK_RE.test(s) || TODO_RE.test(s) || INFO_RE.test(s);
}

module.exports = {
  extractFromMessage,
  extractRefs,
  parseNumberList,
  looksAcademic,
  cleanBody,
  cleanSubject,
  splitSentences,
  classifySentence,
};
