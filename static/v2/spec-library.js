/* Persistent specification records. Quotation arithmetic stays in engine.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PackPilotSpecs = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const storageKey = 'zhenghao-packpilot-v2-spec-library';
  const selectionKey = 'zhenghao-packpilot-v2-selected-spec';
  const schema = 'PackPilot.specs.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const error = (message, status) => Object.assign(new Error(message), status ? {status} : {});
  const conflict = () => error('此规格已在其他页面修改或删除，请重新加载规格库后再操作。', 409);

  function validateConfig(engine, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('规格参数必须为对象。');
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw error('请填写1～100字的规格名称。');
    if (!Array.isArray(value.layers) || value.layers.length < 2 || value.layers.length > 50) throw error('材料层数必须在2～50层。');
    const problems = engine.validate(value);
    if (problems.length) throw error(problems.slice(0, 3).join(' '));
    const result = engine.calculate(value);
    if (!result.ok) throw error(result.errors.slice(0, 3).join(' '));
    let serialized;
    try {
      serialized = JSON.stringify(value, (key, v) => {
        if (typeof v === 'number' && !Number.isFinite(v)) throw error('规格中有无效数字，请检查输入。');
        return v;
      });
    } catch (e) {
      throw error(e.message.includes('无效数字') ? e.message : '规格参数无法保存，请检查数据格式。');
    }
    if (new TextEncoder().encode(serialized).length > 1000000) throw error('单条规格数据不能超过1MB。');
    return JSON.parse(serialized);
  }

  function validateItems(engine, items) {
    if (!Array.isArray(items)) throw error('规格库格式无效。');
    const ids = new Set();
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
          !Number.isSafeInteger(item.revision) || item.revision < 1 ||
          typeof item.name !== 'string' || typeof item.createdAt !== 'string' ||
          typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) ||
          !Number.isFinite(Date.parse(item.updatedAt))) throw error('规格库记录格式无效。');
      validateConfig(engine, item.config);
      if (item.name !== item.config.name.trim()) throw error('规格名称与参数不一致。');
      ids.add(item.id);
    }
    return items;
  }

  function localRepository(engine, storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw error('当前浏览器不允许保存规格，请允许网站存储或下载JSON留档。');
    function rawRead() {
      try { return storage.getItem(storageKey); }
      catch { throw error('无法读取浏览器规格库，请允许网站存储后重试。'); }
    }
    function persist(value) {
      try { storage.setItem(storageKey, JSON.stringify(value)); }
      catch { throw error('规格未保存：浏览器存储不可用或空间不足，请下载JSON留档。'); }
    }
    function read() {
      const raw = rawRead();
      if (raw === null) throw error('浏览器规格库已被清除，请刷新页面重新初始化。');
      try {
        const value = JSON.parse(raw);
        if (value.schema !== schema || !Number.isSafeInteger(value.revision) || value.revision < 1) throw error('格式无效');
        validateItems(engine, value.items);
        return value;
      } catch {
        throw error('浏览器规格库数据损坏或版本不兼容，原数据未覆盖；请先备份后恢复。');
      }
    }
    const raw = rawRead();
    if (raw === null) {
      const now = new Date().toISOString();
      const items = [['historical-pape', engine.presets.paPe()], ['historical-tea', engine.presets.tea()]].map(([id, config]) => ({
        id, name: config.name.trim(), config: validateConfig(engine, config), revision: 1, createdAt: now, updatedAt: now
      }));
      persist({schema, revision: 1, items});
    } else read();

    function updatedEntry(id, config, revision, now, createdAt = now) {
      return {id, name: config.name.trim(), config, revision, createdAt, updatedAt: now};
    }
    return {
      mode: 'local',
      async list() { return clone(read().items); },
      async create(value) {
        const config = validateConfig(engine, value);
        const data = read();
        const id = root.crypto?.randomUUID ? root.crypto.randomUUID() : 'spec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        if (data.items.some(item => item.id === id)) throw error('规格编号生成失败，请重试。');
        const item = updatedEntry(id, config, 1, new Date().toISOString());
        data.items.push(item);
        data.revision += 1;
        persist(data);
        return clone(item);
      },
      async update(id, value, revision) {
        const config = validateConfig(engine, value);
        const data = read();
        const index = data.items.findIndex(item => item.id === id);
        if (index < 0 || data.items[index].revision !== revision) throw conflict();
        const item = updatedEntry(id, config, revision + 1, new Date().toISOString(), data.items[index].createdAt);
        data.items[index] = item;
        data.revision += 1;
        persist(data);
        return clone(item);
      },
      async remove(id, revision) {
        const data = read();
        const index = data.items.findIndex(item => item.id === id);
        if (index < 0 || data.items[index].revision !== revision) throw conflict();
        data.items.splice(index, 1);
        data.revision += 1;
        persist(data);
      }
    };
  }

  async function open(options = {}) {
    const engine = options.engine || root.PackPilot;
    if (!engine?.validate || !engine?.calculate) throw error('报价计算器尚未就绪，请刷新页面。');
    let storage = options.storage;
    const local = () => {
      if (storage === undefined) {
        try { storage = root.localStorage; } catch { /* Report unavailable local persistence below. */ }
      }
      return localRepository(engine, storage);
    };
    if (options.remote === false) return local();
    const fetcher = options.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (!fetcher) throw error('当前环境无法连接规格库服务。');
    async function request(path = '', method = 'GET', body) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
      let response;
      try {
        response = await fetcher('/api/specs' + path, {
          method, credentials: 'same-origin', cache: 'no-store',
          headers: {Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
          ...(body === undefined ? {} : {body: JSON.stringify(body)}),
          ...(controller ? {signal: controller.signal} : {})
        });
      } catch (e) {
        throw error(e.name === 'AbortError' ? '规格库连接超时，操作未确认，请重新加载后检查。' : '无法连接规格库服务，请检查网络后重试。');
      } finally { if (timeout !== null) clearTimeout(timeout); }
      if (response.status === 404) throw error('规格库服务未找到。', 404);
      let data;
      try { data = await response.json(); } catch { throw error('规格库服务返回格式无效，请确认已登录并刷新页面。', response.status); }
      if (!response.ok) {
        if (response.status === 409) throw conflict();
        throw error(typeof data.detail === 'string' ? data.detail : '规格库操作失败，请稍后重试。', response.status);
      }
      return data;
    }
    async function readRemote() {
      const data = await request();
      if (data.storage !== 'database') throw error('规格库未确认数据库保存，请稍后重试。');
      return clone(validateItems(engine, data.items));
    }
    try { await readRemote(); }
    catch (e) { if (e.status === 404) return local(); throw e; }
    async function saveRemote(path, method, value, revision) {
      const config = validateConfig(engine, value);
      const data = await request(path, method, {config, ...(revision === undefined ? {} : {revision})});
      validateItems(engine, [data.item]);
      return clone(data.item);
    }
    return {
      mode: 'database',
      list: readRemote,
      create: config => saveRemote('', 'POST', config),
      update: (id, config, revision) => saveRemote('/' + encodeURIComponent(id), 'PUT', config, revision),
      async remove(id, revision) {
        const data = await request('/' + encodeURIComponent(id), 'DELETE', {revision});
        if (data.ok !== true) throw error('尚未确认删除成功，请重新加载规格库后检查。');
      }
    };
  }
  return {open, storageKey, selectionKey};
});
