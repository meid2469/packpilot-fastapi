const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function umd(file) {
  const module = {exports: {}};
  new Function('module', fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))(module);
  return module.exports;
}
const E = umd('static/v2/engine.js');
const S = umd('static/v2/spec-library.js');
const clone = value => JSON.parse(JSON.stringify(value));

class MemoryStorage {
  constructor() { this.values = new Map(); this.failWrites = false; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error('QuotaExceededError: simulated storage failure');
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}
const open = storage => S.open({engine: E, storage, remote: false});

function completeConfig() {
  const c = E.presets.tea();
  Object.assign(c, {name: '测试规格 <三层> / 编辑与恢复', widthMm: 152, heightMm: 118, cutLengthMm: 118,
    filmWidthMm: 530, lanes: 3, lossPct: 6.25, orderQuantity: 120000, rollCount: 6,
    notes: '完整保存中文备注与特殊符号：& < > "'});
  c.layers[0] = {material: 'CUSTOM', thicknessUm: 14.5, density: 1.375, pricePerKg: 10.85, actualKg: 65.125};
  c.layers[1].actualKg = null;
  c.layers[2].density = 0.928;
  c.layers[2].pricePerKg = 12.65;
  c.lamination = {mode: 'detail', process: 'dry-boil', rate: 0, passes: 3};
  c.bagging = {rate: 0, basis: 'billable', standup: true, zipper: true};
  c.packaging = {type: 'pocket', capacity: 9700, certificate: false};
  c.printing = {mode: 'area', rate: 0.14, colors: 4, tierRatePerRoll: null};
  c.weight = {areaM2: 0.03952};
  assert.equal(E.calculate(c).ok, true);
  return c;
}

test('本地规格库首次保存两条原历史规格，之后只读取已有库', async () => {
  const storage = new MemoryStorage();
  const library = await open(storage);
  assert.equal(library.mode, 'local');
  const initial = await library.list();
  assert.equal(initial.length, 2);
  assert.deepEqual(initial.map(item => item.config), [E.presets.paPe(), E.presets.tea()]);
  assert.ok(storage.getItem(S.storageKey));
  const persisted = storage.getItem(S.storageKey);
  assert.deepEqual(await (await open(storage)).list(), initial);
  assert.equal(storage.getItem(S.storageKey), persisted);
});

test('新增保存全部输入参数，重新打开后配置与核价结果逐项相同', async () => {
  const storage = new MemoryStorage();
  const library = await open(storage);
  const config = completeConfig();
  const expected = E.calculate(config);
  const created = await library.create(config);
  assert.ok(created.id);
  assert.equal(created.revision, 1);
  assert.deepEqual(created.config, config);
  const reopened = await open(storage);
  const loaded = (await reopened.list()).find(item => item.id === created.id);
  assert.deepEqual(loaded.config, config);
  assert.deepEqual(E.calculate(loaded.config), expected);
  assert.equal((await reopened.list()).length, 3);
});

test('编辑保存更新同一条记录，保留空值自动参数和零费率', async () => {
  const storage = new MemoryStorage();
  const library = await open(storage);
  const item = (await library.list())[0];
  const config = clone(item.config);
  config.name = '修改后的PA/PE';
  config.widthMm = 125;
  config.filmWidthMm = 500;
  config.lossPct = 4.5;
  config.orderQuantity = null;
  config.lamination = {mode: 'area', process: 'dry-normal', rate: 0, passes: null};
  config.layers[0].actualKg = 55;
  config.layers[1].actualKg = null;
  config.bagging.rate = 0;
  config.printing = {mode: 'tier', rate: null, colors: 2, tierRatePerRoll: 0};
  config.weight = {areaM2: null};
  const updated = await library.update(item.id, config, item.revision);
  assert.equal(updated.id, item.id);
  assert.equal(updated.revision, item.revision + 1);
  const stored = (await (await open(storage)).list()).find(row => row.id === item.id);
  assert.deepEqual(stored.config, config);
  assert.deepEqual(E.calculate(stored.config), E.calculate(config));
  assert.equal((await library.list()).length, 2);
});

test('升级前没有印刷和克重配置的已有规格仍可加载，读取不会改写原始记录', async () => {
  const storage = new MemoryStorage();
  const config = E.presets.paPe();
  delete config.printing;
  delete config.weight;
  const now = '2026-11-06T13:00:00.000Z';
  const item = {id: 'legacy-pa-pe', name: config.name, config, revision: 3,
    createdAt: now, updatedAt: now};
  const persisted = JSON.stringify({schema: 'PackPilot.specs.v1', revision: 4, items: [item]});
  storage.setItem(S.storageKey, persisted);
  const library = await open(storage);
  assert.deepEqual(await library.list(), [item]);
  const loaded = (await (await open(storage)).list())[0];
  const quote = E.calculate(loaded.config);
  assert.equal(quote.ok, true);
  assert.equal(quote.totalCost, E.calculate(E.presets.paPe()).totalCost);
  assert.equal(storage.getItem(S.storageKey), persisted);
});

test('复制为新规格得到独立ID，编辑副本与返回对象不会悄悄改变原规格', async () => {
  const storage = new MemoryStorage();
  const library = await open(storage);
  const original = (await library.list())[0];
  const copied = await library.create({...clone(original.config), name: '原规格副本'});
  assert.notEqual(copied.id, original.id);
  copied.config.layers[0].density = 9;
  copied.config.name = '未保存修改';
  original.config.layers[0].pricePerKg = 999;
  const saved = await library.list();
  assert.equal(saved.find(row => row.id === copied.id).config.name, '原规格副本');
  assert.equal(saved.find(row => row.id === copied.id).config.layers[0].density, 1.15);
  assert.equal(saved.find(row => row.id === original.id).config.layers[0].pricePerKg, 17.2);
});

test('删除后刷新保留删除结果；全部删除得到空库，不会自动复活历史规格', async () => {
  const storage = new MemoryStorage();
  const library = await open(storage);
  for (const item of await library.list()) await library.remove(item.id, item.revision);
  assert.deepEqual(await library.list(), []);
  assert.deepEqual(await (await open(storage)).list(), []);
  assert.deepEqual(JSON.parse(storage.getItem(S.storageKey)).items, []);
});

test('浏览器拒绝写入时新增、修改、删除都不提交内存或伪报保存成功', async () => {
  const storage = new MemoryStorage();
  const library = await open(storage);
  const before = await library.list();
  const raw = storage.getItem(S.storageKey);
  storage.failWrites = true;
  await assert.rejects(library.create(completeConfig()));
  await assert.rejects(library.update(before[0].id, completeConfig(), before[0].revision));
  await assert.rejects(library.remove(before[0].id, before[0].revision));
  assert.deepEqual(await library.list(), before);
  assert.equal(storage.getItem(S.storageKey), raw);
});

test('首次初始化无法持久化时明确失败', async () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  await assert.rejects(open(storage));
  assert.equal(storage.getItem(S.storageKey), null);
});

