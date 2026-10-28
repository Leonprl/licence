'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  init: () => call('init'),
  syncNow: () => call('sync-now'),
  moodleCheck: (url) => call('moodle-check', url),
  moodleLogin: (params) => call('moodle-login', params),
  moodleLogout: () => call('moodle-logout'),
  mailTest: (cfg) => call('mail-test', cfg),
  aiTest: (apiKey) => call('ai-test', apiKey),
  saveSettings: (partial) => call('save-settings', partial),
  setDone: (id, done) => call('set-done', id, done),
  hideItem: (id) => call('hide-item', id),
  setCourseHidden: (courseId, hidden) => call('set-course-hidden', courseId, hidden),
  openFile: (fileId) => call('open-file', fileId),
  openFilesFolder: () => call('open-files-folder'),
  openExternal: (url) => call('open-external', url),
  getMail: (key) => call('get-mail', key),
  onData: (cb) => subscribe('data-updated', cb),
  onStatus: (cb) => subscribe('sync-status', cb),
  onFocusItem: (cb) => subscribe('focus-item', cb),
});
