'use strict';

// Optional: uses Claude to read e-mails and announcements more reliably than the
// rule-based extractor. Only enabled when the student pastes an Anthropic API key.

const Anthropic = require('@anthropic-ai/sdk');
const { extractRefs, cleanBody } = require('./extract');
const { truncate } = require('./util');

const MODEL = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'date', 'time', 'course', 'location', 'todo'],
        properties: {
          type: { type: 'string', enum: ['exam', 'deadline', 'info'] },
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM, or empty string when no time is given' },
          course: { type: 'string', description: "Exact name from the student's course list, or empty string" },
          location: { type: 'string' },
          todo: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM = `Tu aides un étudiant de licence à ne rien rater. Tu lis un e-mail ou une annonce Moodle et tu en extrais uniquement les échéances concrètes qui le concernent :
- "exam" : examen, partiel, contrôle continu, interrogation, QCM, oral, soutenance ;
- "deadline" : travail à rendre ou à déposer avec une date limite (devoir, dossier, rapport, projet…) ;
- "info" : changement de planning important (cours annulé, déplacé, rattrapage, changement de salle).

Pour chaque échéance :
- title : phrase courte en français (80 caractères max) qui dit clairement quoi faire, par exemple « Partiel de macroéconomie » ou « Rendre le dossier de TD 3 » ;
- date : AAAA-MM-JJ ; résous les dates relatives (« jeudi prochain », « demain ») par rapport à la date de réception ;
- time : HH:MM si l'heure est donnée, sinon chaîne vide ;
- course : le nom exact d'un cours de la liste fournie s'il correspond clairement, sinon chaîne vide ;
- location : salle ou amphi si indiqué, sinon chaîne vide ;
- todo : ce qu'il faut travailler, réviser, lire ou préparer pour cette échéance (chapitres, TD, exercices, documents), repris fidèlement du message, une idée par élément.

N'invente rien. Ignore les messages sans rapport avec les études (associations, publicités, newsletters) et les dates déjà passées par rapport à la date de réception. S'il n'y a aucune échéance, renvoie une liste vide.`;

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateString(ms) {
  const d = new Date(ms);
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return `${days[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts Claude's answer to the same shape as extract.extractFromMessage(). */
function toEvents(answer, courseNames) {
  const events = [];
  for (const e of (answer && answer.events) || []) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date || '');
    if (!m || !['exam', 'deadline', 'info'].includes(e.type)) continue;
    const t = /^(\d{1,2}):(\d{2})$/.exec(e.time || '');
    const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t ? Number(t[1]) : 0, t ? Number(t[2]) : 0);
    if (Number.isNaN(start.getTime())) continue;
    const todo = (e.todo || []).map((s) => truncate(String(s), 220)).slice(0, 8);
    events.push({
      type: e.type,
      title: truncate(String(e.title || '').trim() || 'Échéance', 160),
      detail: '',
      start: start.getTime(),
      end: null,
      allDay: !t,
      location: truncate(e.location || '', 60),
      confidence: 'sure',
      todo,
      refs: extractRefs(todo.join(' ') + ' ' + e.title),
      courseHint: courseNames.includes(e.course) ? e.course : '',
    });
  }
  return events;
}

/**
 * @param {{apiKey: string, msg: {subject, from, date, text}, courseNames: string[]}} args
 * @returns {Promise<{events: object[], todo: string[], refs: object[], academic: boolean, ai: true}>}
 */
async function extractWithClaude({ apiKey, msg, courseNames }) {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const body = cleanBody(msg.text);
  const content = [
    `Date de réception : ${localDateString(msg.date || Date.now())}`,
    `Cours de l'étudiant : ${courseNames.length ? courseNames.join(' | ') : '(inconnus)'}`,
    `De : ${msg.from || ''}`,
    `Objet : ${msg.subject || ''}`,
    '',
    body,
  ].join('\n');

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Analyse IA refusée pour ce message.');
  if (response.stop_reason === 'max_tokens') throw new Error('Réponse IA incomplète.');
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Réponse IA vide.');
  const events = toEvents(JSON.parse(textBlock.text), courseNames);
  const todo = [...new Set(events.flatMap((e) => e.todo))].slice(0, 8);
  return { events, todo, refs: extractRefs(todo.join(' ')), academic: events.length > 0, ai: true };
}

/** Checks the key with a minimal request so the settings screen can say whether it works. */
async function testApiKey(apiKey) {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  try {
    await client.models.retrieve(MODEL);
    return true;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error('Clé API invalide.');
    if (error instanceof Anthropic.PermissionDeniedError) throw new Error("Cette clé n'a pas accès au modèle.");
    if (error instanceof Anthropic.APIConnectionError) throw new Error("Impossible de joindre l'API Anthropic.");
    if (error instanceof Anthropic.APIError) throw new Error(`Erreur API ${error.status}.`);
    throw error;
  }
}

module.exports = { extractWithClaude, testApiKey, toEvents, SCHEMA, MODEL };
