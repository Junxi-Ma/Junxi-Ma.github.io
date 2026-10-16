/* 抽取 app.js 里的纯函数（编解码 + 信封），在 Node 里直接验证。
   不复制粘贴逻辑 —— 从源文件读出来 eval，保证测的就是线上那份代码。 */

const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* 从源码里抠出需要的函数与常量，剥离 DOM 相关部分 */
const consts = src.match(/const (ENVELOPE|ENVELOPE_V|ALG_TAG|TAG_ALG|KDF_TAG|TAG_KDF)\s*=\s*[^;]+;/g).join('\n');
const fns = ['bytesToBase64', 'base64ToBytes', 'bytesToHex', 'hexToBytes', 'encodeBytes', 'decodeBytes', 'packEnvelope', 'unpackEnvelope']
  .map((n) => {
    const m = src.match(new RegExp(`^function ${n}\\([\\s\\S]*?^}`, 'm'));
    if (!m) throw new Error(`找不到函数 ${n}`);
    return m[0];
  }).join('\n\n');

const helpers = `
const toUrlSafe = (b64) => b64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (s) => s.replace(/-/g, '+').replace(/_/g, '/');
`;

const mod = new Function(`
  const enc = new TextEncoder(); const dec = new TextDecoder();
  ${consts}
  ${helpers}
  ${fns}
  return { encodeBytes, decodeBytes, packEnvelope, unpackEnvelope, bytesToBase64, base64ToBytes };
`)();

const { encodeBytes, decodeBytes, packEnvelope, unpackEnvelope } = mod;
const crypto = webcrypto;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`  ✓ ${n}${e ? ' — ' + e : ''}`)) : (fail++, console.log(`  ✗ ${n}${e ? ' — ' + e : ''}`)); };
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {
  const alg = 'AES-GCM', kdf = 'PBKDF2';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new Uint8Array([...crypto.getRandomValues(new Uint8Array(48))]);
  const text = '跨格式往返验证 ✔ 中文/emoji';

  for (const fmt of ['base64', 'hex', 'url']) {
    console.log(`\n[格式 ${fmt}]`);
    const env = packEnvelope(alg, kdf, salt, iv, payload, fmt);
    ok('信封以 MAGIC 开头', env.startsWith('MICHAEL-AES.1.gcm.1.'));

    const parsed = unpackEnvelope(env);
    ok('拆包成功', parsed !== null);
    ok('算法回读一致', parsed.alg === alg && parsed.kdfName === kdf);
    ok('盐一致', eqBytes(parsed.salt, salt));
    ok('IV 一致', eqBytes(parsed.iv, iv));
    ok('正文段可解回原字节', eqBytes(decodeBytes(parsed.raw), payload), `${parsed.raw.length} 字符`);
  }

  console.log('\n[容错：换行与空格]');
  {
    const env = packEnvelope(alg, kdf, salt, iv, payload, 'base64');
    const pretty = env.slice(0, 30) + '\n  ' + env.slice(30);
    const p = unpackEnvelope(pretty);
    ok('带换行空格仍可拆包解码', p && eqBytes(decodeBytes(p.raw), payload));
  }

  console.log('\n[裸 Base64（无前缀）]');
  {
    const bare = encodeBytes(payload, 'base64');
    ok('无前缀时返回 null（用界面选项）', unpackEnvelope(bare) === null);
    ok('裸密文本身仍可解码', eqBytes(decodeBytes(bare), payload));
  }

  console.log('\n[错误处理]');
  {
    let threw = '';
    try { unpackEnvelope('MICHAEL-AES.9.gcm.1.AAAA.AAAA.AAAA'); } catch (e) { threw = e.message; }
    ok('版本号过高被拒', /版本/.test(threw), threw);

    threw = '';
    try { unpackEnvelope('MICHAEL-AES.1.xxx.1.AAAA.AAAA.AAAA'); } catch (e) { threw = e.message; }
    ok('未知算法标识被拒', /算法/.test(threw), threw);

    threw = '';
    try { decodeBytes('!!!!not base64!!!!'); } catch (e) { threw = e.message; }
    ok('非法密文被拒', threw.length > 0, threw);
  }

  console.log('\n[URL 安全 Base64 不含 + / = ]');
  {
    let sawUnsafe = false;
    for (let i = 0; i < 200; i++) {
      const p = crypto.getRandomValues(new Uint8Array(32));
      const s = encodeBytes(p, 'url');
      if (/[+/=]/.test(s)) { sawUnsafe = true; break; }
      if (!eqBytes(decodeBytes(s), p)) { ok('URL 变体往返', false); break; }
    }
    ok('200 组随机字节 URL 变体均无 + / = 且往返正确', !sawUnsafe);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})();
