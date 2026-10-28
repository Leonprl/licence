'use strict';

// Client for the Moodle web services used by the official Moodle mobile app
// (service "moodle_mobile_app"), which every university Moodle with the
// mobile app enabled exposes to its students.

const { htmlToText, decodeEntities, mapLimit } = require('./util');

const SERVICE = 'moodle_mobile_app';
const DAY = 24 * 3600 * 1000;
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };

class MoodleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MoodleError';
    this.code = code || 'moodleerror';
  }

  get needsLogin() {
    return ['invalidtoken', 'accessexception', 'servicerequireslogin', 'usernotfullysetup'].includes(this.code);
  }
}

/** Flattens nested params into Moodle's REST form encoding: a[0]=1, options[x]=2. */
function flattenParams(value, prefix, out) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenParams(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenParams(v, prefix ? `${prefix}[${k}]` : k, out);
  } else if (value !== undefined && value !== null) {
    out.append(prefix, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return out;
}

/** Turns whatever the user pasted (course page, login page…) into the site root URL. */
function normalizeBaseUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw new MoodleError("Indique l'adresse de ton Moodle.", 'nourl');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new MoodleError("L'adresse du Moodle n'est pas valide.", 'badurl');
  }
  let path = parsed.pathname
    .replace(/\/(login|my|course|mod|user|calendar|admin|grade|message|blocks|webservice|pluginfile\.php)(\/.*)?$/i, '')
    .replace(/\/(index\.php)?$/i, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
}

function fileFromMoodle(f, extra) {
  return {
    name: f.filename,
    url: f.fileurl,
    mimetype: f.mimetype || '',
    size: f.filesize || 0,
    timemodified: f.timemodified || f.timecreated || 0,
    ...extra,
  };
}

