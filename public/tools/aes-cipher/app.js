/* ============================================================
   aes-cipher/app.js — AES 加解密
   需求：输入原文 → 选 AES 加密 → 设置密钥（建议 8 位以上）→
         点击「加密」得到密文；对方用相同密钥解密还原。

   实现要点
   · 算法全部走浏览器原生 Web Crypto（crypto.subtle），零依赖、零请求。
   · 密文自带全部解密参数（算法 / 派生方式 / 盐 / IV），
     所以对方只要「相同密钥」就能解开，不用再对任何选项。
   · 密钥只存在于内存变量与输入框里：不写 localStorage、
     不进 URL、不发网络 —— 刷新页面即消失。
   ============================================================ */

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------- 默认参数 ---------- */
const DEFAULTS = {
  cost: 120000,   // PBKDF2 迭代次数
  minKey: 8,      // 用户侧「建议 8 位以上」
};

/* GCM 用 12 字节 IV（NIST 推荐）；CBC 用 16 字节，正好一个块 */
const IV_LEN = { 'AES-GCM': 12, 'AES-CBC': 16 };
const SALT_LEN = 16;
const ENVELOPE = 'MICHAEL-AES';
const ENVELOPE_V = 1;
const ALG_TAG = { 'AES-GCM': 'gcm', 'AES-CBC': 'cbc' };
const TAG_ALG = { gcm: 'AES-GCM', cbc: 'AES-CBC' };
const KDF_TAG = { 'PBKDF2': 1, 'SHA-256': 2, 'raw': 3 };
const TAG_KDF = { 1: 'PBKDF2', 2: 'SHA-256', 3: 'raw' };

/* ---------- 元素 ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  input: $('input'),
  key: $('key'),
  output: $('output'),
  inputMeta: $('input-meta'),
  outputMeta: $('output-meta'),
  status: $('status'),
  statusMsg: $('status-msg'),
  strength: $('strength'),
  strengthText: $('strength-text'),
  cipher: $('cipher'),
  kdf: $('kdf'),
  outfmt: $('outfmt'),
  run: $('btn-run'),
  copy: $('btn-copy'),
  swap: $('btn-swap'),
  clear: $('btn-clear'),
  toggleKey: $('btn-toggle-key'),
  strengthen: $('btn-strengthen'),
  inputLabel: document.querySelector('label[for="input"]'),
  inputHint: $('input-hint'),
  outputLabel: $('output-label'),
  outputHint: $('output-hint'),
  flow: $('flow'),
  flowRows: $('flow-rows'),
  flowHint: $('flow-hint'),
  modes: document.querySelectorAll('.ac-mode'),
};

/* ---------- 运行期状态 ---------- */
let mode = 'encrypt';        // encrypt | decrypt
let busy = false;
let animation = null;        // 派生密钥进度动画句柄
let keyCache = null;         // { ck, material } —— 同一密钥不重复派生

/* ============================================================
   工具函数
   ============================================================ */

const byteLen = (s) => enc.encode(s).length;

function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(str) {
  const out = new Uint8Array(str.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(str.substr(i * 2, 2), 16);
  return out;
}

const toUrlSafe = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (s) => s.replace(/-/g, '+').replace(/_/g, '/');

/** 把字节编成指定格式的密文文本 */
function encodeBytes(bytes, format) {
  if (format === 'hex') return bytesToHex(bytes);
  const b64 = bytesToBase64(bytes);
  return format === 'url' ? toUrlSafe(b64) : b64;
}

/** 把任意用户粘贴的文本还原成字节（自动识别 Base64 / Hex / URL 变体） */
function decodeBytes(text) {
  const spaced = /[\s\r\n]/.test(text);
  const t = spaced ? text.replace(/[\s\r\n]+/g, '') : text;

  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0) return hexToBytes(t);

  const b64 = fromUrlSafe(t);
  /* Base64 去掉填充后长度 mod 4 绝不可能等于 1；出现即说明复制漏了字符 */
  if (b64.length % 4 === 1) throw new Error('密文不是有效的 Base64 —— 可能复制时漏字符了');

  let padded = b64.replace(/=+$/, '');
  while (padded.length % 4) padded += '=';

  try {
    return base64ToBytes(padded);
  } catch {
    throw new Error('密文不是有效的 Base64 / Hex —— 请检查是否复制完整');
  }
}

