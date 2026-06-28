import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseZone,
  approxLocation,
  buildResponse,
  GROWING_INFO,
  ZIP_LOCATIONS,
} from './logic.js';

// ── parseZone ─────────────────────────────────────────────────────────────────

test('parseZone: standard sub-zone lowercase', () => {
  const r = parseZone('8b');
  assert.equal(r.number, 8);
  assert.equal(r.sub, 'b');
  assert.equal(r.full, '8b');
});

test('parseZone: sub-zone a', () => {
  const r = parseZone('6a');
  assert.equal(r.number, 6);
  assert.equal(r.sub, 'a');
  assert.equal(r.full, '6a');
});

test('parseZone: two-digit zone number', () => {
  const r = parseZone('10b');
  assert.equal(r.number, 10);
  assert.equal(r.sub, 'b');
  assert.equal(r.full, '10b');
});

test('parseZone: zone without sub-zone letter', () => {
  const r = parseZone('7');
  assert.equal(r.number, 7);
  assert.equal(r.sub, null);
  assert.equal(r.full, '7');
});

test('parseZone: uppercase sub-zone letter is normalised', () => {
  const r = parseZone('9B');
  assert.equal(r.sub, 'b');
});

test('parseZone: invalid input returns number 0', () => {
  const r = parseZone('Zone 8b');
  assert.equal(r.number, 0);
  assert.equal(r.sub, null);
});

// ── approxLocation ────────────────────────────────────────────────────────────

test('approxLocation: Seattle range → WA', () => {
  const r = approxLocation('98101');
  assert.equal(r.state, 'WA');
  assert.equal(r.approximate, true);
});

test('approxLocation: Miami range → FL', () => {
  assert.equal(approxLocation('33101').state, 'FL');
});

test('approxLocation: Anchorage range → AK', () => {
  assert.equal(approxLocation('99501').state, 'AK');
});

test('approxLocation: Honolulu range → HI', () => {
  assert.equal(approxLocation('96801').state, 'HI');
});

test('approxLocation: unknown zip → US fallback', () => {
  assert.equal(approxLocation('00001').state, 'US');
});

// ── GROWING_INFO completeness ─────────────────────────────────────────────────

test('GROWING_INFO covers zones 1–13', () => {
  for (let z = 1; z <= 13; z++) {
    assert.ok(GROWING_INFO[z], `zone ${z} missing from GROWING_INFO`);
    assert.ok(GROWING_INFO[z].season, `zone ${z} missing season`);
  }
});

test('GROWING_INFO frost-free zones have null frost dates', () => {
  for (const z of [11, 12, 13]) {
    assert.equal(GROWING_INFO[z].lastFrost,  null, `zone ${z} lastFrost should be null`);
    assert.equal(GROWING_INFO[z].firstFrost, null, `zone ${z} firstFrost should be null`);
  }
});

test('GROWING_INFO temperate zones have frost dates', () => {
  for (const z of [5, 6, 7, 8]) {
    assert.ok(GROWING_INFO[z].lastFrost,  `zone ${z} missing lastFrost`);
    assert.ok(GROWING_INFO[z].firstFrost, `zone ${z} missing firstFrost`);
  }
});

// ── buildResponse ─────────────────────────────────────────────────────────────

// Minimal stubs that replace the data.js functions
const stateInfo  = code => ({ WA: 'Washington', FL: 'Florida', AK: 'Alaska' }[code] ?? null);
const extService = code => `https://extension.example.com/${code.toLowerCase()}`;

test('buildResponse: growing field has season/frost — NOT temperature data', () => {
  const zoneData   = { zone: '8b', trange: '15 to 20' };
  const zoneDetails = { tempF: '15 to 20', tempC: '-9.4 to -6.7' };

  const r = buildResponse('98101', zoneData, zoneDetails, stateInfo, extService);

  // growing must contain season/frost info
  assert.ok(r.growing, 'growing field should not be null for zone 8');
  assert.equal(typeof r.growing.season, 'string', 'growing.season should be a string');
  assert.ok(r.growing.lastFrost,  'growing.lastFrost should be populated for zone 8');
  assert.ok(r.growing.firstFrost, 'growing.firstFrost should be populated for zone 8');

  // growing must NOT contain temperature keys
  assert.equal(r.growing.tempF, undefined, 'growing must not contain tempF');
  assert.equal(r.growing.tempC, undefined, 'growing must not contain tempC');
});

test('buildResponse: temperature field uses zoneDetails tempF/tempC', () => {
  const zoneData    = { zone: '8b', trange: '15 to 20' };
  const zoneDetails = { tempF: '15 to 20', tempC: '-9.4 to -6.7' };

  const r = buildResponse('98101', zoneData, zoneDetails, stateInfo, extService);

  assert.equal(r.temperature.rangeF, '15 to 20');
  assert.equal(r.temperature.rangeC, '-9.4 to -6.7');
});

test('buildResponse: temperature falls back to CSV trange when zoneDetails is null', () => {
  const zoneData = { zone: '8b', trange: '15 to 20 (fallback)' };

  const r = buildResponse('98101', zoneData, null, stateInfo, extService);

  assert.equal(r.temperature.rangeF, '15 to 20 (fallback)');
  assert.equal(r.temperature.rangeC, null);
});

test('buildResponse: known zip code populates city', () => {
  const zoneData = { zone: '8b', trange: '15 to 20' };
  const r = buildResponse('98101', zoneData, null, stateInfo, extService);

  assert.equal(r.location.city, 'Seattle');
  assert.equal(r.location.state, 'WA');
  assert.equal(r.location.stateFull, 'Washington');
  assert.equal(r.location.approximate, false);
});

test('buildResponse: unknown zip uses approxLocation and sets approximate=true', () => {
  const zoneData = { zone: '6a', trange: '-10 to -5' };
  const r = buildResponse('98200', zoneData, null, stateInfo, extService);

  assert.equal(r.location.approximate, true);
  assert.equal(r.location.city, null);
});

test('buildResponse: zone object is correctly structured', () => {
  const zoneData = { zone: '8b', trange: '15 to 20' };
  const r = buildResponse('98101', zoneData, null, stateInfo, extService);

  assert.equal(r.zone.full,    '8b');
  assert.equal(r.zone.number,  8);
  assert.equal(r.zone.subZone, 'b');
  assert.equal(r.zone.name,    'Zone 8b');
  assert.equal(r.zipCode,      '98101');
});

test('buildResponse: frost-free zone has null frost dates in growing', () => {
  const zoneData = { zone: '11a', trange: '40 to 45' };
  const r = buildResponse('96801', zoneData, null, stateInfo, extService);

  assert.ok(r.growing, 'growing should not be null for zone 11');
  assert.equal(r.growing.lastFrost,  null);
  assert.equal(r.growing.firstFrost, null);
  assert.match(r.growing.season, /frost-free/);
});

test('buildResponse: invalid zone string produces number 0 and null growing', () => {
  const zoneData = { zone: 'invalid', trange: 'unknown' };
  const r = buildResponse('10001', zoneData, null, stateInfo, extService);

  assert.equal(r.zone.number, 0);
  assert.equal(r.growing, null);
});