class MoodleClient {
  constructor({ baseUrl, token, fetchImpl }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  static normalizeBaseUrl(url) {
    return normalizeBaseUrl(url);
  }

  /** Public, unauthenticated info about the site: name, login type, SSO launch URL. */
  static async getPublicConfig(baseUrl, fetchImpl = globalThis.fetch) {
    const root = normalizeBaseUrl(baseUrl);
    let res;
    try {
      res = await fetchImpl(`${root}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ index: 0, methodname: 'tool_mobile_get_public_config', args: {} }]),
      });
    } catch (e) {
      throw new MoodleError(`Impossible de joindre ${root} (${e.message}).`, 'network');
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new MoodleError("Ce site ne répond pas comme un Moodle. Vérifie l'adresse.", 'notmoodle');
    }
    const r = Array.isArray(data) ? data[0] : data;
    if (!r || r.error) {
      const msg = (r && r.exception && r.exception.message) || "L'application mobile n'est pas activée sur ce Moodle.";
      throw new MoodleError(msg, 'nomobile');
    }
    const cfg = r.data || {};
    return {
      baseUrl: root,
      wwwroot: cfg.wwwroot || root,
      siteName: decodeEntities(cfg.sitename || ''),
      // 1 = identifiant/mot de passe dans l'app, 2 = navigateur, 3 = navigateur intégré
      typeOfLogin: cfg.typeoflogin,
      launchUrl: cfg.launchurl || `${root}/admin/tool/mobile/launch.php`,
      // CAS / OAuth buttons of the login page: [{name, url}]
      identityProviders: (cfg.identityproviders || []).filter((p) => p && p.url).map((p) => ({ name: decodeEntities(p.name || ''), url: p.url })),
      mobileEnabled: cfg.enablemobilewebservice !== 0,
    };
  }

  static async loginWithPassword(baseUrl, username, password, fetchImpl = globalThis.fetch) {
    const root = normalizeBaseUrl(baseUrl);
    const body = new URLSearchParams({ username, password, service: SERVICE });
    let res;
    try {
      res = await fetchImpl(`${root}/login/token.php`, { method: 'POST', headers: FORM_HEADERS, body: body.toString() });
    } catch (e) {
      throw new MoodleError(`Impossible de joindre ${root} (${e.message}).`, 'network');
    }
    const data = await res.json().catch(() => ({}));
    if (!data.token) {
      if (data.errorcode === 'invalidlogin') {
        throw new MoodleError(
          "Moodle refuse cet identifiant ou ce mot de passe. Si tu te connectes d'habitude par l'ENT / CAS de ta fac, ton compte Moodle n'a pas de mot de passe propre : utilise plutôt « Se connecter » avec la page de l'université.",
          data.errorcode
        );
      }
      const detail = data.errorcode ? ` (code : ${data.errorcode})` : '';
      throw new MoodleError(`${data.error || 'Connexion refusée par Moodle.'}${detail}`, data.errorcode || 'loginfailed');
    }
    return { token: data.token, privateToken: data.privatetoken || null };
  }

  async call(wsfunction, params = {}) {
    const body = flattenParams(params, '', new URLSearchParams());
    body.append('wstoken', this.token);
    body.append('wsfunction', wsfunction);
    body.append('moodlewsrestformat', 'json');
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/webservice/rest/server.php?wsfunction=${wsfunction}`, {
        method: 'POST',
        headers: FORM_HEADERS,
        body: body.toString(),
      });
    } catch (e) {
      throw new MoodleError(`Moodle injoignable (${e.message}).`, 'network');
    }
    if (!res.ok) throw new MoodleError(`Moodle a répondu ${res.status}.`, 'http');
    const data = await res.json().catch(() => null);
    if (data && typeof data === 'object' && !Array.isArray(data) && (data.exception || data.errorcode)) {
      throw new MoodleError(data.message || data.errorcode, data.errorcode);
    }
    return data;
  }

  /** Adds the token to a Moodle file URL. Refuses URLs of other hosts so the token never leaks. */
  authFileUrl(url) {
    const u = new URL(url);
    const base = new URL(this.baseUrl);
    if (u.host !== base.host) throw new MoodleError('Lien de fichier externe à Moodle.', 'foreignfile');
    u.protocol = base.protocol;
    if (u.pathname.includes('/pluginfile.php') && !u.pathname.includes('/webservice/pluginfile.php')) {
      u.pathname = u.pathname.replace('/pluginfile.php', '/webservice/pluginfile.php');
    }
    u.searchParams.set('token', this.token);
    return u.toString();
  }

  async getSiteInfo() {
    const info = await this.call('core_webservice_get_site_info');
    return {
      siteName: decodeEntities(info.sitename),
      userId: info.userid,
      fullName: info.fullname,
      firstName: info.firstname,
      release: info.release,
      functions: new Set((info.functions || []).map((f) => f.name)),
    };
  }

  /**
   * Downloads everything the dashboard needs in one go.
   * Individual failures (one course, one function disabled) are recorded as warnings.
   */
  async fetchSnapshot({ now = Date.now(), pastDays = 10, futureDays = 200, hiddenCourseIds = [], onProgress = () => {} } = {}) {
    const warnings = [];
    const soft = async (label, fn, fallback) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof MoodleError && e.needsLogin) throw e;
        warnings.push(`${label} : ${e.message}`);
        return fallback;
      }
    };

    onProgress('Moodle : profil');
    const site = await this.getSiteInfo();
    const has = (fn) => site.functions.size === 0 || site.functions.has(fn);

    onProgress('Moodle : cours');
    const rawCourses = await this.call('core_enrol_get_users_courses', { userid: site.userId });
    const allCourses = (rawCourses || []).map((c) => ({
      id: c.id,
      shortName: decodeEntities(c.shortname),
      fullName: decodeEntities(c.fullname || c.displayname),
      url: `${this.baseUrl}/course/view.php?id=${c.id}`,
      startDate: (c.startdate || 0) * 1000,
      endDate: (c.enddate || 0) * 1000,
      lastAccess: (c.lastaccess || 0) * 1000,
      favourite: Boolean(c.isfavourite),
      categoryId: c.category || null,
    }));
    // Courses that ended more than a month ago (previous years) are left out.
    const courses = allCourses.filter((c) => !c.endDate || c.endDate > now - 30 * DAY);
    const hidden = new Set(hiddenCourseIds);
    const active = courses.filter((c) => !hidden.has(c.id));
    const courseIds = active.map((c) => c.id);

    onProgress('Moodle : contenu des cours');
    const contents = {};
    const moduleIndex = {};
    await mapLimit(active, 4, async (course) => {
      const sections = await soft(`Contenu de « ${course.shortName} »`, () => this.call('core_course_get_contents', { courseid: course.id }), []);
      contents[course.id] = (sections || []).map((s) => ({
        id: s.id,
        num: s.section,
        name: decodeEntities(s.name || ''),
        // Text written on the course page: teachers often put exam dates there.
        summary: htmlToText(s.summary).slice(0, 6000),
        modules: (s.modules || [])
          .filter((m) => m.uservisible !== false)
          .map((m) => {
            const mod = {
              id: m.id,
              modname: m.modname,
              instance: m.instance,
              name: decodeEntities(m.name),
              url: m.url || null,
              description: htmlToText(m.description).slice(0, 6000),
              files: [],
              links: [],
            };
            for (const c of m.contents || []) {
              if (c.type === 'file' && (m.modname === 'resource' || m.modname === 'folder')) {
                mod.files.push(
                  fileFromMoodle(c, {
                    id: `mf-${m.id}-${c.filepath || '/'}${c.filename}`,
                    courseId: course.id,
                    moduleName: mod.name,
                    moduleUrl: mod.url,
                    sectionName: decodeEntities(s.name || ''),
                    sectionNum: s.section,
                  })
                );
              } else if (c.type === 'url' && m.modname === 'url' && /^https?:/i.test(c.fileurl)) {
                mod.links.push({ label: mod.name, url: c.fileurl });
              }
            }
            moduleIndex[`${m.modname}:${m.instance}`] = { cmid: m.id, url: m.url, courseId: course.id, sectionNum: s.section };
            return mod;
          }),
      }));
    });

    onProgress('Moodle : calendrier');
    const from = Math.floor((now - pastDays * DAY) / 1000);
    const to = Math.floor((now + futureDays * DAY) / 1000);
    // Category events are those published for a whole programme (exam sessions, for instance).
    const categoryIds = [...new Set(active.map((c) => c.categoryId).filter(Boolean))];
    const calendarCall = (withCategories) =>
      this.call('core_calendar_get_calendar_events', {
        events: withCategories ? { courseids: courseIds, categoryids: categoryIds } : { courseids: courseIds },
        options: { userevents: 1, siteevents: 1, timestart: from, timeend: to },
      });
    let cal = { events: [] };
    if (courseIds.length) {
      try {
        cal = await calendarCall(categoryIds.length > 0);
      } catch (e) {
        if (e instanceof MoodleError && e.needsLogin) throw e;
        cal = await soft('Calendrier', () => calendarCall(false), { events: [] });
      }
    }
    const events = (cal.events || []).map((e) => {
      const mod = e.modulename ? moduleIndex[`${e.modulename}:${e.instance}`] : null;
      return {
        id: e.id,
        name: decodeEntities(e.name),
        description: htmlToText(e.description),
        courseId: e.courseid || null,
        modulename: e.modulename || null,
        instance: e.instance || null,
        eventtype: e.eventtype,
        timestart: e.timestart * 1000,
        duration: (e.timeduration || 0) * 1000,
        location: e.location || '',
        cmid: mod ? mod.cmid : null,
        url: mod && mod.url ? mod.url : `${this.baseUrl}/calendar/view.php?view=day&time=${e.timestart}`,
      };
    });

    onProgress('Moodle : devoirs');
    const assignments = {};
    if (courseIds.length && has('mod_assign_get_assignments')) {
      const res = await soft('Devoirs', () => this.call('mod_assign_get_assignments', { courseids: courseIds }), { courses: [] });
      for (const c of res.courses || []) {
        for (const a of c.assignments || []) {
          assignments[a.id] = {
            id: a.id,
            cmid: a.cmid,
            courseId: c.id,
            name: decodeEntities(a.name),
            duedate: (a.duedate || 0) * 1000,
            cutoffdate: (a.cutoffdate || 0) * 1000,
            intro: htmlToText(a.intro),
            url: `${this.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
            attachments: (a.introattachments || []).map((f) =>
              fileFromMoodle(f, { id: `ma-${a.id}-${f.filename}`, courseId: c.id, moduleName: decodeEntities(a.name) })
            ),
            submitted: null,
          };
        }
      }
      // Submission status, only for assignments that matter now.
      const relevant = Object.values(assignments).filter((a) => a.duedate && a.duedate > now - pastDays * DAY && a.duedate < now + futureDays * DAY);
      if (has('mod_assign_get_submission_status')) {
        await mapLimit(relevant, 4, async (a) => {
          const st = await soft(`Statut du devoir « ${a.name} »`, () => this.call('mod_assign_get_submission_status', { assignid: a.id }), null);
          const last = st && st.lastattempt;
          if (last) {
            const sub = last.submission || (last.teamsubmission && last.teamsubmission);
            a.submitted = Boolean(sub && sub.status === 'submitted');
            a.graded = last.gradingstatus === 'graded';
          }
        });
      }
    }

    onProgress('Moodle : annonces');
    const announcements = [];
    if (courseIds.length && has('mod_forum_get_forums_by_courses')) {
      const forums = await soft('Forums', () => this.call('mod_forum_get_forums_by_courses', { courseids: courseIds }), []);
      const news = (forums || []).filter((f) => f.type === 'news' && (f.numdiscussions === undefined || f.numdiscussions > 0));
      await mapLimit(news, 4, async (f) => {
        const res = await soft(
          `Annonces de ${f.name}`,
          () => this.call('mod_forum_get_forum_discussions', { forumid: f.id, sortorder: 1, page: 0, perpage: 10 }),
          { discussions: [] }
        );
        for (const d of (res && res.discussions) || []) {
          const time = (d.timemodified || d.created || 0) * 1000;
          if (time < now - 60 * DAY) continue;
          announcements.push({
            id: d.discussion,
            postId: d.id,
            courseId: f.course,
            forumName: decodeEntities(f.name),
            subject: decodeEntities(d.subject || d.name),
            message: htmlToText(d.message).slice(0, 20000),
            author: d.userfullname || '',
            time,
            created: (d.created || 0) * 1000,
            url: `${this.baseUrl}/mod/forum/discuss.php?d=${d.discussion}`,
            attachments: Array.isArray(d.attachments)
              ? d.attachments.map((a) => fileFromMoodle(a, { id: `fa-${d.id}-${a.filename}`, courseId: f.course, moduleName: decodeEntities(f.name) }))
              : [],
          });
        }
      });
    }

    return {
      fetchedAt: now,
      site: { name: site.siteName, url: this.baseUrl, userId: site.userId, fullName: site.fullName, firstName: site.firstName },
      courses,
      events,
      assignments,
      contents,
      announcements,
      warnings,
    };
  }
}

/**
 * Decodes the token returned by admin/tool/mobile/launch.php after an SSO login:
 * moodlemobile://token=BASE64(signature:::token:::privatetoken)
 */
function parseLaunchToken(url) {
  const m = String(url).match(/token=([A-Za-z0-9+/=_-]+)/);
  if (!m) return null;
  let decoded;
  try {
    decoded = Buffer.from(decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split(':::');
  if (parts.length < 2 || !/^[a-f0-9]{32}$/i.test(parts[1])) return null;
  return { signature: parts[0], token: parts[1], privateToken: parts[2] || null };
}

module.exports = { MoodleClient, MoodleError, flattenParams, normalizeBaseUrl, parseLaunchToken, SERVICE };
