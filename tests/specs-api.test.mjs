import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {handleSpecs} from '../worker/specs-api.mjs';

const engineModule = {exports: {}};
new Function('module', readFileSync(new URL('../static/v2/engine.js', import.meta.url), 'utf8'))(engineModule);
const E = engineModule.exports;
const migration = readFileSync(new URL('../drizzle/0000_spec_library.sql', import.meta.url), 'utf8');
const origin = 'https://packpilot.test';

// Execute the same prepared SQL against actual SQLite, retaining D1's result
// shapes and transactional batch semantics. No CRUD operation is mocked.
class LocalD1 {
  constructor(filename = ':memory:', migrate = true) {
    this.sqlite = new DatabaseSync(filename);
    if (migrate) this.sqlite.exec(migration);
  }
  prepare(sql) {
    const stmt = this.sqlite.prepare(sql);
    const bound = values => ({
      bind: (...next) => bound(next),
      first: async () => stmt.get(...values) || null,
      all: async () => ({results: stmt.all(...values), success: true}),
      run: async () => ({success: true, meta: stmt.run(...values)}),
    });
    return bound([]);
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}

function request(route = '/api/specs', method = 'GET', body, headers = {}) {
  return new Request(origin + route, {method,
    headers: method === 'GET' ? headers : {'Content-Type': 'application/json', Origin: origin, ...headers},
    ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}),
  });
}
async function call(db, route, method, body, headers) {
  const response = await handleSpecs(request(route, method, body, headers), {DB: db}, E);
  return {status: response.status, body: await response.json(), headers: response.headers};
}

test('schema migration creates only the two new library tables', () => {
  const db = new LocalD1();
  assert.deepEqual(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name),
    ['packpilot_spec_library_meta', 'packpilot_specs']);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM packpilot_specs').get().n, 0);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  db.close();
});

test('both historical specifications initialize once with exact formulas and full inputs', async () => {
  const db = new LocalD1();
  const response = await call(db);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.body.storage, 'database');
  assert.equal(response.body.items.length, 2);
  const pa = response.body.items.find(item => item.id === 'history-pa-pe');
  const tea = response.body.items.find(item => item.id === 'history-tea');
  assert.deepEqual(pa.config, E.presets.paPe());
  assert.deepEqual(tea.config, E.presets.tea());
  assert.equal(E.calculate(pa.config).totalCost, 4003.019345);
  assert.equal(E.calculate(tea.config).qualifiedQuantity, 159428);
  assert.equal((await call(db)).body.items.length, 2);
  db.close();
});

test('create, update, reopen, load and delete persist on disk with quote linkage', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'packpilot-specs-'));
  const filename = path.join(directory, 'specs.sqlite');
  let db = new LocalD1(filename);
  try {
    await call(db);
    const config = E.presets.tea();
    Object.assign(config, {name: '全参数往返验证', widthMm: 160, heightMm: 210, cutLengthMm: 210,
      lanes: 3, filmWidthMm: 530, lossPct: 4.5, orderQuantity: 75000, rollCount: 6,
      notes: '保留原始备注和将来的可选工艺输入', extraInput: {futurePrintMode: 'template'}});
    config.layers[0] = {...config.layers[0], density: 1.39, pricePerKg: 12.34, actualKg: 58.125};
    config.layers.push({material: 'RCPP', thicknessUm: 60, density: 0.91, pricePerKg: 9.5, actualKg: null});
    config.lamination = {mode: 'detail', process: 'dry-retort', rate: 0.4, passes: 2};
    config.bagging = {rate: 0.023, basis: 'theoretical', standup: true, zipper: true};
    config.packaging = {type: 'pocket', capacity: 8350, certificate: false};
    config.printing = {mode: 'area', rate: 0.12, colors: 3, tierRatePerRoll: null};
    config.weight = {areaM2: 0.0672};
    const created = await call(db, '/api/specs', 'POST', {config});
    assert.equal(created.status, 201);
    const item = created.body.item;
    assert.match(item.id, /^[0-9a-f-]{36}$/);
    assert.equal(item.revision, 1);
    assert.deepEqual(item.config, config);

    config.name = '编辑后的规格';
    config.lossPct = 8;
    config.layers[1].thicknessUm = 16;
    config.printing = {mode: 'tier', rate: null, colors: 4, tierRatePerRoll: 600};
    config.weight = {areaM2: null};
    const updated = await call(db, '/api/specs/' + item.id, 'PUT', {config, revision: item.revision});
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.revision, 2);
    assert.equal(updated.body.item.createdAt, item.createdAt);
    const calculated = E.calculate(config);
    assert.ok(calculated.ok);
    assert.notEqual(calculated.totalCost, E.calculate(item.config).totalCost);
    db.close();
    db = new LocalD1(filename, false);
    const loaded = (await call(db)).body.items.find(row => row.id === item.id);
    assert.deepEqual(loaded.config, config);
    assert.deepEqual(E.calculate(loaded.config), calculated);

    const removed = await call(db, '/api/specs/' + item.id, 'DELETE', {revision: loaded.revision});
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, {ok: true});
    assert.equal((await call(db)).body.items.some(row => row.id === item.id), false);
    db.close();
    db = new LocalD1(filename, false);
    assert.equal((await call(db)).body.items.some(row => row.id === item.id), false);
  } finally { db.close(); rmSync(directory, {recursive: true, force: true}); }
});

