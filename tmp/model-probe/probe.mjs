const BASE = 'https://claudeapikey.dev';
const KEY = 'sk-e2f362e443f4fe518cab50226734ce7e1aa0b251c4c5ca8f5a2fe2e0cead014a';

async function j(url, opts) {
  try {
    const r = await fetch(url, opts);
    const t = await r.text();
    return { status: r.status, head: Object.fromEntries(r.headers), body: t.slice(0, 1200) };
  } catch (e) { return { error: String(e) }; }
}

// 1) 模型列表
const models = await j(BASE + '/v1/models', { headers: { 'x-api-key': KEY, 'authorization': 'Bearer ' + KEY, 'anthropic-version': '2023-06-01' } });
console.log('== GET /v1/models ==', models.status || models.error);
console.log(models.body || '');
console.log();

// 2) anthropic messages 协议
const msg = await j(BASE + '/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 16, messages: [{ role: 'user', content: 'say ok' }] }),
});
console.log('== POST /v1/messages (sonnet-4-5) ==', msg.status || msg.error);
console.log(msg.body || '');
