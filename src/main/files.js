'use strict';

// Downloads Moodle documents on demand (with the user's token) and keeps them in a local folder,
// sorted by course, so they can be opened with the default app (PDF reader…).

const fs = require('fs');
const path = require('path');
const { safeFileName } = require('./util');

/**
 * Returns the local path of a file, downloading it first if needed.
 * @param {object} file      entry of agenda.fileIndex
 * @param {object} ctx       {client: MoodleClient, filesDir, courseName(id)}
 */
async function ensureLocalFile(file, { client, filesDir, attachmentsDir, courseName }) {
  if (file.kind === 'mail') {
    const resolved = path.resolve(file.path);
    // Only open attachments this app saved itself.
    if (!resolved.startsWith(path.resolve(attachmentsDir) + path.sep)) throw new Error('Pièce jointe introuvable.');
    if (!fs.existsSync(resolved)) throw new Error('Pièce jointe introuvable (supprimée ?).');
    return resolved;
  }
  if (!client) throw new Error('Connecte-toi à Moodle pour ouvrir ce document.');
  const dir = path.join(filesDir, safeFileName(courseName(file.courseId) || 'Autres'));
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, safeFileName(file.name));
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (stat && stat.size > 0 && (!file.timemodified || stat.mtimeMs >= file.timemodified * 1000)) return target;

  const res = await client.fetch(client.authFileUrl(file.url));
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}).`);
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  // Moodle answers errors in JSON with a 200 status.
  if (type.includes('application/json') && buf.length < 4000 && !/\.json$/i.test(file.name)) {
    let msg = 'Moodle a refusé le téléchargement.';
    try {
      msg = JSON.parse(buf.toString('utf8')).error || msg;
    } catch {}
    throw new Error(msg);
  }
  fs.writeFileSync(target, buf);
  return target;
}

module.exports = { ensureLocalFile };