/* ============================================================
   密钥派生
   ============================================================ */

async function deriveKey(password, alg, kdfName, salt) {
  if (kdfName === 'raw') {
    /* 直接取密钥字节，不足 32 补零、超出截断。
       互通性最好，但短密钥强度弱 —— 界面上已给出提示。 */
    const raw = enc.encode(password);
    const buf = new Uint8Array(32);
    buf.set(raw.subarray(0, 32));
    return crypto.subtle.importKey('raw', buf, { name: alg }, false, ['encrypt', 'decrypt']);
  }

  if (kdfName === 'PBKDF2') {
    const base = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: DEFAULTS.cost, hash: 'SHA-256' },
      base,
      { name: alg, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /* SHA-256 直接取位：性能最好，弱口令下最不安全 */
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', enc.encode(password))
  );
  return crypto.subtle.importKey('raw', digest, { name: alg }, false, ['encrypt', 'decrypt']);
}

/** 缓存：密码 + 算法 + 派生方式相同时不重复派生（PBKDF2 12 万次不便宜） */
async function getKey(password, alg, kdfName, salt) {
  const ck = `${password}\u0000${alg}\u0000${kdfName}\u0000${bytesToHex(salt)}`;
  if (keyCache && keyCache.ck === ck) return keyCache.material;
  const key = await deriveKey(password, alg, kdfName, salt);
  keyCache = { ck, material: key };
  return key;
}

/* ============================================================
   密文信封
   ============================================================ */

/** 组包：MAGIC.V.模式字符.派生码.盐.IV.密文
 *  salt / IV 固定用 Base64（定长二进制），正文段按 format 编码 */
function packEnvelope(alg, kdfName, salt, iv, data, format = 'base64') {
  return [
    ENVELOPE,
    ENVELOPE_V,
    ALG_TAG[alg],
    KDF_TAG[kdfName],
    bytesToBase64(salt),
    bytesToBase64(iv),
    encodeBytes(data, format),
  ].join('.');
}

/** 拆包：带前缀的直接读参数；裸密文返回 null（用界面当前选项） */
function unpackEnvelope(text) {
  const t = text.trim();
  if (!t.startsWith(ENVELOPE + '.')) return null;

  const parts = t.split('.');
  if (parts[0] !== ENVELOPE) return null;
  if (Number(parts[1]) !== ENVELOPE_V) {
    throw new Error(`密文版本 V${parts[1]} 本页还不支持，请更新页面`);
  }
  const alg = TAG_ALG[parts[2]];
  const kdfName = TAG_KDF[parts[3]];
  if (!alg || !kdfName) throw new Error('密文头里的算法标识无法识别');

  let salt, iv;
  try {
    salt = base64ToBytes(parts[4]);
    iv = base64ToBytes(parts[5]);
  } catch {
    throw new Error('密文头损坏 —— 前缀里的盐或 IV 不是合法 Base64');
  }
  if (!salt.length || !iv.length) throw new Error('密文头里的盐或 IV 缺失');

  /* 正文段可能是 Base64 / Hex / URL 变体，交给 decodeBytes 自动识别 */
  return { alg, kdfName, salt, iv, raw: parts.slice(6).join('.') };
}

/* ============================================================
   加解密主流程
   ============================================================ */

function stopAnimation() {
  if (animation) {
    cancelAnimationFrame(animation.raf);
    for (const b of animation.buttons) b.classList.remove('is-on');
    animation = null;
  }
}

