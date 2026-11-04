// Bundle the shared UI and the API compatibility layer into one Sites Worker.
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
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
assets['/openapi.json'] = {body: schema.trim(), type: 'application/json; charset=utf-8'};
assets['/docs'] = {body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PackPilot API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui'});</script></body></html>`, type: 'text/html; charset=utf-8'};
const api = await readFile(path.join(root, 'worker/api.mjs'), 'utf8');
const source = `${api}\nconst ASSETS = ${JSON.stringify(assets)};\nexport default {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const asset = ASSETS[pathname];
    if (asset) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', {status:405, headers:{Allow:'GET, HEAD'}});
      return new Response(request.method === 'HEAD' ? null : asset.body, {headers:{
        'Content-Type':asset.type, 'Cache-Control':'no-cache',
        'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin'
      }});
    }
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
for (const route of ['/', '/static/app.js', '/openapi.json', '/health']) {
  const result = await built.default.fetch(new Request('https://packpilot.test' + route));
  if (result.status !== 200) throw new Error('Build check failed: ' + route);
}
console.log('Built and verified Sites Worker in dist/server/index.js');
