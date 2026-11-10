// Bundle the shared UI and the API compatibility layer into one Sites Worker.
import { readFile, mkdir, writeFile, copyFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.PACKPILOT_PYTHON || path.join(root, '.venv/bin/python');
const schema = execFileSync(python, ['-c', 'import json; from app import app; print(json.dumps(app.openapi(), ensure_ascii=False))'], {cwd: root, encoding: 'utf8'});
const assets = {};
for (const [route, name, type] of [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/static/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ['/static/app.js', 'app.js', 'text/javascript; charset=utf-8'],
]) {
  assets[route] = {body: await readFile(path.join(root, 'static', name), 'utf8'), type};
}
// V2 uses the exact same browser-local engine in FastAPI and Sites.
// Embed binary references as base64 so template/roller photos survive deployment.
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
async function includeV2(directory, relative = '') {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const name = relative + entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await includeV2(file, name + '/');
    else {
      const type = mimeTypes[path.extname(entry.name).toLowerCase()] || 'application/octet-stream';
      const binary = !/^(text\/|application\/json)/.test(type);
      const bytes = await readFile(file);
      assets['/v2/' + name] = {body: bytes.toString(binary ? 'base64' : 'utf8'), type, binary};
      // /static/v2 is also exposed by the original FastAPI static mount.
      assets['/static/v2/' + name] = assets['/v2/' + name];
    }
  }
}
await includeV2(path.join(root, 'static', 'v2'));
assets['/v2/'] = assets['/v2/index.html'];
assets['/openapi.json'] = {body: schema.trim(), type: 'application/json; charset=utf-8'};
assets['/docs'] = {body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PackPilot API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui'});</script></body></html>`, type: 'text/html; charset=utf-8'};
const api = await readFile(path.join(root, 'worker/api.mjs'), 'utf8');
const specsApi = (await readFile(path.join(root, 'worker/specs-api.mjs'), 'utf8')).replace('export async function handleSpecs', 'async function handleSpecs');
// Evaluate the unchanged UMD engine in its own scope. This is the exact engine
// served to the browser, also used to validate persisted input configurations.
const engine = await readFile(path.join(root, 'static/v2/engine.js'), 'utf8');
const source = `${api}\nconst specEngine = (() => { const module = {exports:{}};\n${engine}\nreturn module.exports; })();\n${specsApi}\nconst ASSETS = ${JSON.stringify(assets)};\nexport default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/v2') return Response.redirect(new URL('/v2/', request.url), 307);
    const asset = ASSETS[pathname];
    if (asset) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', {status:405, headers:{Allow:'GET, HEAD'}});
      const body = asset.binary ? Uint8Array.from(atob(asset.body), c => c.charCodeAt(0)) : asset.body;
      return new Response(request.method === 'HEAD' ? null : body, {headers:{
        'Content-Type':asset.type, 'Cache-Control':'no-cache',
        'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin'
      }});
    }
    const specsResponse = await handleSpecs(request, env, specEngine);
    if (specsResponse) return specsResponse;
    const response = await handleApi(request);
    return response || Response.json({detail:'Not Found'}, {status:404});
  }
};\n`;
await mkdir(path.join(root, 'dist/server'), {recursive: true});
await mkdir(path.join(root, 'dist/.openai'), {recursive: true});
await writeFile(path.join(root, 'dist/server/index.js'), source);
await copyFile(path.join(root, '.openai/hosting.json'), path.join(root, 'dist/.openai/hosting.json'));
// Parse/import the exact generated artifact before it can be packaged.
const built = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
if (typeof built.default?.fetch !== 'function') throw new Error('Worker must export fetch');
for (const route of ['/', '/static/app.js', '/v2/', '/openapi.json', '/health']) {
  const result = await built.default.fetch(new Request('https://packpilot.test' + route));
  if (result.status !== 200) throw new Error('Build check failed: ' + route);
}
const unavailable = await built.default.fetch(new Request('https://packpilot.test/api/specs'));
if (unavailable.status !== 503) throw new Error('Missing D1 must report storage unavailable');
console.log('Built and verified Sites Worker in dist/server/index.js');