/** 派生密钥期间让流程行的按钮依次亮起 —— 既是进度也是动效 */
function startAnimation() {
  const buttons = [...els.flowRows.querySelectorAll('.ac-flow__btn')];
  stopAnimation();
  if (!buttons.length) return;

  const PERIOD = 140;
  const start = performance.now();
  animation = {
    buttons,
    raf: 0,
    tick(now) {
      const idx = Math.floor((now - start) / PERIOD) % buttons.length;
      buttons.forEach((b, i) => b.classList.toggle('is-on', i === idx));
      animation.raf = requestAnimationFrame(animation.tick);
    },
  };
  animation.raf = requestAnimationFrame(animation.tick);
}

/** 渲染流程行：两种模式下分别是「原文→密文」与「密文→原文」 */
function renderFlow() {
  const isEnc = mode === 'encrypt';
  const fromGlyph = isEnc ? '📄' : '🔒';
  const toGlyph = isEnc ? '🔒' : '📄';
  const fromLabel = isEnc ? '原文' : '密文';
  const toLabel = isEnc ? '密文' : '原文';

  els.flow.dataset.stage = isEnc ? 'encrypt' : 'decrypt';
  els.flowRows.classList.toggle('is-single', true);
  els.flowRows.replaceChildren();

  const chip = (glyph, text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ac-chip ac-flow__btn';
    b.textContent = `${glyph} ${text}`;
    return b;
  };

  els.flowRows.append(
    chip(fromGlyph, fromLabel),
    chip('🔑', '密钥'),
    chip(toGlyph, toLabel)
  );

  els.flowHint.textContent = isEnc
    ? '填好原文与密钥后点击「加密」'
    : '粘贴密文与密钥后点击「解密」';
}

/* ---------- 状态条 ---------- */
function setStatus(kind, msg) {
  els.status.classList.remove('is-ok', 'is-err');
  if (kind) els.status.classList.add(`is-${kind}`);

  const dot = document.createElement('span');
  dot.className = 'dot';
  els.statusMsg.replaceChildren(dot, document.createTextNode(msg));
}

/* ---------- 输入统计 ---------- */
function refreshInputMeta() {
  const v = els.input.value;
  els.inputMeta.textContent = v
    ? `${v.length} 字 · ${byteLen(v)} bytes`
    : `0 字 · 0 bytes`;
}

/* ---------- 密钥强度 ---------- */
function evaluateKey(pw) {
  if (!pw) return { level: 0, text: '等待输入密钥' };

  let score = 0;
  if (pw.length >= DEFAULTS.minKey) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;

  /* 字符种类：大小写 / 数字 / 符号 */
  let kinds = 0;
  if (/[a-z]/.test(pw)) kinds++;
  if (/[A-Z]/.test(pw)) kinds++;
  if (/\d/.test(pw)) kinds++;
  if (/[^A-Za-z0-9]/.test(pw)) kinds++;
  if (kinds >= 3) score++;
  if (/^\d+$/.test(pw) || /^[a-z]+$/i.test(pw)) score = Math.min(score, 1);

  const level = Math.max(1, Math.min(4, score));
  const label = ['', '偏弱', '一般', '良好', '很强'][level];

  let text = `${label} · ${pw.length} 位`;
  if (pw.length < DEFAULTS.minKey) text += ` · 建议 ${DEFAULTS.minKey} 位以上`;
  return { level, text };
}

function refreshStrength() {
  const { level, text } = evaluateKey(els.key.value);
  els.strength.dataset.level = String(level);
  els.strengthText.textContent = text;
}

/* ---------- 生成强密钥 ---------- */
function randomKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/* ============================================================
   主操作
   ============================================================ */

