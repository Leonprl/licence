'use strict';

// Minimal iCalendar (.ics) reader for timetable links (ADE, Moodle export, Google Agenda…).

/** Converts an .ics date (20261112T140000Z, 20261112T140000, 20261112) to {time, allDay}. */
function parseIcsDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se, z] = m;
  if (h === undefined || /VALUE=DATE(?!-)/i.test(params || '')) {
    return { time: new Date(Number(y), Number(mo) - 1, Number(d)).getTime(), allDay: true };
  }
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se || 0)];
  // Times with a TZID are taken as local time: timetables are in the student's own time zone.
  const time = z ? Date.UTC(...parts) : new Date(...parts).getTime();
  return { time, allDay: false };
}

function unescapeText(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/** @returns {{uid, summary, description, location, start, end, allDay}[]} */
function parseIcs(text) {
  // Unfold continuation lines (RFC 5545: a line starting with a space continues the previous one).
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...rest] = head.split(';');
    const params = rest.join(';');
    switch (name.toUpperCase()) {
      case 'UID':
        cur.uid = value.trim();
        break;
      case 'SUMMARY':
        cur.summary = unescapeText(value);
        break;
      case 'DESCRIPTION':
        cur.description = unescapeText(value);
        break;
      case 'LOCATION':
        cur.location = unescapeText(value);
        break;
      case 'DTSTART': {
        const d = parseIcsDate(value, params);
        if (d) {
          cur.start = d.time;
          cur.allDay = d.allDay;
        }
        break;
      }
      case 'DTEND': {
        const d = parseIcsDate(value, params);
        if (d) cur.end = d.allDay ? null : d.time;
        break;
      }
      default:
        break;
    }
  }
  return events.map((e) => ({ uid: e.uid || '', summary: e.summary || '(sans titre)', description: e.description || '', location: e.location || '', start: e.start, end: e.end || null, allDay: Boolean(e.allDay) }));
}

/** Downloads a calendar link (webcal:// is accepted). */
async function fetchIcs(url, fetchImpl = globalThis.fetch) {
  const httpUrl = String(url).trim().replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(httpUrl)) throw new Error('Le lien du calendrier doit commencer par https://');
  const res = await fetchImpl(httpUrl);
  if (!res.ok) throw new Error(`Calendrier injoignable (${res.status}).`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error("Ce lien ne renvoie pas un calendrier (.ics).");
  return parseIcs(text);
}

module.exports = { parseIcs, parseIcsDate, fetchIcs };