test('另一个页面更新记录后，旧版本编辑及删除被拒绝，保护较新数据', async () => {
  const storage = new MemoryStorage();
  const first = await open(storage);
  const second = await open(storage);
  const old = (await second.list())[0];
  const updated = await first.update(old.id, {...clone(old.config), name: '另一个页面的新修改'}, old.revision);
  await assert.rejects(second.update(old.id, {...clone(old.config), name: '旧页面修改'}, old.revision));
  await assert.rejects(second.remove(old.id, old.revision));
  const latest = (await (await open(storage)).list()).find(item => item.id === old.id);
  assert.deepEqual(latest, updated);
});

test('独立页面先后新增规格不会覆盖另一页面新增的记录', async () => {
  const storage = new MemoryStorage();
  const first = await open(storage);
  const second = await open(storage);
  const a = await first.create({...E.presets.paPe(), name: '页面一新增'});
  const b = await second.create({...E.presets.tea(), name: '页面二新增'});
  const rows = await (await open(storage)).list();
  assert.equal(rows.length, 4);
  assert.ok(rows.some(item => item.id === a.id));
  assert.ok(rows.some(item => item.id === b.id));
});

test('已损坏的本地库报错并保留原始内容，避免被默认规格覆盖', async () => {
  const storage = new MemoryStorage();
  const bad = '{"schema":"PackPilot.specs.v1","items":';
  storage.setItem(S.storageKey, bad);
  await assert.rejects(open(storage));
  assert.equal(storage.getItem(S.storageKey), bad);
});

