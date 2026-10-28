'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { extractWithClaude, toEvents } = require('../src/main/ai');

function fakeApi(answer) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(answer) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        })
      );
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

test('sends one structured-output request and converts the answer', async () => {
  const api = await fakeApi({
    events: [
      { type: 'exam', title: 'Partiel de macroéconomie', date: '2026-11-12', time: '14:00', course: 'Macroéconomie 1', location: 'amphi B', todo: ['Chapitres 1 à 3', 'Annales 2024'] },
      { type: 'deadline', title: 'Rendre le dossier', date: 'bientôt', time: '', course: '', location: '', todo: [] },
    ],
  });
  const previous = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = api.url;
  try {
    const r = await extractWithClaude({
      apiKey: 'sk-test',
      msg: { subject: 'Partiel', from: 'Prof <p@u.fr>', date: new Date(2026, 9, 28).getTime(), text: 'Le partiel aura lieu le 12 novembre à 14h.' },
      courseNames: ['Macroéconomie 1', 'Statistiques'],
    });
    assert.equal(api.requests.length, 1);
    const { url, headers, body } = api.requests[0];
    assert.match(url, /\/v1\/messages/);
    assert.equal(headers['x-api-key'], 'sk-test');
    assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(body.model, 'claude-opus-5-5');
    assert.equal(body.fallbacks, 'default');
    assert.equal(body.output_config.effort, 'low');
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.thinking, undefined);
    assert.match(body.messages[0].content, /Macroéconomie 1 \| Statistiques/);

    assert.equal(r.events.length, 1, 'invalid dates are dropped');
    const e = r.events[0];
    assert.equal(e.type, 'exam');
    assert.equal(e.courseHint, 'Macroéconomie 1');
    assert.equal(new Date(e.start).getHours(), 14);
    assert.deepEqual(e.refs, [{ kind: 'chapitre', nums: [1, 2, 3] }]);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previous;
    api.server.close();
  }
});

test('ignores course names Claude made up', () => {
  const [e] = toEvents({ events: [{ type: 'info', title: 'Cours annulé', date: '2026-11-02', time: '', course: 'Inventé', location: '', todo: [] }] }, ['Vrai cours']);
  assert.equal(e.courseHint, '');
  assert.equal(e.allDay, true);
});
