// Persistent library for the existing private PackPilot Site. Quotation math stays
// in the unchanged shared engine; the database stores inputs, never cached prices.
const SPEC_BODY_LIMIT = 256000;
const SPEC_COLUMNS = 'id, name, config_json, revision, created_at, updated_at';

function specJson(body, status = 200, headers = {}) {
  return Response.json(body, {status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  }});
}

class SpecRequestError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}

async function specBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new SpecRequestError(415, '请使用 JSON 提交规格。');
  }
  if (Number(request.headers.get('Content-Length')) > SPEC_BODY_LIMIT) {
    throw new SpecRequestError(413, '规格数据过大，请控制在 256KB 以内。');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SpecRequestError(400, '缺少规格数据。');
  let length = 0;
  const chunks = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > SPEC_BODY_LIMIT) {
      await reader.cancel();
      throw new SpecRequestError(413, '规格数据过大，请控制在 256KB 以内。');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new SpecRequestError(400, '规格 JSON 格式无效。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SpecRequestError(400, '规格数据必须为对象。');
  }
  return body;
}

function specConfig(value, engine) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpecRequestError(422, '缺少完整的规格输入参数。');
  }
  // JSON exponent values such as 1e999 parse as Infinity. Even an inactive or
  // future input must not silently turn into null when written and reopened.
  try {
    JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('non-finite');
      return entry;
    });
  } catch { throw new SpecRequestError(422, '规格包含无效数字或过深的数据结构。'); }
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) {
    throw new SpecRequestError(422, '请填写 1～100 字的规格名称。');
  }
  if (!Array.isArray(value.layers) || value.layers.length < 2 || value.layers.length > 50) {
    throw new SpecRequestError(422, '材料层数必须在 2～50 层。');
  }
  if (typeof value.bagging?.standup !== 'boolean' || typeof value.bagging?.zipper !== 'boolean') {
    throw new SpecRequestError(422, '制袋附加选项必须为布尔值。');
  }
  let errors, result;
  try {
    errors = engine.validate(value);
    if (!errors.length) result = engine.calculate(value);
  } catch { throw new SpecRequestError(422, '规格输入参数无效，请核对后保存。'); }
  if (errors.length) throw new SpecRequestError(422, errors.slice(0, 3).join(' '));
  if (!result.ok) throw new SpecRequestError(422, result.errors.slice(0, 3).join(' '));
  // Keep the full input object, including notes and future optional input fields.
  // The title is normalized once so list labels and the restored form agree.
  return {...value, name: value.name.trim()};
}

function specItem(row) {
  return {
    id: row.id, name: row.name, config: JSON.parse(row.config_json),
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function seedSpecLibrary(db, engine) {
  // D1 batch is transactional. The marker survives deletion of every record, so
  // neither a refresh nor a later deployment brings a deleted example back.
  const now = new Date().toISOString();
  const seeds = [['history-pa-pe', engine.presets.paPe()], ['history-tea', engine.presets.tea()]];
  await db.batch([
    ...seeds.map(([id, config]) => db.prepare(
      `INSERT OR IGNORE INTO packpilot_specs (id, name, config_json, revision, created_at, updated_at)
       SELECT ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM packpilot_spec_library_meta WHERE key = 'initial-seeds-v1')`
    ).bind(id, config.name, JSON.stringify(config), now, now)),
    db.prepare("INSERT OR IGNORE INTO packpilot_spec_library_meta (key, value) VALUES ('initial-seeds-v1', '1')"),
  ]);
}

export async function handleSpecs(request, env, engine) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/specs' && !url.pathname.startsWith('/api/specs/')) return null;
  const match = /^\/api\/specs(?:\/([a-zA-Z0-9-]{1,64}))?\/?$/.exec(url.pathname);
  if (!match) return specJson({detail: '规格不存在。'}, 404);
  const id = match[1];
  const methods = id ? ['PUT', 'DELETE'] : ['GET', 'POST'];
  if (!methods.includes(request.method)) {
    return specJson({detail: '不支持此操作。'}, 405, {Allow: methods.join(', ')});
  }
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
    return specJson({detail: '请从当前网站页面操作规格库。'}, 403);
  }
  if (!env?.DB?.prepare || !env.DB.batch) {
    return specJson({detail: '规格数据库暂不可用，未保存任何更改。请稍后重试。'}, 503);
  }
  const db = env.DB;
  try {
    if (request.method === 'GET') {
      await seedSpecLibrary(db, engine);
      const rows = await db.prepare(`SELECT ${SPEC_COLUMNS} FROM packpilot_specs ORDER BY created_at, id`).all();
      return specJson({items: rows.results.map(specItem), storage: 'database'});
    }
    const body = await specBody(request);
    if (request.method === 'POST') {
      const config = specConfig(body.config, engine);
      const newId = crypto.randomUUID(), now = new Date().toISOString();
      const row = await db.prepare(
        `INSERT INTO packpilot_specs (id, name, config_json, revision, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?) RETURNING ${SPEC_COLUMNS}`
      ).bind(newId, config.name, JSON.stringify(config), now, now).first();
      return specJson({item: specItem(row)}, 201);
    }
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) {
      throw new SpecRequestError(422, '缺少有效的规格版本，请重新加载后操作。');
    }
    let row;
    if (request.method === 'PUT') {
      const config = specConfig(body.config, engine);
      row = await db.prepare(
        `UPDATE packpilot_specs SET name = ?, config_json = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? RETURNING ${SPEC_COLUMNS}`
      ).bind(config.name, JSON.stringify(config), new Date().toISOString(), id, body.revision).first();
      if (row) return specJson({item: specItem(row)});
    } else {
      row = await db.prepare('DELETE FROM packpilot_specs WHERE id = ? AND revision = ? RETURNING id')
        .bind(id, body.revision).first();
      if (row) return specJson({ok: true});
    }
    const existing = await db.prepare('SELECT id FROM packpilot_specs WHERE id = ?').bind(id).first();
    return existing
      ? specJson({detail: '此规格已在另一页面修改，请重新加载后再操作；当前编辑尚未保存。'}, 409)
      : specJson({detail: '此规格已被删除，请刷新规格库。'}, 404);
  } catch (error) {
    if (error instanceof SpecRequestError) return specJson({detail: error.message}, error.status);
    // Missing bindings, unapplied migrations and storage failures must never look
    // like successful in-memory saves or silently switch the library location.
    return specJson({detail: '规格数据库暂不可用，未确认保存。请保留当前输入并稍后重试。'}, 503);
  }
}
