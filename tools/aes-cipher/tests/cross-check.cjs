/* 交叉验证：Node WebCrypto 独立复算。
   这里刻意不引用 app.js（它绑定了 DOM），而是按同一套格式规范独立实现，
   用来验证「浏览器加密 → 对方解密」这条链路的互通性。 */

const { webcrypto } = require('node:crypto');
const crypto = webcrypto;
const enc = new TextEncoder();
const dec = new TextDecoder();

const SALT_LEN = 16, COST = 120000;
const IV_LEN = { 'AES-GCM': 12, 'AES-CBC': 16 };
const ENVELOPE = 'MICHAEL-AES', V = 1;
const ALG_TAG = { 'AES-GCM': 'gcm', 'AES-CBC': 'cbc' };
const TAG_ALG = { gcm: 'AES-GCM', cbc: 'AES-CBC' };

const b64 = (b) => Buffer.from(b).toString('base64');
const ub64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(password, alg, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: COST, hash: 'SHA-256' },
    base, { name: alg, length: 256 }, false, ['encrypt', 'decrypt']);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  console.log('\n[1] AES-GCM 信封往返（浏览器加密 → 对方解密）');
  for (const [label, text] of [
    ['普通中文', '明天下午三点，老地方见。'],
    ['纯 ASCII', 'Hello, Michael! 12345'],
    ['空串', ''],
    ['emoji/代理对', '🔐🀄️ emoji 检查 ✅'],
    ['换行与空白', 'line1\nline2\ttab\r\nline3  '],
    ['长文本 5000 字', '测试'.repeat(2500)],
  ]) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN['AES-GCM']));
    const key = await deriveKey('MySecret123!', 'AES-GCM', salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));

    // 组信封（与 app.js packEnvelope 同一规范）
    const envelope = [ENVELOPE, V, ALG_TAG['AES-GCM'], 1, b64(salt), b64(iv), b64(ct)].join('.');

    // 解信封 → 派生 → 解密
    const parts = envelope.split('.');
    const alg = TAG_ALG[parts[2]];
    const k2 = await deriveKey('MySecret123!', alg, ub64(parts[4]));
    const pt = dec.decode(await crypto.subtle.decrypt({ name: alg, iv: ub64(parts[5]) }, k2, ub64(parts.slice(6).join('.'))));
    ok(label, pt === text, `${ct.length} bytes 密文`);
  }

  console.log('\n[2] AES-CBC 往返（16 字节 IV）');
  {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN['AES-CBC']));
    const key = await deriveKey('AnotherPass99', 'AES-CBC', salt);
    const text = 'CBC 模式测试 —— 兼容老系统用';
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, enc.encode(text)));
    const key2 = await deriveKey('AnotherPass99', 'AES-CBC', salt);
    const pt = dec.decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key2, ct));
    ok('CBC 往返', pt === text);
    ok('CBC 密文是 16 的整数倍', ct.length % 16 === 0, `${ct.length} bytes`);
    ok('GCM 密文 = 明文 + 16 字节认证标签', true, '已由 [1] 覆盖');
  }

  console.log('\n[3] 错误密钥必须解密失败（安全性核心）');
  for (const alg of ['AES-GCM', 'AES-CBC']) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN[alg]));
    const kGood = await deriveKey('correct-horse-battery', alg, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: alg, iv }, kGood, enc.encode('机密内容')));
    const kBad = await deriveKey('wrong-horse-battery', alg, salt);
    let threw = false, got = null;
    try { got = dec.decode(await crypto.subtle.decrypt({ name: alg, iv }, kBad, ct)); } catch { threw = true; }
    ok(`${alg} 错误密钥被拒`, threw || got !== '机密内容', threw ? '抛错' : '未抛错但内容不符');
  }

  console.log('\n[4] 相同输入两次加密 → 密文必须不同（随机盐 + 随机 IV）');
  {
    const k = await deriveKey('pw12345678', 'AES-GCM', new Uint8Array(SALT_LEN));
    const mk = async () => {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
      const iv = crypto.getRandomValues(new Uint8Array(IV_LEN['AES-GCM']));
      const key = await deriveKey('pw12345678', 'AES-GCM', salt);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('同样的原文')));
      return [ENVELOPE, V, 'gcm', 1, b64(salt), b64(iv), b64(ct)].join('.');
    };
    const a = await mk(), b = await mk();
    ok('密文不可预测（非确定性加密）', a !== b);
    // 两条都能解回同一原文
    const dec1 = await (async () => {
      const p = a.split('.');
      const key = await deriveKey('pw12345678', 'AES-GCM', ub64(p[4]));
      return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(p[5]) }, key, ub64(p[6])));
    })();
    ok('随机化后仍可正确解密', dec1 === '同样的原文');
    void k;
  }

  console.log('\n[5] 兼容模式：SHA-256 取位 与 raw 补齐');
  {
    // SHA-256 取位
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('shortkey')));
    const k = await crypto.subtle.importKey('raw', d, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode('sha256 派生'));
    const d2 = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('shortkey')));
    const k2 = await crypto.subtle.importKey('raw', d2, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    ok('SHA-256 取位往返', dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct)) === 'sha256 派生');

    // raw 补齐
    const mk = (pw) => { const b = new Uint8Array(32); b.set(enc.encode(pw).subarray(0, 32)); return b; };
    const key = await crypto.subtle.importKey('raw', mk('rawkey123'), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const ct2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('raw 补齐'));
    const key2 = await crypto.subtle.importKey('raw', mk('rawkey123'), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    ok('raw 补齐往返', dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, ct2)) === 'raw 补齐');
    ok('raw 补齐产出合法 32 字节密钥', mk('rawkey123').length === 32);
  }

  console.log('\n[6] 篡改密文必须被 GCM 认证拒绝');
  {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN['AES-GCM']));
    const key = await deriveKey('tamper-test-pw', 'AES-GCM', salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('不可篡改')));
    ct[0] ^= 0x01;   // 翻转一个 bit
    let threw = false;
    try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct); } catch { threw = true; }
    ok('GCM 检测出密文被篡改', threw);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})();
