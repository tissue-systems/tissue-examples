// Regression tests for the example Cells that spend an owner's API key or
// write on the owner's behalf (SEC-069, SEC-070, SEC-071, SEC-170, SEC-172,
// SEC-190). Each one refuses everyone until its token is set, refuses a wrong
// token, and keeps visitor text out of markup.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeC3, stubFetch, VAULT_UNSET } from './fake-c3.mjs';

import shortener, { __test as short } from '../js-url-shortener/cell.js';
import llmChat from '../js-llm-chat/cell.js';
import agent from '../js-ai-agent/cell.js';
import fts, { __test as ftsT } from '../js-fts5-search/cell.js';
import vec from '../js-vec-search/cell.js';
import vault from '../js-vault-secrets/cell.js';
import { __test as markup } from '../js-doc-markup/cell.js';

const call = (cell, env, path, init = {}) => cell.fetch(new Request('https://x.example.tissue.dev' + path, init), env);
const auth = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const json = (body, t) => ({ method: 'POST', headers: t ? auth(t) : { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ── SEC-069 ──────────────────────────────────────────────────────────────────
test('the vault-secrets signing helper ships switched off', async () => {
  const toml = readFileSync(new URL('../js-vault-secrets/ribo.toml', import.meta.url), 'utf8');
  assert.match(toml, /binding = "ENABLE_SIGNING_HELPER"\s*\nvalue\s*= "false"/);
  const env = { ENABLE_SIGNING_HELPER: 'false', WEBHOOK_SIGNING_SECRET: 'k'.repeat(32), UPSTREAM_API_KEY: 'u' };
  const res = await call(vault, env, '/sign', { method: 'POST', body: 'x' });
  assert.equal(res.status, 404);
});

// ── SEC-070 ──────────────────────────────────────────────────────────────────
test('url-shortener: writes and the link list need ADMIN_TOKEN; the redirect does not', async () => {
  const DB = fakeC3();
  for (const ADMIN_TOKEN of [undefined, VAULT_UNSET]) {
    assert.equal((await call(shortener, { DB, ADMIN_TOKEN }, '/shorten', json({ url: 'https://a.example' }, VAULT_UNSET))).status, 503);
  }
  const env = { DB, ADMIN_TOKEN: 'adm' };
  assert.equal((await call(shortener, env, '/shorten', json({ url: 'https://a.example', code: 'ok' }))).status, 401);
  assert.equal((await call(shortener, env, '/shorten', json({ url: 'https://a.example', code: 'ok' }, 'bad'))).status, 401);
  assert.equal((await call(shortener, env, '/links')).status, 401);
  assert.equal((await call(shortener, env, '/ok', { method: 'DELETE' })).status, 401);
  assert.equal((await call(shortener, env, '/shorten', json({ url: 'https://a.example', code: 'ok' }, 'adm'))).status, 201);
  const r = await call(shortener, env, '/ok');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://a.example');
});

test('url-shortener: codes are a plain path segment and targets are http(s)', async () => {
  const env = { DB: fakeC3(), ADMIN_TOKEN: 'adm' };
  for (const code of ["x');alert(1);('", 'a b', '../x', 'a/b', '%2e%2e', 'é', '', 'x'.repeat(33)]) {
    assert.equal((await call(shortener, env, '/shorten', json({ url: 'https://a.example', code }, 'adm'))).status, 400, code);
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://' + 'a'.repeat(2050)]) {
    assert.equal((await call(shortener, env, '/shorten', json({ url }, 'adm'))).status, 400, url.slice(0, 20));
  }
  // A row written before validation existed is not followed.
  env.DB.raw.exec("CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, url TEXT NOT NULL, clicks INTEGER DEFAULT 0, created_at TEXT)");
  env.DB.raw.prepare('INSERT INTO links (code, url) VALUES (?, ?)').run('old', 'javascript:alert(1)');
  assert.equal((await call(shortener, env, '/old')).status, 404);
  for (let i = 0; i < 50; i++) assert.match(short.randomCode(8), /^[a-z0-9]{8}$/);
});

test('url-shortener: the admin page never builds an inline handler from a code', async () => {
  const html = await (await call(shortener, { DB: fakeC3() }, '/')).text();
  assert.ok(!/onclick="del\(/.test(html));
  assert.match(html, /data-code=/);
});

// ── SEC-071 ──────────────────────────────────────────────────────────────────
test('llm-chat: no /configure, and /chat needs ACCESS_TOKEN before it spends the key', async (t) => {
  const calls = stubFetch(t, () => Response.json({ content: [{ text: 'hi' }], model: 'm', usage: {} }));
  const env = { ANTHROPIC_API_KEY: 'sk-ant-x', ACCESS_TOKEN: 'tok' };
  assert.equal((await call(llmChat, env, '/configure', json({ api_key: 'sk-ant-evil' }))).status, 404);
  assert.equal((await call(llmChat, { ...env, ACCESS_TOKEN: VAULT_UNSET }, '/chat', json({ message: 'x' }, VAULT_UNSET))).status, 503);
  assert.equal((await call(llmChat, env, '/chat', json({ message: 'x' }))).status, 401);
  assert.equal((await call(llmChat, env, '/chat', json({ message: 'x' }, 'tok2'))).status, 401);
  assert.equal((await call(llmChat, env, '/chat', json({ message: 'x', model: 'something-expensive' }, 'tok'))).status, 400);
  assert.equal((await call(llmChat, env, '/chat', json({ message: 'x', max_tokens: 100000 }, 'tok'))).status, 400);
  assert.equal(calls.length, 0);
  const ok = await call(llmChat, env, '/chat', json({ message: 'x' }, 'tok'));
  assert.equal(ok.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-x');
});

test('ai-agent: every route needs ACCESS_TOKEN, the key comes from the vault, and /configure is gone', async (t) => {
  const calls = stubFetch(t, () => Response.json({ content: [{ text: 'hello' }] }));
  const env = { DB: fakeC3(), ANTHROPIC_API_KEY: 'sk-ant-x', ACCESS_TOKEN: 'tok' };
  assert.equal((await call(agent, env, '/sessions')).status, 401);
  assert.equal((await call(agent, { ...env, ACCESS_TOKEN: undefined }, '/sessions')).status, 503);
  assert.equal((await call(agent, env, '/init', { method: 'POST', headers: auth('tok') })).status, 200);
  assert.equal((await call(agent, env, '/configure', json({ api_key: 'sk-ant-evil' }, 'tok'))).status, 404);
  const { session_id } = await (await call(agent, env, '/sessions', { method: 'POST', headers: auth('tok') })).json();
  assert.match(session_id, /^[0-9a-f]{16}$/);
  assert.equal((await call(agent, env, `/sessions/${session_id}/history`)).status, 401);
  const m = await call(agent, env, `/sessions/${session_id}/message`, json({ content: 'hi' }, 'tok'));
  assert.equal(m.status, 200);
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-x');
  assert.equal((await call(agent, env, '/sessions/..%2f/history', { headers: auth('tok') })).status, 404);
});

// ── SEC-170 ──────────────────────────────────────────────────────────────────
test('fts5-search: excerpts are escaped before <mark> goes in', async () => {
  assert.equal(ftsT.highlight('a <img onerror=x> \u0001b\u0002'), 'a &lt;img onerror=x&gt; <mark>b</mark>');
  const env = { DB: fakeC3(), WRITE_TOKEN: 'w' };
  const evil = '<img src=x onerror=alert(1)> garden';
  assert.equal((await call(fts, env, '/notes', json({ title: 't', body: evil }))).status, 401);
  assert.equal((await call(fts, { ...env, WRITE_TOKEN: VAULT_UNSET }, '/notes', json({ title: 't', body: evil }, VAULT_UNSET))).status, 503);
  assert.equal((await call(fts, env, '/notes', json({ title: 't', body: evil }, 'w'))).status, 201);
  assert.equal((await call(fts, env, '/notes/1', { method: 'DELETE' })).status, 401);
  const { results } = await (await call(fts, env, '/search?q=garden')).json();
  assert.equal(results.length, 1);
  assert.ok(!results[0].excerpt.includes('<img'), results[0].excerpt);
  assert.match(results[0].excerpt, /<mark>garden<\/mark>/);
});

// ── SEC-172 ──────────────────────────────────────────────────────────────────
test('vec-search: nothing reaches OpenAI without ACCESS_TOKEN, and bodies are capped', async (t) => {
  const calls = stubFetch(t, () => Response.json({ data: [{ embedding: Array(1536).fill(0.1) }] }));
  const env = { DB: fakeC3(), OPENAI_API_KEY: 'sk-x', ACCESS_TOKEN: 'tok' };
  assert.equal((await call(vec, env, '/documents', json({ title: 't', body: 'b' }))).status, 401);
  assert.equal((await call(vec, env, '/search?q=x')).status, 401);
  assert.equal((await call(vec, { ...env, ACCESS_TOKEN: VAULT_UNSET }, '/search?q=x', { headers: auth(VAULT_UNSET) })).status, 503);
  assert.equal((await call(vec, env, '/documents', json({ title: 't', body: 'b'.repeat(8001) }, 'tok'))).status, 400);
  assert.equal((await call(vec, env, '/search?q=' + 'q'.repeat(501), { headers: auth('tok') })).status, 400);
  assert.equal(calls.length, 0);
});

// ── SEC-190 ──────────────────────────────────────────────────────────────────
test('doc-markup: session codes are 8 random letters and short codes are refused', async () => {
  const DB = fakeC3();
  DB.raw.exec('CREATE TABLE sessions (code TEXT PRIMARY KEY, last_edit TEXT NOT NULL)');
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const code = await markup.newCode({ DB });
    assert.match(code, /^[a-z]{8}$/);
    seen.add(code);
  }
  assert.equal(seen.size, 20);
  assert.equal(markup.okCode('abc'), null);
  assert.equal(markup.okCode('ABCDEFGH'), 'abcdefgh');
});
