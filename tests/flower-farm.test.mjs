// SEC-019: the flower farm's admin routes refuse everyone until STOCK_SECRET
// is set, the admin page escapes what visitors typed, and the waitlist only
// takes an address-shaped email.

import test from 'node:test';
import assert from 'node:assert/strict';
import cell from '../js-flower-farm/cell.js';
import { fakeC3, VAULT_UNSET } from './fake-c3.mjs';

const BASE = 'https://flower-farm.example.tissue.dev';
const go = (env, path, init = {}) => cell.fetch(new Request(BASE + path, init), env);
const bearer = (s) => ({ authorization: `Bearer ${s}` });
// The Cell memoises its table setup per isolate, so every test shares one database.
const DB = fakeC3();

for (const secret of [undefined, '', VAULT_UNSET]) {
  test(`admin routes answer 503 when STOCK_SECRET is ${JSON.stringify(secret)}`, async () => {
    const env = { DB, STOCK_SECRET: secret };
    assert.equal((await go(env, '/admin')).status, 503);
    assert.equal((await go(env, '/admin/waitlist')).status, 503);
    assert.equal((await go(env, '/stock', { method: 'POST', headers: bearer(VAULT_UNSET), body: '{"flower":"dahlias","inStock":true}' })).status, 503);
  });
}

test('a wrong or missing secret gets 401, the right one gets in', async () => {
  const env = { DB, STOCK_SECRET: 's3cret' };
  assert.equal((await go(env, '/admin')).status, 401);
  assert.equal((await go(env, '/admin', { headers: bearer('nope') })).status, 401);
  assert.equal((await go(env, '/admin/waitlist', { headers: bearer('s3cre') })).status, 401);
  assert.equal((await go(env, '/admin', { headers: bearer('s3cret') })).status, 200);
  const basic = { authorization: 'Basic ' + btoa('farmer:s3cret') };
  assert.equal((await go(env, '/admin', { headers: basic })).status, 200);
  const wl = await go(env, '/admin/waitlist', { headers: bearer('s3cret') });
  assert.equal(wl.status, 200);
});

test('the admin page escapes notes and signups', async () => {
  const env = { DB, STOCK_SECRET: 's3cret' };
  await go(env, '/');  // runs setup
  const evil = '<img src=x onerror=alert(1)>';
  const up = await go(env, '/stock', {
    method: 'POST',
    headers: { ...bearer('s3cret'), 'content-type': 'application/json' },
    body: JSON.stringify({ flower: 'dahlias', inStock: false, note: evil }),
  });
  assert.equal(up.status, 200);
  DB.raw.prepare('INSERT INTO waitlist (email, flowers) VALUES (?, ?)').run('"><script>x()</script>@a.co', '<b>lavender</b>');
  const html = await (await go(env, '/admin', { headers: bearer('s3cret') })).text();
  assert.ok(!html.includes(evil));
  assert.ok(!html.includes('<script>x()'));
  assert.ok(!html.includes('<b>lavender</b>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('the waitlist refuses things that are not an email address, and unknown flowers', async () => {
  const env = { DB };
  const post = (body) => go(env, '/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const email of ['@', 'a@', '@b.co', '<x>@b.co', 'a b@c.co', 'x'.repeat(65) + '@b.co']) {
    assert.equal((await post({ email, flowers: ['dahlias'] })).status, 400, email);
  }
  assert.equal((await post({ email: 'a@b.co', flowers: ['<script>'] })).status, 400);
  assert.equal((await post({ email: 'grower@example.com', flowers: ['dahlias', 'bogus'] })).status, 200);
  const row = DB.raw.prepare("SELECT flowers FROM waitlist WHERE email = 'grower@example.com'").get();
  assert.equal(row.flowers, 'dahlias');
});