test('无效规格不能写入或覆盖原记录', async () => {
  const storage = new MemoryStorage();
  const library = await open(storage);
  const before = await library.list();
  const invalid = E.presets.paPe();
  invalid.cutLengthMm = 0;
  await assert.rejects(library.create(invalid));
  await assert.rejects(library.update(before[0].id, invalid, before[0].revision));
  assert.deepEqual(await library.list(), before);
});

function remoteItem(config, id = 'remote-spec', revision = 1) {
  return {id, name: config.name.trim(), config: clone(config), revision,
    createdAt: '2026-11-06T13:00:00.000Z', updatedAt: '2026-11-06T13:00:00.000Z'};
}
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type': 'application/json'},
});

test('仅不存在规格接口的旧本地服务回退浏览器库', async () => {
  const storage = new MemoryStorage();
  const library = await S.open({engine: E, storage, fetch: async () => jsonResponse({detail: 'Not Found'}, 404)});
  assert.equal(library.mode, 'local');
  assert.equal((await library.list()).length, 2);
});

test('断网、未登录和数据库故障均明确报错，不悄悄创建本地替代库', async () => {
  for (const fetcher of [
    async () => { throw new TypeError('network unavailable'); },
    async () => jsonResponse({detail: '登录失效'}, 401),
    async () => jsonResponse({detail: '数据库暂不可用'}, 503),
    async () => new Response('<html>Login</html>'),
    async () => jsonResponse({items: [], storage: 'memory'}),
  ]) {
    const storage = new MemoryStorage();
    await assert.rejects(S.open({engine: E, storage, fetch: fetcher}));
    assert.equal(storage.getItem(S.storageKey), null);
  }
});

test('数据库规格库完整读写与删除按接口契约执行，不依赖浏览器存储', async () => {
  let current = remoteItem(E.presets.paPe());
  const calls = [];
  const fetcher = async (url, options) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({url, method: options.method, body});
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    if (options.method === 'GET') return jsonResponse({items: current ? [current] : [], storage: 'database'});
    if (options.method === 'POST') {
      current = remoteItem(body.config, 'created');
      return jsonResponse({item: current}, 201);
    }
    assert.equal(url, '/api/specs/created');
    assert.equal(body.revision, current.revision);
    if (options.method === 'PUT') {
      current = remoteItem(body.config, 'created', current.revision + 1);
      return jsonResponse({item: current});
    }
    assert.equal(options.method, 'DELETE');
    current = null;
    return jsonResponse({ok: true});
  };
  const deniedStorage = {getItem() {throw Error('not available');}, setItem() {throw Error('not available');}};
  const library = await S.open({engine: E, storage: deniedStorage, fetch: fetcher});
  assert.equal(library.mode, 'database');
  const config = completeConfig();
  const created = await library.create(config);
  assert.deepEqual(created.config, config);
  config.name = '数据库中的更新规格';
  const updated = await library.update(created.id, config, created.revision);
  assert.equal(updated.revision, 2);
  const loaded = (await library.list())[0];
  assert.deepEqual(loaded.config, config);
  assert.deepEqual(E.calculate(loaded.config), E.calculate(config));
  await library.remove(loaded.id, loaded.revision);
  assert.deepEqual(await library.list(), []);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'PUT', 'GET', 'DELETE', 'GET']);
});

test('数据库旧版本冲突与未确认删除均拒绝成功提示', async () => {
  const item = remoteItem(E.presets.paPe());
  const fetcher = async (url, options) => {
    if (options.method === 'GET') return jsonResponse({items: [item], storage: 'database'});
    if (options.method === 'PUT') return jsonResponse({detail: 'stale revision'}, 409);
    return jsonResponse({ok: false});
  };
  const library = await S.open({engine: E, fetch: fetcher});
  await assert.rejects(library.update(item.id, item.config, item.revision), error => error.status === 409);
  await assert.rejects(library.remove(item.id, item.revision));
});
