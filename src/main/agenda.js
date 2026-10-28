'use strict';

// Turns raw Moodle data, e-mails and extracted events into what the window shows:
// a dated list of things to do, a news feed and the course list.

const { classifySentence, classifyCalendarEntry } = require('./extract');
const { dayKey, normalize, shortHash, truncate } = require('./util');

const DAY = 24 * 3600 * 1000;

const STOP_WORDS = new Set(
  'cours licence pour dans avec introduction groupe annee semestre partie parties travaux diriges pratiques general generale generales principes fondamentaux module modules notions bases elements initiation approfondissement analyse methodes methodologie projet atelier option options seminaire'.split(' ')
);

function familyOf(type) {
  if (type === 'exam' || type === 'quiz') return 'exam';
  if (type === 'deadline') return 'deadline';
  return 'info';
}

function significantTokens(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

/** Finds which course a piece of text talks about. Returns a course or null. */
function matchCourse(text, courses, hint) {
  if (hint) {
    const exact = courses.find((c) => c.fullName === hint || c.shortName === hint);
    if (exact) return exact;
  }
  const norm = ` ${normalize(text)} `;
  let best = null;
  let bestScore = 0;
  for (const c of courses) {
    let score = 0;
    const short = normalize(c.shortName).trim();
    if (short.length >= 4 && norm.includes(short)) score += 3;
    for (const tok of new Set(significantTokens(`${c.fullName} ${c.shortName}`))) {
      if (new RegExp(`[^a-z0-9]${tok}[^a-z0-9]`).test(norm)) score += tok.length >= 7 ? 2.5 : 1;
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

const FILE_NUM_PATTERNS = {
  td: /\btds?\s*[_\-.]?\s*n?°?\s*(\d{1,2})\b/g,
  tp: /\btps?\s*[_\-.]?\s*n?°?\s*(\d{1,2})\b/g,
  chapitre: /\b(?:chapitres?|chap|ch|cm|cours|parties?|lecons?|themes?|seances?|modules?)\s*[_\-.]?\s*n?°?\s*(\d{1,2})\b/g,
};

function fileNumbers(file) {
  const text = normalize(`${file.name} ${file.moduleName || ''} ${file.sectionName || ''}`).replace(/_/g, ' ');
  const out = {};
  for (const [kind, re] of Object.entries(FILE_NUM_PATTERNS)) {
    out[kind] = new Set();
    for (const m of text.matchAll(re)) out[kind].add(Number(m[1]));
  }
  return out;
}

function fileMatchesRefs(file, refs) {
  if (!refs || !refs.length) return false;
  const nums = fileNumbers(file);
  return refs.some((r) => r.nums.some((n) => nums[r.kind] && nums[r.kind].has(n)));
}

/** Picks the course documents to show under an item: referenced chapters first, then same section, then recent. */
function relatedFiles(courseFiles, { refs, sectionNum, now, limit = 6 }) {
  return courseFiles
    .map((f) => {
      const recommended = fileMatchesRefs(f, refs);
      let score = recommended ? 10 : 0;
      if (sectionNum !== undefined && sectionNum !== null && f.sectionNum === sectionNum) score += 5;
      if (f.timemodified * 1000 > now - 30 * DAY) score += 2;
      return { ...f, recommended, score };
    })
    .sort((a, b) => b.score - a.score || b.timemodified - a.timemodified)
    .slice(0, limit)
    .map(({ score, ...f }) => f);
}

function moodleFileRef(f) {
  return {
    id: f.id,
    kind: 'moodle',
    name: f.name,
    url: f.url,
    mimetype: f.mimetype,
    size: f.size,
    timemodified: f.timemodified,
    sectionName: f.sectionName || '',
    sectionNum: f.sectionNum,
    moduleName: f.moduleName || '',
    moduleUrl: f.moduleUrl || null,
    courseId: f.courseId,
  };
}

function attachmentRef(a, mail) {
  return { id: `att-${shortHash(a.path)}`, kind: 'mail', name: a.name, path: a.path, mimetype: a.mimetype, size: a.size, mailKey: mail && mail.key };
}

/** Records when each Moodle file was first seen, so new uploads can be listed in "Nouveautés". */
function updateFileFirstSeen(snapshot, state, now) {
  if (!snapshot) return;
  const firstRun = Object.keys(state.fileFirstSeen).length === 0;
  for (const sections of Object.values(snapshot.contents || {})) {
    for (const s of sections) {
      for (const m of s.modules) {
        for (const f of m.files) {
          if (!state.fileFirstSeen[f.id]) state.fileFirstSeen[f.id] = firstRun ? f.timemodified * 1000 : now;
        }
      }
    }
  }
}

/** Blocks of text written on course pages (section summaries, labels…) that may contain dates. */
function pageTexts(snapshot) {
  const out = [];
  for (const [courseId, sections] of Object.entries((snapshot && snapshot.contents) || {})) {
    for (const s of sections) {
      const blocks = [{ text: s.summary, label: s.name, sectionNum: s.num, url: null }];
      for (const m of s.modules) if (m.description) blocks.push({ text: m.description, label: m.name, sectionNum: s.num, url: m.url });
      for (const b of blocks) {
        if (!b.text || !/\d/.test(b.text)) continue;
        out.push({ key: `page:${courseId}:${shortHash(b.text)}`, courseId: Number(courseId), sectionNum: b.sectionNum, label: b.label || 'Page du cours', text: b.text, url: b.url });
      }
    }
  }
  return out;
}

function mergeInto(target, extra) {
  for (const line of extra.todo || []) if (!target.todo.includes(line) && target.todo.length < 10) target.todo.push(line);
  target.refs = [...(target.refs || []), ...(extra.refs || [])];
  for (const f of extra.files || []) if (!target.files.some((x) => x.id === f.id)) target.files.push(f);
  for (const s of extra.sources || []) if (!target.sources.some((x) => x.ref === s.ref)) target.sources.push(s);
  if (!target.location && extra.location) target.location = extra.location;
  if (!target.description && extra.description) target.description = extra.description;
  if (!target.courseId && extra.courseId) {
    target.courseId = extra.courseId;
    target.courseName = extra.courseName;
    target.courseShort = extra.courseShort;
  }
  if (extra.confidence === 'sure') target.confidence = 'sure';
}

function titlesOverlap(a, b) {
  const ta = new Set(significantTokens(a).filter((t) => t.length >= 5));
  return significantTokens(b).some((t) => ta.has(t));
}

/**
 * @param {object} args
 * @param {object|null} args.snapshot   result of MoodleClient.fetchSnapshot
 * @param {object[]} args.mails         e-mails from mail.fetchMails
 * @param {object} args.extractions     {sourceKey: {events, todo, refs, academic}}
 * @param {object} args.state           user state (done, hiddenCourses, fileFirstSeen…)
 * @param {number} args.now
 */
function buildAgenda({ snapshot, mails = [], extractions = {}, calendars = [], state, now = Date.now() }) {
  const hiddenCourses = new Set(state.hiddenCourses || []);
  const allCourses = (snapshot && snapshot.courses) || [];
  const courses = allCourses.filter((c) => !hiddenCourses.has(c.id));
  const courseById = new Map(allCourses.map((c) => [c.id, c]));
  const filesByCourse = new Map();
  const modulesByCmid = new Map();
  const fileIndex = {};

  for (const [courseId, sections] of Object.entries((snapshot && snapshot.contents) || {})) {
    const list = [];
    for (const s of sections) {
      for (const m of s.modules) {
        modulesByCmid.set(m.id, { ...m, sectionNum: s.num, sectionName: s.name });
        for (const f of m.files) {
          const ref = moodleFileRef(f);
          list.push(ref);
          fileIndex[ref.id] = ref;
        }
      }
    }
    filesByCourse.set(Number(courseId), list);
  }

  const courseInfo = (c) => (c ? { courseId: c.id, courseName: c.fullName, courseShort: c.shortName } : { courseId: null, courseName: '', courseShort: '' });
  const items = [];

  // 1. Moodle calendar: assignments, quizzes, course events.
  for (const ev of (snapshot && snapshot.events) || []) {
    if (ev.courseId && hiddenCourses.has(ev.courseId)) continue;
    const course = courseById.get(ev.courseId) || null;
    const module = ev.cmid ? modulesByCmid.get(ev.cmid) : null;
    let type;
    let title = ev.name;
    if (ev.modulename === 'assign') {
      if (ev.eventtype !== 'due') continue;
      type = 'deadline';
    } else if (ev.modulename === 'quiz') {
      if (ev.eventtype !== 'close') continue;
      type = 'quiz';
    } else if (ev.modulename) {
      if (/^(open|opensubmission|openassessment|expectcompletionon|gradingdue)$/.test(ev.eventtype)) continue;
      type = /due|close|deadline/.test(ev.eventtype) ? 'deadline' : 'event';
    } else {
      const kind = classifySentence(`${ev.name} ${ev.description}`);
      type = kind === 'exam' ? 'exam' : kind === 'deadline' ? 'deadline' : 'event';
    }
    if (module) title = module.name;

    const item = {
      id: `moodle-${ev.id}`,
      type,
      title,
      ...courseInfo(course),
      start: ev.timestart,
      end: ev.duration ? ev.timestart + ev.duration : null,
      allDay: false,
      description: truncate(ev.description, 2000),
      location: ev.location || '',
      todo: [],
      refs: [],
      files: [],
      links: [{ label: 'Ouvrir dans Moodle', url: ev.url }],
      sources: [{ kind: 'moodle', label: 'Calendrier Moodle', ref: `moodle-${ev.id}`, url: ev.url }],
      confidence: 'sure',
      submitted: null,
      sectionNum: module ? module.sectionNum : null,
    };

    if (ev.modulename === 'assign') {
      const a = (snapshot.assignments || {})[ev.instance];
      if (a) {
        item.title = a.name;
        item.description = truncate(a.intro || ev.description, 2000);
        item.submitted = a.submitted;
        for (const f of a.attachments) {
          const ref = moodleFileRef(f);
          fileIndex[ref.id] = ref;
          item.files.push(ref);
        }
      }
    }
    items.push(item);
  }

  // 2. Events found in e-mails and announcements.
  const extracted = [];
  for (const mail of mails) {
    const ex = extractions[mail.key];
    if (!ex || !ex.events) continue;
    const files = (mail.attachments || []).map((a) => attachmentRef(a, mail));
    for (const f of files) fileIndex[f.id] = f;
    for (const e of ex.events) {
      const course = matchCourse(`${mail.subject}\n${e.title}\n${(mail.text || '').slice(0, 1500)}`, courses, e.courseHint);
      extracted.push({
        id: `mail-${shortHash(`${mail.key}|${e.type}|${dayKey(e.start)}|${e.title}`)}`,
        type: e.type,
        title: e.title,
        ...courseInfo(course),
        start: e.start,
        end: e.end || null,
        allDay: Boolean(e.allDay),
        description: e.detail || '',
        location: e.location || '',
        todo: [...(e.todo || [])],
        refs: e.refs || [],
        files: [...files],
        links: [],
        sources: [{ kind: 'mail', label: `Mail de ${mail.from.name || mail.from.address || '?'} : « ${truncate(mail.subject, 80)} »`, ref: mail.key, mailKey: mail.key, date: mail.date }],
        confidence: e.confidence || 'probable',
        submitted: null,
        sectionNum: null,
      });
    }
  }
  for (const ann of (snapshot && snapshot.announcements) || []) {
    if (hiddenCourses.has(ann.courseId)) continue;
    const ex = extractions[`ann:${ann.id}:${ann.time}`];
    if (!ex || !ex.events) continue;
    const course = courseById.get(ann.courseId) || null;
    const files = ann.attachments.map((f) => {
      const ref = moodleFileRef(f);
      fileIndex[ref.id] = ref;
      return ref;
    });
    for (const e of ex.events) {
      extracted.push({
        id: `ann-${shortHash(`${ann.id}|${e.type}|${dayKey(e.start)}|${e.title}`)}`,
        type: e.type,
        title: e.title,
        ...courseInfo(course),
        start: e.start,
        end: e.end || null,
        allDay: Boolean(e.allDay),
        description: e.detail || '',
        location: e.location || '',
        todo: [...(e.todo || [])],
        refs: e.refs || [],
        files,
        links: [{ label: "Voir l'annonce", url: ann.url }],
        sources: [{ kind: 'announcement', label: `Annonce de ${ann.author || 'l’enseignant'} : « ${truncate(ann.subject, 80)} »`, ref: `ann-${ann.id}`, url: ann.url, date: ann.time }],
        confidence: e.confidence || 'probable',
        submitted: null,
        sectionNum: null,
      });
    }
  }

  // Dates written directly on course pages.
  const pages = pageTexts(snapshot);
  for (const p of pages) {
    const course = courseById.get(p.courseId);
    const ex = extractions[p.key];
    if (!course || hiddenCourses.has(p.courseId) || !ex || !ex.events) continue;
    const url = p.url || `${course.url}#section-${p.sectionNum}`;
    for (const e of ex.events) {
      extracted.push({
        id: `page-${shortHash(`${p.key}|${e.type}|${dayKey(e.start)}`)}`,
        type: e.type,
        title: e.title,
        ...courseInfo(course),
        start: e.start,
        end: e.end || null,
        allDay: Boolean(e.allDay),
        description: e.detail || '',
        location: e.location || '',
        todo: [...(e.todo || [])],
        refs: e.refs || [],
        files: [],
        links: [{ label: 'Voir sur Moodle', url }],
        sources: [{ kind: 'page', label: `Page du cours : « ${truncate(p.label, 60)} »`, ref: p.key, url }],
        confidence: e.confidence || 'probable',
        submitted: null,
        sectionNum: p.sectionNum,
      });
    }
  }

  // Timetable links (.ics): exams and hand-ins only, unless the student asked for everything.
  for (const cal of calendars) {
    for (const ev of cal.events || []) {
      if (ev.start < now - 21 * DAY || ev.start > now + 220 * DAY) continue;
      const kind = classifyCalendarEntry(`${ev.summary} ${ev.description}`);
      const type = kind || (cal.all ? 'event' : null);
      if (!type) continue;
      const course = matchCourse(`${ev.summary}\n${ev.description}`, courses);
      extracted.push({
        id: `ics-${shortHash(`${cal.url}|${ev.uid}|${ev.start}`)}`,
        type,
        title: ev.summary,
        ...courseInfo(course),
        start: ev.start,
        end: ev.end || null,
        allDay: Boolean(ev.allDay),
        description: truncate(ev.description, 1500),
        location: ev.location || '',
        todo: [],
        refs: [],
        files: [],
        links: [],
        sources: [{ kind: 'calendar', label: `Calendrier « ${cal.name || 'importé'} »`, ref: `ics-${cal.url}` }],
        confidence: 'sure',
        submitted: null,
        sectionNum: null,
      });
    }
  }

  // 3. Merge duplicates (the same exam announced on Moodle, by e-mail and in a reminder).
  for (const x of extracted) {
    const target = items.find((it) => {
      if (familyOf(it.type) !== familyOf(x.type) || dayKey(it.start) !== dayKey(x.start)) return false;
      if (it.courseId && x.courseId) return it.courseId === x.courseId;
      return titlesOverlap(it.title, x.title);
    });
    if (target) mergeInto(target, x);
    else items.push(x);
  }

  // 4. Status, documents, final shape.
  const visible = items.filter((it) => it.start >= now - 21 * DAY && !(state.hiddenItems || {})[it.id]);
  for (const it of visible) {
    const ended = (it.end || it.start + (it.allDay ? DAY : 0)) < now;
    it.manualDone = Boolean((state.done || {})[it.id]);
    if (it.manualDone || it.submitted) it.status = 'done';
    else if (ended) it.status = it.type === 'deadline' || it.type === 'quiz' ? 'late' : 'past';
    else it.status = 'todo';
    const courseFiles = it.courseId ? filesByCourse.get(it.courseId) || [] : [];
    it.related = relatedFiles(courseFiles.filter((f) => !it.files.some((x) => x.id === f.id)), {
      refs: it.refs,
      sectionNum: it.sectionNum,
      now,
    });
    it.files = it.files.map((f) => ({ ...f, recommended: fileMatchesRefs(f, it.refs) }));
    it.family = familyOf(it.type);
    delete it.refs;
    delete it.sectionNum;
  }
  visible.sort((a, b) => a.start - b.start);

  // 5. News feed.
  const news = [];
  const recentFiles = new Map();
  for (const [courseId, list] of filesByCourse) {
    if (hiddenCourses.has(courseId)) continue;
    for (const f of list) {
      const seen = (state.fileFirstSeen || {})[f.id] || f.timemodified * 1000;
      if (seen < now - 10 * DAY) continue;
      const key = `${courseId}|${dayKey(seen)}`;
      if (!recentFiles.has(key)) recentFiles.set(key, { kind: 'files', time: seen, ...courseInfo(courseById.get(courseId)), files: [] });
      const group = recentFiles.get(key);
      group.time = Math.max(group.time, seen);
      group.files.push(f);
    }
  }
  news.push(...recentFiles.values());
  for (const ann of (snapshot && snapshot.announcements) || []) {
    if (hiddenCourses.has(ann.courseId) || ann.time < now - 21 * DAY) continue;
    news.push({
      kind: 'announcement',
      time: ann.time,
      title: ann.subject,
      author: ann.author,
      excerpt: truncate(ann.message.replace(/\s+/g, ' '), 320),
      url: ann.url,
      ...courseInfo(courseById.get(ann.courseId)),
    });
  }
  for (const mail of mails) {
    const ex = extractions[mail.key];
    if (mail.date < now - 14 * DAY || !ex || !ex.academic) continue;
    const course = matchCourse(`${mail.subject}\n${(mail.text || '').slice(0, 1500)}`, courses);
    news.push({
      kind: 'mail',
      time: mail.date,
      title: mail.subject,
      author: mail.from.name || mail.from.address,
      excerpt: truncate((mail.text || '').replace(/\s+/g, ' '), 320),
      mailKey: mail.key,
      events: ex.events.length,
      attachments: (mail.attachments || []).map((a) => attachmentRef(a, mail)),
      ...courseInfo(course),
    });
  }
  news.sort((a, b) => b.time - a.time);

  // 6. Courses.
  const courseList = allCourses.map((c) => ({
    id: c.id,
    shortName: c.shortName,
    fullName: c.fullName,
    url: c.url,
    hidden: hiddenCourses.has(c.id),
    files: (filesByCourse.get(c.id) || []).slice().sort((a, b) => (a.sectionNum ?? 0) - (b.sectionNum ?? 0) || a.name.localeCompare(b.name)),
    links: (((snapshot && snapshot.contents) || {})[c.id] || []).flatMap((s) => s.modules.flatMap((m) => m.links)),
    upcoming: visible.filter((it) => it.courseId === c.id && it.status === 'todo').length,
  }));

  // 7. What was analysed, for the "Ce que l'appli a trouvé" panel.
  const upcoming = visible.filter((i) => i.status === 'todo');
  const stats = {
    moodle: snapshot
      ? {
          site: snapshot.site.name,
          url: snapshot.site.url,
          fetchedAt: snapshot.fetchedAt,
          courses: courses.length,
          hiddenCourses: hiddenCourses.size,
          calendarEvents: (snapshot.events || []).length,
          assignments: Object.keys(snapshot.assignments || {}).length,
          announcements: (snapshot.announcements || []).length,
          pages: pages.length,
          files: [...filesByCourse.values()].reduce((n, l) => n + l.length, 0),
          warnings: snapshot.warnings || [],
        }
      : null,
    mails: { total: mails.length, withDates: mails.filter((m) => extractions[m.key] && extractions[m.key].events && extractions[m.key].events.length).length },
    calendars: calendars.map((c) => ({ name: c.name, url: c.url, events: (c.events || []).length, error: c.error || null })),
    upcoming: {
      exam: upcoming.filter((i) => i.family === 'exam').length,
      deadline: upcoming.filter((i) => i.family === 'deadline').length,
      info: upcoming.filter((i) => i.family === 'info').length,
    },
  };

  return { generatedAt: now, items: visible, news: news.slice(0, 80), courses: courseList, fileIndex, stats };
}

module.exports = { buildAgenda, matchCourse, relatedFiles, fileMatchesRefs, fileNumbers, updateFileFirstSeen, familyOf, pageTexts };
