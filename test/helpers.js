'use strict';

// A fake Moodle answering the web service calls used by the app, with dates relative to `now`.

const DAY = 24 * 3600;

function fakeMoodle({ now = Date.now(), submitted = false, extraEvents = [] } = {}) {
  const t = Math.floor(now / 1000);
  const base = 'https://moodle.univ-test.fr';
  const calls = [];
  const data = {
    core_webservice_get_site_info: () => ({
      sitename: 'Moodle Univ Test',
      userid: 7,
      fullname: 'Léa Martin',
      firstname: 'Léa',
      release: '4.5',
      functions: [],
    }),
    core_enrol_get_users_courses: () => [
      { id: 11, shortname: 'L2-MACRO', fullname: 'Macroéconomie 1', startdate: t - 60 * DAY, enddate: t + 90 * DAY },
      { id: 12, shortname: 'L2-STAT', fullname: 'Statistiques descriptives', startdate: t - 60 * DAY, enddate: 0 },
      { id: 13, shortname: 'L1-HIST', fullname: 'Histoire économique', startdate: t - 500 * DAY, enddate: t - 200 * DAY },
    ],
    core_course_get_contents: (p) => {
      if (p.get('courseid') === '11') {
        return [
          { id: 1, section: 0, name: 'Généralités', modules: [{ id: 100, modname: 'forum', instance: 5, name: 'Annonces', url: `${base}/mod/forum/view.php?id=100` }] },
          {
            id: 2,
            section: 1,
            name: 'Chapitre 1 : Le PIB',
            modules: [
              { id: 101, modname: 'resource', instance: 1, name: 'Cours chapitre 1', url: `${base}/mod/resource/view.php?id=101`, contents: [{ type: 'file', filename: 'CM1_PIB.pdf', filepath: '/', fileurl: `${base}/webservice/pluginfile.php/1/mod_resource/content/1/CM1_PIB.pdf`, mimetype: 'application/pdf', filesize: 1000, timemodified: t - 40 * DAY }] },
              { id: 102, modname: 'assign', instance: 55, name: 'Dossier TD 3', url: `${base}/mod/assign/view.php?id=102` },
            ],
          },
          {
            id: 3,
            section: 2,
            name: 'Chapitre 2 : Inflation',
            modules: [
              { id: 103, modname: 'resource', instance: 2, name: 'Cours chapitre 2', url: `${base}/mod/resource/view.php?id=103`, contents: [{ type: 'file', filename: 'Chapitre2_inflation.pdf', filepath: '/', fileurl: `${base}/webservice/pluginfile.php/2/mod_resource/content/1/Chapitre2_inflation.pdf`, mimetype: 'application/pdf', filesize: 1000, timemodified: t - 2 * DAY }] },
              { id: 104, modname: 'folder', instance: 3, name: 'TD', url: `${base}/mod/folder/view.php?id=104`, contents: [{ type: 'file', filename: 'TD3_enonce.pdf', filepath: '/', fileurl: `${base}/webservice/pluginfile.php/3/mod_folder/content/0/TD3_enonce.pdf`, mimetype: 'application/pdf', filesize: 1000, timemodified: t - 1 * DAY }] },
              { id: 105, modname: 'url', instance: 4, name: 'Site INSEE', url: `${base}/mod/url/view.php?id=105`, contents: [{ type: 'url', filename: 'Site INSEE', fileurl: 'https://www.insee.fr' }] },
            ],
          },
        ];
      }
      return [{ id: 9, section: 0, name: '', modules: [{ id: 200, modname: 'quiz', instance: 77, name: 'QCM chapitre 1', url: `${base}/mod/quiz/view.php?id=200` }] }];
    },
    core_calendar_get_calendar_events: () => ({
      events: [
        { id: 1001, name: 'Dossier TD 3 est dû', description: '<p>Déposer le PDF</p>', courseid: 11, modulename: 'assign', instance: 55, eventtype: 'due', timestart: t + 3 * DAY, timeduration: 0 },
        { id: 1002, name: 'QCM chapitre 1 ferme', description: '', courseid: 12, modulename: 'quiz', instance: 77, eventtype: 'close', timestart: t + 5 * DAY, timeduration: 0 },
        { id: 1003, name: 'QCM chapitre 1 ouvre', description: '', courseid: 12, modulename: 'quiz', instance: 77, eventtype: 'open', timestart: t + 1 * DAY, timeduration: 0 },
        { id: 1004, name: 'Partiel de macroéconomie', description: 'Amphi A', courseid: 11, modulename: '', instance: 0, eventtype: 'course', timestart: t + 10 * DAY, timeduration: 2 * 3600 },
        ...extraEvents,
      ],
      warnings: [],
    }),
    mod_assign_get_assignments: () => ({
      courses: [
        {
          id: 11,
          assignments: [
            { id: 55, cmid: 102, name: 'Dossier TD 3', intro: '<p>Rédiger le dossier &amp; le déposer.</p>', duedate: t + 3 * DAY, cutoffdate: 0, introattachments: [{ filename: 'Sujet_TD3.pdf', fileurl: `${base}/webservice/pluginfile.php/9/mod_assign/introattachment/0/Sujet_TD3.pdf`, mimetype: 'application/pdf', filesize: 500, timemodified: t - 5 * DAY }] },
          ],
        },
      ],
      warnings: [],
    }),
    mod_assign_get_submission_status: () => ({ lastattempt: { submission: { status: submitted ? 'submitted' : 'new' }, gradingstatus: 'notgraded' } }),
    mod_forum_get_forums_by_courses: () => [{ id: 5, course: 11, type: 'news', name: 'Annonces', numdiscussions: 1 }],
    mod_forum_get_forum_discussions: () => ({
      discussions: [
        {
          id: 900,
          discussion: 90,
          name: 'Partiel',
          subject: 'Partiel de macroéconomie',
          message: `<p>Le partiel aura lieu le ${new Date((t + 10 * DAY) * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}. Il portera sur les chapitres 1 et 2.</p>`,
          userfullname: 'M. Dupont',
          created: t - 1 * DAY,
          timemodified: t - 1 * DAY,
          attachment: false,
        },
      ],
    }),
  };

  async function fetchImpl(url, opts = {}) {
    const u = new URL(url);
    if (u.pathname.endsWith('/webservice/rest/server.php')) {
      const params = new URLSearchParams(opts.body);
      const fn = params.get('wsfunction');
      calls.push(fn);
      if (params.get('wstoken') !== 'tok') return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
      if (!data[fn]) return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
      return json(data[fn](params));
    }
    if (u.pathname.includes('pluginfile.php')) {
      return new Response(Buffer.from('%PDF-1.4 fake'), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response('not found', { status: 404 });
  }

  return { fetchImpl, calls, base };
}

function json(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** Stand-in for Electron's safeStorage. */
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`X${Buffer.from(s).toString('hex')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(1), 'hex').toString(),
};

module.exports = { fakeMoodle, fakeSafeStorage, DAY };
