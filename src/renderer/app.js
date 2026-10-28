'use strict';

/* global document, CSS, api -- `api` is exposed by preload.js */

const DAY = 24 * 3600 * 1000;

const S = {
  agenda: null,
  status: {},
  settings: null,
  presets: {},
  version: '',
  view: 'agenda',
  filter: 'all',
  showDone: false,
  search: '',
  weekOffset: 0,
  expanded: new Set(),
  moodleCheck: null,
  moodleUrl: null,
  busy: {},
};

const TYPES = {
  exam: { label: 'Examen' },
  quiz: { label: 'Test en ligne' },
  deadline: { label: 'À rendre' },
  info: { label: 'Info' },
  event: { label: 'Événement' },
};

// ---------------------------------------------------------------- helpers

const ICONS = {
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h1.5a1.5 1.5 0 0 1 0 3H8v-3zm0 3v2m5-5v5h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2h-1z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8a5 5 0 0 1 0 8"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 10v4m0 3v.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ico ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name] || '';
  return span;
}

/** Creates an element. Text children are inserted as text, never as HTML. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);

function toast(message, kind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, message);
  $('#toast-root').append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 6000 : 3500);
}

async function guarded(fn, okMessage) {
  try {
    const r = await fn();
    if (okMessage) toast(okMessage, 'ok');
    return r;
  } catch (e) {
    toast(e.message || String(e), 'error');
    return undefined;
  }
}

// ---------------------------------------------------------------- dates

const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ms) {
  const d = new Date(startOfDay(ms));
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

function dayDiff(ms) {
  return Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY);
}

function dayLabel(ms) {
  const diff = dayDiff(ms);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return cap(fmtLong.format(ms));
}

function relative(item) {
  if (item.allDay) {
    const diff = dayDiff(item.start);
    if (diff === 0) return "aujourd'hui";
    if (diff === 1) return 'demain';
    return diff > 0 ? `dans ${diff} j` : `il y a ${-diff} j`;
  }
  const d = item.start - Date.now();
  const a = Math.abs(d);
  let txt;
  if (a < 3600 * 1000) txt = `${Math.max(1, Math.round(a / 60000))} min`;
  else if (a < 36 * 3600 * 1000) txt = `${Math.round(a / 3600000)} h`;
  else txt = `${Math.abs(dayDiff(item.start))} j`;
  return d >= 0 ? `dans ${txt}` : `il y a ${txt}`;
}

function ago(ms) {
  const a = Date.now() - ms;
  if (a < 60 * 1000) return "à l'instant";
  if (a < 3600 * 1000) return `il y a ${Math.round(a / 60000)} min`;
  if (a < DAY) return `il y a ${Math.round(a / 3600000)} h`;
  return `le ${fmtDayMonth.format(ms)}`;
}

function timeLabel(item) {
  if (item.allDay) return 'Journée';
  const t = fmtTime.format(item.start);
  return item.end ? `${t} – ${fmtTime.format(item.end)}` : t;
}

function courseColor(id) {
  if (!id) return 'var(--muted)';
  return `hsl(${Math.round((id * 137.508) % 360)} 62% 48%)`;
}

// ---------------------------------------------------------------- data

function isConfigured() {
  const s = S.settings;
  return s && (s.moodle.hasToken || (s.mail.enabled && s.mail.host));
}

function items() {
  return (S.agenda && S.agenda.items) || [];
}

function matchesFilters(it) {
  if (S.filter === 'deadline' && it.family !== 'deadline') return false;
  if (S.filter === 'exam' && it.family !== 'exam') return false;
  if (S.filter === 'info' && it.family !== 'info') return false;
  if (S.search) {
    const q = S.search.toLowerCase();
    const hay = `${it.title} ${it.courseName} ${it.courseShort} ${it.description} ${it.todo.join(' ')}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- shared components

function fileChip(file) {
  const isPdf = /pdf/i.test(file.mimetype) || /\.pdf$/i.test(file.name);
  const busyKey = `file:${file.id}`;
  return h(
    'button',
    {
      type: 'button',
      class: `chip file${file.recommended ? ' recommended' : ''}${S.busy[busyKey] ? ' loading' : ''}`,
      title: [file.recommended ? 'Recommandé : correspond à ce qu’il faut travailler' : '', file.sectionName, file.moduleName].filter(Boolean).join(' · ') || file.name,
      onclick: async (e) => {
        e.stopPropagation();
        S.busy[busyKey] = true;
        e.currentTarget.classList.add('loading');
        await guarded(() => api.openFile(file.id));
        delete S.busy[busyKey];
        render();
      },
    },
    icon(isPdf ? 'pdf' : 'file'),
    h('span', { class: 'chip-label' }, file.name),
    file.recommended ? icon('star', 'star') : null
  );
}

function linkButton(label, url, iconName = 'link') {
  return h(
    'button',
    { type: 'button', class: 'btn ghost small', onclick: (e) => (e.stopPropagation(), guarded(() => api.openExternal(url))) },
    icon(iconName),
    h('span', { class: 'btn-label' }, label)
  );
}

function statusChip(it) {
  if (it.status === 'done') return h('span', { class: 'status done' }, icon('check'), it.submitted ? 'Rendu' : 'Fait');
  if (it.status === 'late') return h('span', { class: 'status late' }, it.submitted === false ? 'Pas rendu' : 'En retard');
  if (it.type === 'deadline' && it.submitted === false) return h('span', { class: 'status pending' }, 'Pas encore rendu');
  return null;
}

function courseTag(it) {
  if (!it.courseId) return null;
  return h('span', { class: 'course', title: it.courseName, style: { '--c': courseColor(it.courseId) } }, h('i', { class: 'dot' }), it.courseShort || it.courseName);
}

function itemDetails(it) {
  const parts = [];
  if (it.description) parts.push(h('div', { class: 'desc' }, it.description));
  if (it.location) parts.push(h('div', { class: 'detail-line' }, icon('pin'), it.location));
  if (it.todo.length) {
    parts.push(
      h('section', { class: 'todo-box' }, h('h4', null, icon('book'), 'À travailler'), h('ul', null, it.todo.map((t) => h('li', null, t))))
    );
  }
  if (it.files.length) {
    parts.push(h('section', null, h('h4', null, icon('file'), it.type === 'deadline' ? 'Sujet et pièces jointes' : 'Pièces jointes'), h('div', { class: 'chips' }, it.files.map(fileChip))));
  }
  if (it.related.length) {
    const hasRecommended = it.related.some((f) => f.recommended);
    parts.push(
      h(
        'section',
        null,
        h('h4', null, icon('folder'), hasRecommended ? 'Documents du cours (★ = à revoir)' : 'Documents du cours'),
        h('div', { class: 'chips' }, it.related.map(fileChip))
      )
    );
  }
  const sources = it.sources.map((s) => {
    if (s.kind === 'mail') {
      return h('button', { type: 'button', class: 'btn ghost small', onclick: (e) => (e.stopPropagation(), openMail(s.mailKey)) }, icon('mail'), h('span', { class: 'btn-label' }, s.label));
    }
    if (s.url && s.kind === 'announcement') return linkButton(s.label, s.url, 'megaphone');
    return null;
  });
  const actions = h(
    'div',
    { class: 'actions' },
    it.links.map((l) => linkButton(l.label, l.url)),
    sources,
    h(
      'button',
      {
        type: 'button',
        class: 'btn ghost small subtle',
        title: 'Ne plus afficher cet élément',
        onclick: (e) => {
          e.stopPropagation();
          guarded(async () => {
            S.agenda = await api.hideItem(it.id);
            closeModal();
            render();
          });
        },
      },
      icon('eyeOff'),
      'Masquer'
    )
  );
  parts.push(actions);
  if (it.confidence !== 'sure') {
    parts.push(h('p', { class: 'hint' }, 'Détecté automatiquement dans un message : vérifie la date dans la source.'));
  }
  return h('div', { class: 'details' }, parts);
}

function itemCard(it, { forceOpen = false } = {}) {
  const open = forceOpen || S.expanded.has(it.id);
  const urgent = it.status === 'todo' && it.family !== 'info' && it.start - Date.now() < 48 * 3600 * 1000;
  const infoBits = [];
  if (it.location) infoBits.push(it.location);
  const docs = it.files.length + it.related.length;
  if (docs) infoBits.push(`${docs} document${docs > 1 ? 's' : ''}`);
  if (it.todo.length) infoBits.push(`${it.todo.length} point${it.todo.length > 1 ? 's' : ''} à travailler`);
  if (it.sources.some((s) => s.kind === 'mail')) infoBits.push('mail');

  const card = h(
    'article',
    { class: `card type-${it.type} ${it.status}${open ? ' open' : ''}`, 'data-id': it.id },
    h(
      'div',
      {
        class: 'card-main',
        role: 'button',
        tabindex: '0',
        'aria-expanded': open ? 'true' : 'false',
        onclick: () => {
          if (forceOpen) return;
          if (S.expanded.has(it.id)) S.expanded.delete(it.id);
          else S.expanded.add(it.id);
          render();
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.currentTarget.click();
          }
        },
      },
      h('div', { class: 'time' }, timeLabel(it)),
      h(
        'div',
        { class: 'body' },
        h(
          'div',
          { class: 'meta' },
          h('span', { class: 'badge' }, (TYPES[it.type] || TYPES.event).label),
          courseTag(it),
          it.confidence === 'faible' ? h('span', { class: 'maybe' }, 'à confirmer') : null
        ),
        h('div', { class: 'title' }, it.title),
        infoBits.length ? h('div', { class: 'sub' }, infoBits.join(' · ')) : null
      ),
      h('div', { class: 'right' }, h('span', { class: `rel${urgent ? ' urgent' : ''}` }, relative(it)), statusChip(it)),
      h(
        'button',
        {
          type: 'button',
          class: `check${it.status === 'done' ? ' on' : ''}`,
          title: it.status === 'done' ? 'Marquer comme pas fait' : 'Marquer comme fait',
          'aria-label': 'Marquer comme fait',
          disabled: it.submitted ? true : null,
          onclick: (e) => {
            e.stopPropagation();
            guarded(async () => {
              S.agenda = await api.setDone(it.id, !it.manualDone);
              render();
            });
          },
        },
        icon('check')
      )
    ),
    open ? itemDetails(it) : null
  );
  return card;
}

// ---------------------------------------------------------------- views

function errorBanner() {
  const errs = (S.status && S.status.errors) || {};
  const lines = [];
  if (errs.moodle) lines.push(`Moodle : ${errs.moodle}`);
  if (errs.mail) lines.push(`Mails : ${errs.mail}`);
  if (errs.ai) lines.push(errs.ai);
  if (errs.general) lines.push(errs.general);
  if (!lines.length) return null;
  return h(
    'div',
    { class: 'banner error' },
    icon('warn'),
    h('div', null, lines.map((l) => h('div', null, l))),
    h('button', { type: 'button', class: 'btn small', onclick: () => go('settings') }, 'Réglages')
  );
}

function onboarding() {
  const s = S.settings;
  return h(
    'div',
    { class: 'welcome' },
    h('h1', null, 'Bienvenue 👋'),
    h('p', null, 'Connecte ton Moodle et ta boîte mail : l’appli rassemble tout ce que tu dois rendre, tes examens et les documents à travailler, et se met à jour toute seule.'),
    h(
      'ol',
      { class: 'steps' },
      h('li', { class: s.moodle.hasToken ? 'done' : '' }, h('strong', null, 'Moodle'), ' — devoirs, tests, annonces et PDF des cours.'),
      h('li', { class: s.mail.enabled ? 'done' : '' }, h('strong', null, 'Mails'), ' — dates d’examen et consignes envoyées par les profs ou la scolarité.'),
      h('li', null, h('strong', null, 'C’est tout'), ' — l’appli se synchronise toutes les 20 minutes et te prévient avant chaque échéance.')
    ),
    h('button', { type: 'button', class: 'btn primary', onclick: () => go('settings') }, 'Configurer')
  );
}

function summary() {
  const now = Date.now();
  const all = items();
  const weekEnd = startOfDay(now) + 7 * DAY;
  const toHand = all.filter((i) => i.family === 'deadline' && i.status === 'todo' && i.start < weekEnd).length;
  const exams = all.filter((i) => i.family === 'exam' && i.status === 'todo' && i.start < now + 14 * DAY).length;
  const late = all.filter((i) => i.status === 'late').length;
  const newDocs = ((S.agenda && S.agenda.news) || []).filter((n) => n.kind === 'files' && n.time > now - 7 * DAY).reduce((s, n) => s + n.files.length, 0);
  const next = all.find((i) => i.status === 'todo' && i.family !== 'info' && i.start >= now);
  const tile = (n, label, cls, onclick) => h('button', { type: 'button', class: `tile ${cls}`, onclick }, h('span', { class: 'n' }, String(n)), h('span', { class: 'l' }, label));
  return h(
    'div',
    { class: 'summary' },
    tile(toHand, 'à rendre dans les 7 jours', 'deadline', () => setFilter('deadline')),
    tile(exams, exams > 1 ? 'examens dans les 14 jours' : 'examen dans les 14 jours', 'exam', () => setFilter('exam')),
    tile(late, 'en retard', late ? 'late' : 'neutral', () => setFilter('all')),
    tile(newDocs, newDocs > 1 ? 'nouveaux documents' : 'nouveau document', 'docs', () => go('news')),
    next
      ? h(
          'div',
          { class: 'next' },
          h('span', { class: 'l' }, 'Prochaine échéance'),
          h('span', { class: 'next-title' }, next.title),
          h('span', { class: 'next-when' }, `${dayLabel(next.start)}${next.allDay ? '' : ` à ${fmtTime.format(next.start)}`} · ${relative(next)}`)
        )
      : null
  );
}

function setFilter(f) {
  S.filter = f;
  render();
}

function toolbar() {
  const seg = (value, label) =>
    h('button', { type: 'button', class: S.filter === value ? 'active' : '', onclick: () => setFilter(value) }, label);
  const search = h('input', {
    type: 'search',
    class: 'search',
    placeholder: 'Rechercher…',
    value: S.search,
    oninput: (e) => {
      S.search = e.target.value;
      renderList();
    },
  });
  return h(
    'div',
    { class: 'toolbar' },
    h('div', { class: 'segmented' }, seg('all', 'Tout'), seg('deadline', 'À rendre'), seg('exam', 'Examens'), seg('info', 'Infos')),
    search,
    h(
      'label',
      { class: 'toggle' },
      h('input', {
        type: 'checkbox',
        checked: S.showDone,
        onchange: (e) => {
          S.showDone = e.target.checked;
          renderList();
        },
      }),
      'Afficher terminés et passés'
    )
  );
}

function agendaList() {
  const now = Date.now();
  const list = items().filter(matchesFilters);
  const late = list.filter((i) => i.status === 'late');
  const upcoming = list.filter((i) => i.status === 'todo' || (S.showDone && i.status !== 'late'));
  const container = h('div', { class: 'agenda', id: 'agenda-list' });

  if (late.length) {
    container.append(h('h2', { class: 'day late' }, 'En retard'), ...late.map((i) => itemCard(i)));
  }
  let lastDay = null;
  let lastWeek = null;
  const thisWeek = startOfWeek(now);
  for (const it of upcoming) {
    const wk = startOfWeek(it.start);
    if (wk !== lastWeek && wk > thisWeek) {
      const label = wk === thisWeek + 7 * DAY ? 'Semaine prochaine' : `Semaine du ${fmtDayMonth.format(wk)}`;
      container.append(h('div', { class: 'week-sep' }, h('span', null, label)));
    }
    lastWeek = wk;
    const dk = startOfDay(it.start);
    if (dk !== lastDay) {
      const diff = dayDiff(it.start);
      container.append(
        h('h2', { class: `day${diff === 0 ? ' today' : ''}` }, dayLabel(it.start), diff > 1 ? h('span', { class: 'day-rel' }, `dans ${diff} jours`) : null)
      );
      lastDay = dk;
    }
    container.append(itemCard(it));
  }
  if (!late.length && !upcoming.length) {
    container.append(
      h(
        'div',
        { class: 'empty' },
        S.status.state === 'running' ? 'Synchronisation en cours…' : S.search || S.filter !== 'all' ? 'Rien ne correspond à ce filtre.' : 'Rien de prévu pour l’instant. Profite ! 🎉'
      )
    );
  }
  return container;
}

function renderList() {
  const old = document.getElementById('agenda-list');
  if (old) old.replaceWith(agendaList());
}

function viewAgenda() {
  if (!isConfigured()) return h('div', { class: 'page' }, onboarding());
  const name = S.settings.moodle.userName ? S.settings.moodle.userName.split(' ')[0] : '';
  return h(
    'div',
    { class: 'page' },
    errorBanner(),
    h('div', { class: 'hello' }, h('h1', null, name ? `Salut ${name} !` : 'Salut !'), h('p', null, cap(fmtLong.format(Date.now())))),
    summary(),
    toolbar(),
    agendaList()
  );
}

function viewWeek() {
  const start = startOfWeek(Date.now()) + S.weekOffset * 7 * DAY;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.getTime();
  });
  const end = days[6] + DAY;
  const list = items().filter((i) => i.start >= start && i.start < end && matchesFilters(i));
  const label =
    S.weekOffset === 0 ? 'Cette semaine' : S.weekOffset === 1 ? 'Semaine prochaine' : S.weekOffset === -1 ? 'Semaine dernière' : `Semaine du ${fmtDayMonth.format(start)}`;
  const nav = h(
    'div',
    { class: 'week-nav' },
    h('button', { type: 'button', class: 'icon-btn', title: 'Semaine précédente', onclick: () => ((S.weekOffset -= 1), render()) }, icon('left')),
    h('h1', null, label, h('span', { class: 'week-range' }, `${fmtDayMonth.format(start)} – ${fmtDayMonth.format(days[6])}`)),
    h('button', { type: 'button', class: 'icon-btn', title: 'Semaine suivante', onclick: () => ((S.weekOffset += 1), render()) }, icon('chevron')),
    S.weekOffset !== 0 ? h('button', { type: 'button', class: 'btn small', onclick: () => ((S.weekOffset = 0), render()) }, "Aujourd'hui") : null
  );
  const grid = h(
    'div',
    { class: 'week-grid' },
    days.map((d) => {
      const dayItems = list.filter((i) => startOfDay(i.start) === d);
      const today = d === startOfDay(Date.now());
      return h(
        'div',
        { class: `col${today ? ' today' : ''}${dayItems.length ? '' : ' empty-col'}` },
        h('div', { class: 'col-head' }, h('span', { class: 'wd' }, cap(fmtWeekday.format(d))), h('span', { class: 'dn' }, String(new Date(d).getDate()))),
        dayItems.map((it) =>
          h(
            'button',
            { type: 'button', class: `mini type-${it.type} ${it.status}`, onclick: () => openItem(it.id) },
            h('span', { class: 'mini-time' }, it.allDay ? (TYPES[it.type] || TYPES.event).label : fmtTime.format(it.start)),
            h('span', { class: 'mini-title' }, it.title),
            it.courseShort ? h('span', { class: 'mini-course', style: { '--c': courseColor(it.courseId) } }, it.courseShort) : null
          )
        )
      );
    })
  );
  let hint = null;
  if (!list.length) {
    const next = items().find((i) => i.start >= end && i.status === 'todo' && matchesFilters(i));
    hint = h(
      'p',
      { class: 'week-hint' },
      next ? `Rien cette semaine. Prochaine échéance : ${next.title} — ${dayLabel(next.start).toLowerCase()} (${relative(next)}).` : 'Rien de prévu cette semaine.'
    );
  }
  return h('div', { class: 'page wide' }, errorBanner(), nav, h('div', { class: 'toolbar slim' }, toolbar().firstChild), hint, grid);
}

function viewNews() {
  const news = (S.agenda && S.agenda.news) || [];
  const entries = news.map((n) => {
    const head = h(
      'div',
      { class: 'news-head' },
      h('span', { class: `news-kind ${n.kind}` }, icon(n.kind === 'files' ? 'folder' : n.kind === 'mail' ? 'mail' : 'megaphone')),
      h(
        'div',
        { class: 'news-titles' },
        h('div', { class: 'news-title' }, n.kind === 'files' ? `${n.files.length} nouveau${n.files.length > 1 ? 'x' : ''} document${n.files.length > 1 ? 's' : ''}` : n.title),
        h('div', { class: 'news-meta' }, [n.courseName, n.author, ago(n.time)].filter(Boolean).join(' · '))
      )
    );
    const body = [];
    if (n.kind === 'files') body.push(h('div', { class: 'chips' }, n.files.map(fileChip)));
    if (n.excerpt) body.push(h('p', { class: 'excerpt' }, n.excerpt));
    if (n.kind === 'mail' && n.attachments && n.attachments.length) body.push(h('div', { class: 'chips' }, n.attachments.map(fileChip)));
    const actions = [];
    if (n.kind === 'announcement') actions.push(linkButton('Voir sur Moodle', n.url));
    if (n.kind === 'mail') actions.push(h('button', { type: 'button', class: 'btn ghost small', onclick: () => openMail(n.mailKey) }, icon('mail'), 'Lire le mail'));
    if (n.kind === 'mail' && n.events) actions.push(h('span', { class: 'pill' }, `${n.events} échéance${n.events > 1 ? 's' : ''} ajoutée${n.events > 1 ? 's' : ''} à l’agenda`));
    return h('article', { class: 'news-item' }, head, body, actions.length ? h('div', { class: 'actions' }, actions) : null);
  });
  return h(
    'div',
    { class: 'page' },
    errorBanner(),
    h('div', { class: 'hello' }, h('h1', null, 'Nouveautés'), h('p', null, 'Documents ajoutés, annonces des profs et mails importants des derniers jours.')),
    entries.length ? entries : h('div', { class: 'empty' }, 'Aucune nouveauté récente.')
  );
}

function viewCourses() {
  const courses = (S.agenda && S.agenda.courses) || [];
  if (!courses.length) {
    return h('div', { class: 'page' }, h('div', { class: 'empty' }, S.settings.moodle.hasToken ? 'Aucun cours trouvé pour l’instant.' : 'Connecte ton Moodle pour voir tes cours.'));
  }
  const cards = courses.map((c) => {
    const key = `course:${c.id}`;
    const open = S.expanded.has(key);
    const bySection = new Map();
    for (const f of c.files) {
      const k = f.sectionName || 'Général';
      if (!bySection.has(k)) bySection.set(k, []);
      bySection.get(k).push(f);
    }
    return h(
      'article',
      { class: `course-card${c.hidden ? ' hidden-course' : ''}`, style: { '--c': courseColor(c.id) } },
      h(
        'div',
        { class: 'course-head' },
        h('i', { class: 'bar' }),
        h('div', { class: 'course-titles' }, h('div', { class: 'course-name' }, c.fullName), h('div', { class: 'course-short' }, c.shortName)),
        c.upcoming ? h('span', { class: 'pill' }, `${c.upcoming} à venir`) : null
      ),
      h(
        'div',
        { class: 'actions' },
        linkButton('Moodle', c.url),
        c.files.length || c.links.length
          ? h(
              'button',
              {
                type: 'button',
                class: `btn ghost small${open ? ' active' : ''}`,
                onclick: () => {
                  if (open) S.expanded.delete(key);
                  else S.expanded.add(key);
                  render();
                },
              },
              icon('folder'),
              [
                c.files.length ? `${c.files.length} document${c.files.length > 1 ? 's' : ''}` : '',
                c.links.length ? `${c.links.length} lien${c.links.length > 1 ? 's' : ''}` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost small subtle',
            title: c.hidden ? 'Réafficher ce cours' : 'Masquer ce cours (ancien semestre, option non suivie…)',
            onclick: () =>
              guarded(async () => {
                S.agenda = await api.setCourseHidden(c.id, !c.hidden);
                render();
              }),
          },
          icon(c.hidden ? 'eye' : 'eyeOff'),
          c.hidden ? 'Réafficher' : 'Masquer'
        )
      ),
      open
        ? h(
            'div',
            { class: 'course-files' },
            [...bySection.entries()].map(([section, files]) => h('div', { class: 'section' }, h('h4', null, section), h('div', { class: 'chips' }, files.map(fileChip)))),
            c.links.length ? h('div', { class: 'section' }, h('h4', null, 'Liens'), h('div', { class: 'chips' }, c.links.map((l) => linkButton(l.label, l.url)))) : null
          )
        : null
    );
  });
  return h(
    'div',
    { class: 'page wide' },
    h(
      'div',
      { class: 'hello row' },
      h('div', null, h('h1', null, 'Mes cours'), h('p', null, 'Les documents s’ouvrent dans ton lecteur habituel et sont gardés dans un dossier par cours.')),
      h('button', { type: 'button', class: 'btn', onclick: () => guarded(() => api.openFilesFolder()) }, icon('folder'), 'Ouvrir le dossier des documents')
    ),
    h('div', { class: 'course-grid' }, cards)
  );
}

// ---------------------------------------------------------------- settings

function field(label, input, help) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, help ? h('span', { class: 'help' }, help) : null);
}

function switchRow(label, checked, onchange, help) {
  return h(
    'label',
    { class: 'switch-row' },
    h('input', { type: 'checkbox', class: 'switch', checked, onchange: (e) => onchange(e.target.checked) }),
    h('span', null, h('span', { class: 'switch-label' }, label), help ? h('span', { class: 'help' }, help) : null)
  );
}

async function saveSettings(partial, message = 'Enregistré') {
  const s = await guarded(() => api.saveSettings(partial), message);
  if (s) S.settings = s;
  render();
  return s;
}

function moodleSection() {
  const m = S.settings.moodle;
  if (m.hasToken) {
    return h(
      'section',
      { class: 'panel' },
      h('h2', null, 'Moodle'),
      h('p', { class: 'connected' }, icon('check'), 'Connecté à ', h('strong', null, m.siteName || m.baseUrl), m.userName ? ` en tant que ${m.userName}` : ''),
      h('p', { class: 'help' }, m.baseUrl),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () =>
              guarded(async () => {
                S.settings = await api.moodleLogout();
                S.moodleCheck = null;
                render();
              }),
          },
          'Se déconnecter / changer de compte'
        )
      )
    );
  }
  const urlInput = h('input', {
    type: 'url',
    id: 'moodle-url',
    placeholder: 'ex. moodle.univ-ville.fr',
    value: S.moodleUrl ?? m.baseUrl,
    oninput: (e) => (S.moodleUrl = e.target.value),
  });
  const check = S.moodleCheck;
  const busy = S.busy.moodle;
  const login = (method, extra = {}) =>
    guarded(async () => {
      const url = urlInput.value;
      S.busy.moodle = true;
      render();
      try {
        S.settings = await api.moodleLogin({ url, method, ...extra });
        S.moodleUrl = null;
        toast('Moodle connecté ! Première synchronisation en cours…', 'ok');
      } finally {
        S.busy.moodle = false;
        render();
      }
    });
  const user = h('input', { type: 'text', id: 'moodle-user', autocomplete: 'username', placeholder: 'Identifiant' });
  const pass = h('input', { type: 'password', id: 'moodle-pass', autocomplete: 'current-password', placeholder: 'Mot de passe' });
  const token = h('input', { type: 'text', id: 'moodle-token', placeholder: 'Jeton (32 caractères)' });
  const recommendPassword = check && check.typeOfLogin === 1 && !check.identityProviders.length;
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Moodle'),
    field(
      'Adresse de ton Moodle',
      h(
        'div',
        { class: 'inline' },
        urlInput,
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () =>
              guarded(async () => {
                S.moodleCheck = await api.moodleCheck(urlInput.value);
                S.moodleUrl = S.moodleCheck.baseUrl;
                render();
              }),
          },
          'Vérifier'
        )
      ),
      'Copie l’adresse affichée dans ton navigateur quand tu es sur Moodle.'
    ),
    check ? h('p', { class: 'connected' }, icon('check'), `Trouvé : ${check.siteName || check.baseUrl}`) : null,
    h(
      'div',
      { class: 'login-methods' },
      h(
        'div',
        { class: `method${recommendPassword ? '' : ' recommended'}` },
        h('h3', null, 'Avec la page de connexion de l’université (ENT, CAS…)'),
        h('p', { class: 'help' }, 'Une fenêtre s’ouvre : connecte-toi comme d’habitude. Ton mot de passe n’est pas enregistré par l’appli.'),
        h('button', { type: 'button', class: 'btn primary', disabled: busy, onclick: () => login('sso') }, busy ? 'Connexion…' : 'Se connecter')
      ),
      h(
        'div',
        { class: `method${recommendPassword ? ' recommended' : ''}` },
        h('h3', null, 'Avec identifiant et mot de passe Moodle'),
        h('div', { class: 'inline' }, user, pass),
        h('button', { type: 'button', class: 'btn', disabled: busy, onclick: () => login('password', { username: user.value, password: pass.value }) }, 'Se connecter')
      ),
      h(
        'details',
        { class: 'method' },
        h('summary', null, 'Avec un jeton (si les autres méthodes ne marchent pas)'),
        h('p', { class: 'help' }, 'Sur Moodle : ton profil → Préférences → Clés de sécurité → copie la clé « Moodle mobile web service ».'),
        h('div', { class: 'inline' }, token, h('button', { type: 'button', class: 'btn', disabled: busy, onclick: () => login('token', { token: token.value }) }, 'Utiliser'))
      )
    )
  );
}

const MAIL_HELP = {
  custom:
    'Messagerie de l’université : cherche « IMAP » dans l’aide de ta messagerie ou sur le site de la DSI (adresse du serveur, en général port 993 avec SSL).',
  gmail: 'Gmail : active la validation en deux étapes puis crée un « mot de passe d’application » (myaccount.google.com/apppasswords) et colle-le ici.',
  outlook:
    'Microsoft 365 / Outlook : beaucoup d’universités bloquent la connexion IMAP par mot de passe. Si le test échoue, transfère automatiquement tes mails universitaires vers une adresse Gmail et connecte ce Gmail.',
  yahoo: 'Yahoo : crée un mot de passe d’application dans la sécurité du compte.',
  orange: 'Orange : utilise ton adresse complète et ton mot de passe de messagerie.',
  free: 'Free : utilise ton adresse complète et ton mot de passe de messagerie.',
  laposte: 'La Poste : utilise ton adresse complète et ton mot de passe.',
};

function mailSection() {
  const m = S.settings.mail;
  const preset = h(
    'select',
    {
      id: 'mail-preset',
      onchange: (e) => {
        const p = S.presets[e.target.value];
        if (p) {
          document.getElementById('mail-host').value = p.host;
          document.getElementById('mail-port').value = p.port;
          document.getElementById('mail-secure').checked = p.secure;
        }
        document.getElementById('mail-help').textContent = MAIL_HELP[e.target.value] || MAIL_HELP.custom;
      },
    },
    [
      ['custom', 'Messagerie de l’université / autre'],
      ['gmail', 'Gmail'],
      ['outlook', 'Outlook / Microsoft 365'],
      ['yahoo', 'Yahoo'],
      ['orange', 'Orange'],
      ['free', 'Free'],
      ['laposte', 'La Poste'],
    ].map(([v, l]) => h('option', { value: v, selected: m.preset === v ? true : null }, l))
  );
  const readForm = () => ({
    enabled: document.getElementById('mail-enabled').checked,
    preset: document.getElementById('mail-preset').value,
    host: document.getElementById('mail-host').value.trim(),
    port: Number(document.getElementById('mail-port').value) || 993,
    secure: document.getElementById('mail-secure').checked,
    user: document.getElementById('mail-user').value.trim(),
    password: document.getElementById('mail-pass').value,
    mailboxes: document
      .getElementById('mail-boxes')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sinceDays: Number(document.getElementById('mail-days').value) || 30,
    senderFilter: document.getElementById('mail-filter').value.trim(),
  });
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Mails'),
    h(
      'label',
      { class: 'switch-row' },
      h('input', { type: 'checkbox', class: 'switch', id: 'mail-enabled', checked: m.enabled }),
      h('span', null, h('span', { class: 'switch-label' }, 'Lire ma boîte mail'), h('span', { class: 'help' }, 'Les mails restent sur ton ordinateur ; rien n’est modifié ni supprimé dans ta boîte.'))
    ),
    h(
      'div',
      { class: 'grid2' },
      field('Fournisseur', preset),
      field('Adresse e-mail / identifiant', h('input', { type: 'text', id: 'mail-user', value: m.user, autocomplete: 'username' })),
      field('Serveur IMAP', h('input', { type: 'text', id: 'mail-host', value: m.host, placeholder: 'imap.exemple.fr' })),
      field(
        'Port',
        h(
          'div',
          { class: 'inline' },
          h('input', { type: 'number', id: 'mail-port', value: m.port, min: '1', max: '65535', class: 'short' }),
          h('label', { class: 'toggle' }, h('input', { type: 'checkbox', id: 'mail-secure', checked: m.secure }), 'SSL/TLS')
        )
      ),
      field('Mot de passe', h('input', { type: 'password', id: 'mail-pass', placeholder: m.hasPassword ? '•••••••• (enregistré)' : '', autocomplete: 'current-password' })),
      field('Dossiers à lire', h('input', { type: 'text', id: 'mail-boxes', value: (m.mailboxes || ['INBOX']).join(', ') }), 'Séparés par des virgules. INBOX = boîte de réception.'),
      field('Période', h('select', { id: 'mail-days' }, [14, 30, 60, 90].map((d) => h('option', { value: d, selected: Number(m.sinceDays) === d ? true : null }, `${d} derniers jours`)))),
      field(
        'Ne garder que les expéditeurs contenant',
        h('input', { type: 'text', id: 'mail-filter', value: m.senderFilter, placeholder: 'ex. univ-ville.fr, moodle' }),
        'Optionnel. Laisse vide pour analyser tous les mails.'
      )
    ),
    h('p', { class: 'help', id: 'mail-help' }, MAIL_HELP[m.preset] || MAIL_HELP.custom),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          disabled: S.busy.mailTest,
          onclick: async () => {
            S.busy.mailTest = true;
            const res = await guarded(() => api.mailTest(readForm()));
            S.busy.mailTest = false;
            if (res) toast(`Connexion réussie : ${res.map((b) => `${b.mailbox} (${b.messages} messages)`).join(', ')}`, 'ok');
          },
        },
        'Tester la connexion'
      ),
      h('button', { type: 'button', class: 'btn primary', onclick: () => saveSettings({ mail: readForm() }, 'Réglages mail enregistrés') }, 'Enregistrer')
    )
  );
}

function aiSection() {
  const a = S.settings.ai;
  const key = h('input', { type: 'password', id: 'ai-key', placeholder: a.hasApiKey ? '•••••••• (enregistrée)' : 'sk-ant-…' });
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Analyse intelligente des mails (optionnel)'),
    h(
      'p',
      { class: 'help' },
      'Sans IA, l’appli repère les dates et les mots-clés (partiel, à rendre, chapitres…). Avec Claude, elle comprend aussi les consignes plus floues et résume mieux ce qu’il faut travailler. Il faut une clé API Anthropic (console.anthropic.com), facturée à l’usage : environ 1 à 2 centimes par mail analysé, chaque mail n’est analysé qu’une fois. Le texte des mails qui parlent de cours est alors envoyé à l’API d’Anthropic.'
    ),
    h(
      'label',
      { class: 'switch-row' },
      h('input', { type: 'checkbox', class: 'switch', id: 'ai-enabled', checked: a.enabled }),
      h('span', null, h('span', { class: 'switch-label' }, 'Utiliser Claude pour analyser les mails et annonces'))
    ),
    field('Clé API', key),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => guarded(() => api.aiTest(key.value), 'Clé valide ✔') }, 'Tester la clé'),
      h(
        'button',
        { type: 'button', class: 'btn primary', onclick: () => saveSettings({ ai: { enabled: document.getElementById('ai-enabled').checked, apiKey: key.value } }) },
        'Enregistrer'
      )
    )
  );
}

function generalSection() {
  const g = S.settings.general;
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Général'),
    h(
      'div',
      { class: 'grid2' },
      field(
        'Synchroniser toutes les',
        h(
          'select',
          { onchange: (e) => saveSettings({ general: { syncMinutes: Number(e.target.value) } }) },
          [10, 20, 30, 60].map((n) => h('option', { value: n, selected: Number(g.syncMinutes) === n ? true : null }, `${n} minutes`))
        )
      ),
      field(
        'Me rappeler une échéance',
        h(
          'select',
          { onchange: (e) => saveSettings({ general: { reminderHours: Number(e.target.value) } }) },
          [
            [12, '12 h avant'],
            [24, '24 h avant'],
            [48, '2 jours avant'],
            [72, '3 jours avant'],
          ].map(([n, l]) => h('option', { value: n, selected: Number(g.reminderHours) === n ? true : null }, l))
        )
      )
    ),
    switchRow('Notifications', g.notifications, (v) => saveSettings({ general: { notifications: v } }), 'Nouveau devoir, nouvel examen, nouveaux documents, rappels.'),
    switchRow('Lancer au démarrage de l’ordinateur', g.openAtLogin, (v) => saveSettings({ general: { openAtLogin: v } }), 'L’appli démarre discrètement et se met à jour en arrière-plan.'),
    switchRow('Continuer en arrière-plan quand je ferme la fenêtre', g.closeToTray, (v) => saveSettings({ general: { closeToTray: v } }), 'Une icône reste près de l’horloge.'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => guarded(() => api.openFilesFolder()) }, icon('folder'), 'Dossier des documents téléchargés')),
    S.settings.encryption ? null : h('p', { class: 'help warn' }, 'Le trousseau du système n’est pas disponible : les mots de passe sont enregistrés sans chiffrement fort sur cet ordinateur.'),
    h('p', { class: 'help' }, `Version ${S.version}`)
  );
}

function viewSettings() {
  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'hello' }, h('h1', null, 'Réglages')),
    errorBanner(),
    moodleSection(),
    mailSection(),
    aiSection(),
    generalSection()
  );
}

// ---------------------------------------------------------------- modals

function closeModal() {
  $('#modal-root').replaceChildren();
}

function modal(title, content) {
  const box = h(
    'div',
    { class: 'modal-backdrop', onclick: (e) => e.target === e.currentTarget && closeModal() },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { type: 'button', class: 'icon-btn', title: 'Fermer', onclick: closeModal }, icon('x'))),
      h('div', { class: 'modal-body' }, content)
    )
  );
  $('#modal-root').replaceChildren(box);
}

function openItem(id) {
  const it = items().find((i) => i.id === id);
  if (!it) return;
  modal(`${dayLabel(it.start)}${it.allDay ? '' : ` · ${fmtTime.format(it.start)}`}`, itemCard(it, { forceOpen: true }));
}

async function openMail(key) {
  const mail = await guarded(() => api.getMail(key));
  if (!mail) return;
  modal(
    mail.subject,
    h(
      'div',
      { class: 'mail' },
      h('div', { class: 'mail-meta' }, h('strong', null, mail.from.name || mail.from.address), mail.from.name ? ` <${mail.from.address}>` : '', ' · ', fmtFull.format(mail.date)),
      mail.attachments.length ? h('div', { class: 'chips' }, mail.attachments.map(fileChip)) : null,
      h('pre', { class: 'mail-text' }, mail.text || '(message vide)')
    )
  );
}

// ---------------------------------------------------------------- shell

function go(view) {
  S.view = view;
  closeModal();
  render();
  $('#main').scrollTop = 0;
}

function renderTopbar() {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.view === S.view);
  $('#settings-btn').classList.toggle('active', S.view === 'settings');
  const st = S.status || {};
  const btn = $('#sync');
  let text;
  let cls = 'sync';
  if (st.state === 'running') {
    text = st.step || 'Synchronisation…';
    cls += ' running';
  } else if (st.state === 'error') {
    text = st.lastSync ? `Problème · ${ago(st.lastSync)}` : 'Problème de synchro';
    cls += ' error';
  } else if (st.lastSync) {
    text = `À jour · ${ago(st.lastSync)}`;
  } else {
    text = 'Synchroniser';
  }
  btn.className = cls;
  btn.replaceChildren(icon('sync'), h('span', null, text));
  btn.disabled = st.state === 'running' || !isConfigured();
}

function render() {
  if (!S.settings) return;
  renderTopbar();
  const main = $('#main');
  const scroll = main.scrollTop;
  const views = { agenda: viewAgenda, week: viewWeek, news: viewNews, courses: viewCourses, settings: viewSettings };
  main.replaceChildren((views[S.view] || viewAgenda)());
  main.scrollTop = scroll;
}

async function boot() {
  $('#settings-btn').append(icon('gear'));
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => go(b.dataset.view));
  $('#settings-btn').addEventListener('click', () => go('settings'));
  $('#sync').addEventListener('click', () => guarded(() => api.syncNow()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  const init = await api.init();
  S.settings = init.settings;
  S.status = init.status;
  S.agenda = init.agenda;
  S.presets = init.presets;
  S.version = init.version;
  if (!isConfigured()) S.view = 'agenda';

  api.onData((agenda) => {
    S.agenda = agenda;
    if (S.view !== 'settings') render();
  });
  api.onStatus((status) => {
    S.status = status;
    renderTopbar();
    if (status.state !== 'running' && S.view !== 'settings') render();
  });
  api.onFocusItem((id) => {
    S.view = 'agenda';
    S.expanded.add(id);
    render();
    const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // Keep "dans 3 h" and "il y a 2 min" fresh without disturbing typing.
  setInterval(() => {
    const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (S.view === 'settings' || typing || $('#modal-root').childElementCount) renderTopbar();
    else render();
  }, 60 * 1000);

  render();
}

boot().catch((e) => {
  document.body.append(h('pre', { class: 'fatal' }, `Erreur au démarrage : ${e.message}`));
});