test('existing database records without printing or weight fields remain readable and editable', async () => {
  const db = new LocalD1();
  try {
    await call(db);
    const legacy = E.presets.paPe();
    delete legacy.printing;
    delete legacy.weight;
    const serialized = JSON.stringify(legacy);
    db.sqlite.prepare('UPDATE packpilot_specs SET config_json = ? WHERE id = ?')
      .run(serialized, 'history-pa-pe');
    const listed = await call(db);
    assert.equal(listed.status, 200);
    const loaded = listed.body.items.find(item => item.id === 'history-pa-pe');
    assert.deepEqual(loaded.config, legacy);
    assert.equal(E.calculate(loaded.config).ok, true);
    assert.equal(E.calculate(loaded.config).totalCost, E.calculate(E.presets.paPe()).totalCost);
    assert.equal(db.sqlite.prepare('SELECT config_json FROM packpilot_specs WHERE id = ?')
      .get(loaded.id).config_json, serialized);
    legacy.name = '旧规格继续编辑';
    const saved = await call(db, '/api/specs/' + loaded.id, 'PUT', {config: legacy, revision: loaded.revision});
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.item.config, legacy);
  } finally { db.close(); }
});

test('deleted historical records including an empty library never reseed', async () => {
  const db = new LocalD1();
  const {items} = (await call(db)).body;
  for (const item of items) assert.equal((await call(db, '/api/specs/' + item.id, 'DELETE', {revision: 1})).status, 200);
  assert.deepEqual((await call(db)).body.items, []);
  assert.deepEqual((await call(db)).body.items, []);
  db.close();
});

test('optimistic concurrency prevents overwriting or deleting another edit', async () => {
  const db = new LocalD1();
  const old = (await call(db)).body.items[0];
  const next = {...old.config, name: '另一页面的新版本'};
  assert.equal((await call(db, '/api/specs/' + old.id, 'PUT', {config: next, revision: 1})).status, 200);
  assert.equal((await call(db, '/api/specs/' + old.id, 'PUT', {config: old.config, revision: 1})).status, 409);
  assert.equal((await call(db, '/api/specs/' + old.id, 'DELETE', {revision: 1})).status, 409);
  assert.deepEqual((await call(db)).body.items.find(row => row.id === old.id).config, next);
  assert.equal((await call(db, '/api/specs/missing', 'DELETE', {revision: 1})).status, 404);
  db.close();
});

test('invalid or unquotable input never reaches storage', async () => {
  const db = new LocalD1();
  await call(db);
  for (const change of [
    c => { c.name = ' '; },
    c => { c.name = 'x'.repeat(101); },
    c => { c.layers = Array.from({length: 51}, () => c.layers[0]); },
    c => { c.layers[1].density = -1; },
    c => { c.printing = {mode: 'area', rate: -0.1, colors: 2, tierRatePerRoll: null}; },
    c => { c.weight = {areaM2: -0.2}; },
    c => { c.bagging.zipper = 'true'; },
    c => { c.cutLengthMm = 1e30; },
    c => { c.layers[0].pricePerKg = 1e308; },
  ]) {
    const config = E.defaultConfig(); change(config);
    assert.equal((await call(db, '/api/specs', 'POST', {config})).status, 422);
  }
  assert.equal((await call(db, '/api/specs/history-pa-pe', 'PUT', {config: E.defaultConfig()})).status, 422);
  const inactive = E.defaultConfig();
  inactive.lamination.mode = 'detail';
  inactive.lamination.rate = 0.123;
  const nonfiniteJson = JSON.stringify({config: inactive}).replace('"rate":0.123', '"rate":1e999');
  assert.equal((await call(db, '/api/specs', 'POST', nonfiniteJson)).status, 422);
  assert.equal((await call(db)).body.items.length, 2);
  db.close();
});

test('same-origin JSON mutations only; bounded data and safe route handling', async () => {
  const db = new LocalD1();
  const body = {config: E.defaultConfig()};
  assert.equal((await call(db, '/api/specs', 'POST', body, {Origin: 'https://elsewhere.test'})).status, 403);
  assert.equal((await call(db, '/api/specs', 'POST', body, {Origin: ''})).status, 403);
  assert.equal((await call(db, '/api/specs', 'POST', body, {'Content-Type': 'text/plain'})).status, 415);
  assert.equal((await call(db, '/api/specs', 'POST', '{oops')).status, 400);
  assert.equal((await call(db, '/api/specs', 'POST', '[]')).status, 400);
  assert.equal((await call(db, '/api/specs', 'POST', ' '.repeat(256001))).status, 413);
  assert.equal((await call(db, '/api/specs', 'PATCH', body)).status, 405);
  assert.equal((await call(db, '/api/specs/history-pa-pe/more', 'GET')).status, 404);
  assert.equal(await handleSpecs(request('/health'), {DB: db}, E), null);
  db.close();
});

test('missing database, failed schema and failed writes report failure without memory saves', async () => {
  assert.equal((await handleSpecs(request(), {}, E)).status, 503);
  const db = new LocalD1(':memory:', false);
  assert.equal((await call(db)).status, 503);
  assert.equal((await call(db, '/api/specs', 'POST', {config: E.defaultConfig()})).status, 503);
  db.sqlite.exec(migration);
  const listed = await call(db);
  assert.equal(listed.body.items.length, 2);
  assert.equal(listed.body.items.some(item => item.id !== 'history-pa-pe' && item.id !== 'history-tea'), false);
  db.close();
});