async function run() {
  if (busy) return;

  const password = els.key.value;
  const text = els.input.value;

  /* ---- 前置校验 ---- */
  if (!text.trim()) {
    setStatus('err', mode === 'encrypt' ? '请先输入要加密的原文' : '请先粘贴要解密的密文');
    els.input.classList.add('is-err');
    els.input.focus();
    return;
  }
  els.input.classList.remove('is-err');

  if (!password) {
    setStatus('err', '请先设置密钥 —— 解密方需要同一把密钥');
    els.key.focus();
    return;
  }

  if (mode === 'encrypt' && password.length < DEFAULTS.minKey) {
    setStatus('err', `密钥太短（当前 ${password.length} 位）—— 建议 ${DEFAULTS.minKey} 位以上，否则容易被猜到`);
    els.key.focus();
    return;
  }

  /* ---- 解密：带前缀的密文自带参数，裸密文用界面选项 ---- */
  let alg = els.cipher.value;
  let kdfName = els.kdf.value;
  let salt;
  let iv;
  let payloadText = text.trim();
  let format = els.outfmt.value;

  if (mode === 'decrypt') {
    let env = null;
    try {
      env = unpackEnvelope(payloadText);
    } catch (e) {
      setStatus('err', e.message);
      return;
    }
    if (env) {
      alg = env.alg;
      kdfName = env.kdfName;
      salt = env.salt;
      iv = env.iv;
      payloadText = env.raw;
      /* 正文段可能是 Base64 / Hex / URL 变体，decodeBytes 会自动识别 */
    }
  }

  /* 只有解密才需要把密文文本还原成字节；
     加密方向的输入是明文，绝不能拿去当 Base64 解。 */
  let data = null;
  if (mode === 'decrypt') {
    try {
      data = decodeBytes(payloadText);
    } catch (e) {
      setStatus('err', e.message);
      return;
    }
    if (!data.length) {
      setStatus('err', '密文是空的 —— 请检查是否复制完整');
      return;
    }
  }

  /* ---- 上锁 ---- */
  busy = true;
  els.run.setAttribute('aria-busy', 'true');
  const originalLabel = els.run.textContent;
  els.run.textContent = mode === 'encrypt' ? '加密中…' : '解密中…';
  setStatus('', '正在派生密钥…');
  if (mode === 'encrypt' || !salt) startAnimation();

  try {
    if (!salt) salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    if (!iv) iv = crypto.getRandomValues(new Uint8Array(IV_LEN[alg]));

    const key = await getKey(password, alg, kdfName, salt);

    if (mode === 'encrypt') {
      const buf = await crypto.subtle.encrypt({ name: alg, iv }, key, enc.encode(text));
      const bytes = new Uint8Array(buf);

      /* 密文一律带信封前缀：算法 / 派生方式 / 盐 / IV 都写在里面，
         对方只要「相同密钥」即可解开，不需要知道任何选项。
         上面选的输出格式只决定信封正文段的编码。 */
      els.output.value = packEnvelope(alg, kdfName, salt, iv, bytes, format);

      const shownFmt = format === 'hex' ? 'HEX' : format === 'url' ? 'URL-SAFE' : 'BASE64';
      setStatus('ok', `✓ 加密完成 — ${alg} · ${kdfName} · ${shownFmt}`);
      els.outputMeta.textContent = `${els.output.value.length} 字符 · ${byteLen(els.output.value)} bytes`;
      els.copy.focus();
    } else {
      const buf = await crypto.subtle.decrypt({ name: alg, iv }, key, data);
      const plain = dec.decode(buf);
      els.output.value = plain;
      setStatus('ok', `✓ 解密成功 — 原文 ${plain.length} 字`);
      els.outputMeta.textContent = `${plain.length} 字 · ${byteLen(plain)} bytes`;
      els.copy.focus();
    }
  } catch (e) {
    /* GCM 校验失败会抛 OperationError；CBC 解密失败多半是填充错误 */
    if (mode === 'decrypt') {
      setStatus('err', '解密失败 —— 密钥不对，或密文被改动 / 复制不完整');
    } else {
      setStatus('err', `加密失败：${e && e.message ? e.message : e}`);
    }
    els.output.value = '';
    els.outputMeta.textContent = '等待生成';
  } finally {
    stopAnimation();
    busy = false;
    els.run.removeAttribute('aria-busy');
    els.run.textContent = originalLabel;
  }
}

/* ============================================================
   模式与交互
   ============================================================ */

function switchMode(next) {
  if (busy || next === mode) return;
  mode = next;

  /* 切换时把「结果」搬到「输入」——这就是加解密往返的手感 */
  if (els.output.value) {
    els.input.value = els.output.value;
  }
  els.output.value = '';

  els.modes.forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });

  const isEnc = mode === 'encrypt';
  els.run.textContent = isEnc ? '加密' : '解密';
  els.inputLabel.textContent = isEnc ? '原文' : '密文';
  els.inputHint.textContent = isEnc ? '要加密的内容' : '粘贴收到的密文';
  els.outputLabel.textContent = isEnc ? '密文' : '原文';
  els.outputHint.textContent = isEnc ? '复制给对方' : '解密结果';
  els.output.placeholder = isEnc
    ? '点击「加密」后，密文会出现在这里'
    : '点击「解密」后，原文会出现在这里';
  els.input.placeholder = isEnc
    ? '在此输入要加密的原文，例如：\n明天下午三点，老地方见。'
    : '在此粘贴收到的密文，可带空格换行';

  renderFlow();
  refreshInputMeta();
  setStatus('', isEnc
    ? '准备就绪 — 填入原文与密钥后点击「加密」'
    : '准备就绪 — 粘贴密文与密钥后点击「解密」');
  els.outputMeta.textContent = '等待生成';
  els.input.focus();
}

/* ---------- 事件绑定 ---------- */

els.modes.forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));
els.run.addEventListener('click', run);

els.input.addEventListener('input', refreshInputMeta);
els.key.addEventListener('input', () => {
  refreshStrength();
  keyCache = null;   // 密钥变了，缓存作废
});
els.cipher.addEventListener('change', () => { keyCache = null; });
els.kdf.addEventListener('change', () => { keyCache = null; });

els.toggleKey.addEventListener('click', () => {
  const show = els.key.type === 'password';
  els.key.type = show ? 'text' : 'password';
  els.toggleKey.textContent = show ? '隐藏' : '显示';
  els.toggleKey.setAttribute('aria-pressed', String(show));
});

els.strengthen.addEventListener('click', () => {
  els.key.value = randomKey();
  els.key.type = 'text';
  els.toggleKey.textContent = '隐藏';
  els.toggleKey.setAttribute('aria-pressed', 'true');
  keyCache = null;
  refreshStrength();
  els.key.select();
  setStatus('', '已生成随机强密钥 — 请复制保存好，丢失后密文无法找回');
});

els.copy.addEventListener('click', async () => {
  if (!els.output.value) return;
  try {
    await navigator.clipboard.writeText(els.output.value);
  } catch {
    els.output.select();
    document.execCommand('copy');
  }
  const old = els.copy.textContent;
  els.copy.textContent = '已复制 ✓';
  setTimeout(() => (els.copy.textContent = old), 1400);
});

els.swap.addEventListener('click', () => {
  if (!els.output.value) {
    setStatus('err', '还没有结果可以搬到输入框');
    return;
  }
  els.input.value = els.output.value;
  if (mode === 'encrypt') switchMode('decrypt');
  refreshInputMeta();
  setStatus('', '已把结果放入输入框 — 可直接测试解密');
});

els.clear.addEventListener('click', () => {
  els.input.value = '';
  els.output.value = '';
  els.key.value = '';
  keyCache = null;
  refreshInputMeta();
  refreshStrength();
  els.outputMeta.textContent = '等待生成';
  setStatus('', '已清空 — 原文、密文与密钥都已从页面移除');
  els.input.focus();
});

/* Ctrl / Cmd + Enter 触发主操作 */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    run();
  }
});

/* ---------- 启动 ---------- */
if (!crypto.subtle) {
  setStatus('err', '当前浏览器不支持 Web Crypto —— 请用 HTTPS 或 localhost 打开本页');
  els.run.disabled = true;
} else {
  renderFlow();
  refreshInputMeta();
  refreshStrength();
}
