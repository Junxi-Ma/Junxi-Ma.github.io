/* ============================================================
   国际象棋 — 启动器 + 全屏棋盘
   规则与 AI 在 engine.js；本文件做交互、渲染与联机同步。
   联机：Supabase 房间码准入，fen 为局面真相，realtime + 4s 轮询兜底。
   ============================================================ */
import {
  START_FEN, parseFEN, toFEN, genLegal, makeMove, unmakeMove, moveToSan,
  gameStatus, inCheck, findBestMove, pieceGlyph,
} from './engine.js';
import { getSupabase, isConfigured } from '../../assets/js/supabase.js';

(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 静默 */ }
    },
  };

  const launcherEl = $('#ch-launcher');
  const gameEl = $('#ch-game');
  const boardEl = $('#ch-board');
  const statusEl = $('#ch-status');
  const modeChip = $('#ch-modechip');
  const clockEl = $('#ch-clock');
  const capTopEl = $('#ch-cap-top');
  const capBottomEl = $('#ch-cap-bottom');
  const roomChip = $('#ch-roomchip');

  /* ---------- 全局状态 ---------- */
  let mode = 'ai';             // ai | online
  let st = parseFEN(START_FEN);
  let history = [];            // [{ san, fen }]
  let selected = -1;
  let targets = [];
  let lastMove = null;
  let over = false;
  let resultText = '';
  let flipped = false;
  let startTime = Date.now();
  let clockTimer = null;

  let aiDiff = store.get('ch-aidiff-v1', 2) ?? 2;
  let aiColorMe = store.get('ch-aiside-v1', 'w') || 'w';
  let thinking = false;

  let online = null;           // { code, seat, channel, poll, room, finishedShown }
  let cloudSb = null;
  let cloudUser = null;

  const DIFF_LABEL = ['新手', '业余', '棋手', '大师'];
  const DIFF_CFG = [
    { maxDepth: 1, timeMs: 200 },
    { maxDepth: 2, timeMs: 400 },
    { maxDepth: 3, timeMs: 800 },
    { maxDepth: 5, timeMs: 1400 },
  ];

  function myName() {
    return cloudUser?.name || store.get('ch-name-v1', '') || '';
  }
  async function ensureName() {
    let name = myName();
    if (name) return name;
    name = await new Promise((resolve) => {
      showDialog('怎么称呼你？', (body) => {
        const input = document.createElement('input');
        input.className = 'ch-code-input';
        input.style.letterSpacing = '0';
        input.maxLength = 16;
        input.placeholder = '对局昵称';
        body.appendChild(input);
        const foot = document.createElement('div');
        foot.className = 'ch-actions';
        const ok = document.createElement('button');
        ok.className = 'ch-btn primary';
        ok.type = 'button';
        ok.textContent = '开始对弈';
        ok.addEventListener('click', () => {
          const v = input.value.trim() || '棋手';
          store.set('ch-name-v1', v);
          resolve(v);
        });
        foot.appendChild(ok);
        body.appendChild(foot);
        setTimeout(() => input.focus(), 0);
      });
    });
    closeDialog();
    return name;
  }

  /* ---------- 视图切换 ---------- */
  function showGame(chipText) {
    modeChip.textContent = chipText;
    launcherEl.hidden = true;
    gameEl.hidden = false;
    startClock();
    fitBoard();
    render();
  }
  function showLauncher() {
    gameEl.hidden = true;
    launcherEl.hidden = false;
    stopClock();
  }

  /* ---------- 棋盘渲染 ---------- */
  const squares = [];
  function buildBoard() {
    boardEl.textContent = '';
    for (let dp = 0; dp < 64; dp++) {
      const sq = document.createElement('button');
      sq.type = 'button';
      sq.className = 'ch-sq';
      sq.dataset.dp = dp;
      sq.addEventListener('click', () => onSquare(dp));
      boardEl.appendChild(sq);
      squares.push(sq);
    }
  }
  const dispToSq = (dp) => (flipped ? 63 - dp : dp);

  function render() {
    const checkedKing = (!over && inCheck(st, st.turn))
      ? st.board.findIndex((p, i) => p && p.t === 'k' && p.c === st.turn)
      : -1;
    for (let dp = 0; dp < 64; dp++) {
      const sq = dispToSq(dp);
      const el = squares[dp];
      const r = sq >> 3, c = sq & 7;
      el.className = 'ch-sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      const p = st.board[sq];
      el.innerHTML = '';
      const dispR = dp >> 3, dispC = dp & 7;
      if (dispC === (flipped ? 7 : 0)) {
        const t = document.createElement('span');
        t.className = 'ch-coord rank';
        t.textContent = String(8 - dispR);
        el.appendChild(t);
      }
      if (dispR === (flipped ? 0 : 7)) {
        const t = document.createElement('span');
        t.className = 'ch-coord file';
        t.textContent = String.fromCharCode(97 + (flipped ? 7 - dispC : dispC));
        el.appendChild(t);
      }
      if (p) {
        const s = document.createElement('span');
        s.className = 'ch-piece ' + p.c;
        s.textContent = pieceGlyph(p);
        el.appendChild(s);
      }
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) el.classList.add('last');
      if (sq === selected) el.classList.add('sel');
      if (sq === checkedKing) el.classList.add('check');
      const t = targets.find((x) => x.to === sq);
      if (t) {
        const mark = document.createElement('span');
        mark.className = st.board[sq] ? 'ring' : 'dot';
        el.appendChild(mark);
      }
    }
    renderCaptures();
    renderStatus();
    updateButtons();
  }

  function renderCaptures() {
    const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const p of st.board) if (p && p.t !== 'k') cnt[p.c][p.t]++;
    const order = ['q', 'r', 'b', 'n', 'p'];
    const lost = (c) => order.flatMap((t) => Array(Math.max(0, start[t] - cnt[c][t])).fill(t))
      .map((t) => pieceGlyph({ t, c })).join('');
    capTopEl.textContent = lost('b');    // 白方吃掉的黑子（贴着黑方一侧）
    capBottomEl.textContent = lost('w');
  }

  function lastSan() { return history.length ? history[history.length - 1].san : ''; }

  function renderStatus() {
    const last = lastSan() ? ` · 上一步 ${lastSan()}` : '';
    if (over) { statusEl.textContent = resultText + last; return; }
    if (mode === 'ai') {
      statusEl.textContent = (thinking ? 'AI 思考中…' : (st.turn === aiColorMe ? '你的回合' : 'AI 回合')) + last;
      return;
    }
    if (online) {
      const room = online.room;
      if (!room || room.status === 'waiting') {
        statusEl.textContent = `等待对手加入 — 房间码 ${online.code}（点上方房间码可复制）`;
        return;
      }
      if (room.status === 'finished') { statusEl.textContent = (room.result || '对局结束') + last; return; }
      const wName = room.white_name || '白方';
      const bName = room.black_name || '黑方';
      statusEl.textContent = `白 ${wName} ⚔ 黑 ${bName} · ${st.turn === online.seat ? '你走' : '对方走'}${last}`;
    }
  }

  function updateButtons() {
    $('#ch-undo').disabled = mode !== 'ai' || thinking || !history.length;
    $('#ch-resign').disabled = over || (mode === 'online' && (!online || !online.seat || online.room?.status !== 'playing'));
  }

  /* ---------- 走子 ---------- */
  function onSquare(dp) {
    if (over || gameEl.hidden) return;
    if (mode === 'ai' && thinking) return;
    if (mode === 'online' && (!online || online.room?.status !== 'playing')) return;
    const sq = dispToSq(dp);
    if (selected >= 0) {
      const ms = targets.filter((x) => x.to === sq);
      if (ms.length) {
        if (ms.length > 1 && ms[0].promo) { showPromo(ms); return; }
        playMove(ms[0]);
        return;
      }
    }
    const p = st.board[sq];
    const myColor = mode === 'ai' ? aiColorMe : (online ? online.seat : st.turn);
    if (p && p.c === myColor && (mode !== 'online' || st.turn === myColor)) {
      selected = sq;
      targets = genLegal(st).filter((x) => x.from === sq);
      render();
    } else {
      selected = -1;
      targets = [];
      render();
    }
  }

  let pendingPromo = null;
  function showPromo(ms) {
    pendingPromo = ms;
    const row = $('#ch-promo-row');
    row.textContent = '';
    for (const m of ms) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = pieceGlyph({ t: m.promo, c: m.c });
      b.addEventListener('click', () => {
        $('#ch-promo').hidden = true;
        const list = pendingPromo;
        pendingPromo = null;
        if (list) playMove(list.find((x) => x.promo === m.promo) || list[0]);
      });
      row.appendChild(b);
    }
    $('#ch-promo').hidden = false;
  }

  function playMove(m) {
    const san = moveToSan(st, m);
    const undo = makeMove(st, m);
    void undo;
    selected = -1;
    targets = [];
    lastMove = { from: m.from, to: m.to };
    history.push({ san, fen: toFEN(st) });
    afterMove(m);
  }

  function afterMove(m) {
    render();
    const status = gameStatus(st);
    if (status.over) { finish(status); return; }
    if (mode === 'ai' && st.turn !== aiColorMe) aiReply();
    if (mode === 'online' && online) pushOnlineMove();
  }

  /* ---------- 人机 ---------- */
  function aiReply() {
    thinking = true;
    renderStatus();
    setTimeout(() => {
      const m = findBestMove(st, { ...DIFF_CFG[aiDiff], skill: aiDiff });
      thinking = false;
      if (m && !over && mode === 'ai') playMove(m);
      else render();
    }, 80);
  }

  function startAiGame() {
    mode = 'ai';
    st = parseFEN(START_FEN);
    history = [];
    selected = -1;
    targets = [];
    lastMove = null;
    over = false;
    resultText = '';
    thinking = false;
    startTime = Date.now();
    flipped = aiColorMe === 'b';
    showGame('人机 · ' + DIFF_LABEL[aiDiff]);
    if (st.turn !== aiColorMe) aiReply();
  }

  /* ---------- 终局 ---------- */
  function finish(status) {
    over = true;
    resultText = describeResult(status);
    render();
    showDialog('对局结束', resultText);
  }

  function describeResult(status) {
    if (status.reason === 'checkmate') {
      const winner = st.turn === 'w' ? '黑' : '白';
      if (mode === 'ai') return winner === (aiColorMe === 'w' ? '白' : '黑') ? '将杀 —— 你赢了 🎉' : '将杀 —— 你输了 😵';
      return `将杀 —— ${winner}方胜`;
    }
    if (status.reason === 'stalemate') return '逼和 —— 和棋 🤝';
    if (status.reason === 'fifty') return '五十回合无进展 —— 和棋 🤝';
    if (status.reason === 'material') return '双方子力不足 —— 和棋 🤝';
    return '对局结束';
  }
  function statusToRoomResult(status) {
    if (status.reason === 'checkmate') return st.turn === 'w' ? '0-1' : '1-0';
    return '1/2-1/2';
  }

  function showDialog(title, text) {
    $('#ch-card-title').textContent = title;
    $('#ch-card-text').textContent = text;
    $('#ch-modal').hidden = false;
  }
  $('#ch-card-ok').addEventListener('click', () => { $('#ch-modal').hidden = true; });

  /* ---------- 联机房间 ---------- */
  function genCode() {
    const abc = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[(Math.random() * abc.length) | 0];
    return s;
  }

  async function createRoom() {
    if (!cloudSb) { showDialog('联机不可用', '云端未连接，稍后再试。'); return; }
    const name = await ensureName();
    const code = genCode();
    const { error } = await cloudSb.from('chess_rooms').insert({
      code, fen: START_FEN, moves: [], white_name: name, black_name: '', status: 'waiting',
    });
    if (error) { showDialog('创建失败', error.message); return; }
    enterRoom(code, 'w');
  }

  async function joinRoom() {
    if (!cloudSb) { showDialog('联机不可用', '云端未连接，稍后再试。'); return; }
    const code = ($('#ch-code-input').value || '').trim().toUpperCase();
    if (!code) return;
    const { data, error } = await cloudSb.from('chess_rooms').select('*').eq('code', code).maybeSingle();
    if (error || !data) { showDialog('房间不存在', '检查一下房间码？'); return; }
    const remembered = store.get('ch-seat-' + code, null);
    if (data.status === 'waiting' && !data.black_name && remembered !== 'w') {
      const name = await ensureName();
      await cloudSb.from('chess_rooms').update({ black_name: name, status: 'playing', updated_at: new Date().toISOString() }).eq('code', code);
      enterRoom(code, 'b');
      return;
    }
    if (remembered === 'w' || remembered === 'b') { enterRoom(code, remembered); return; }
    enterRoom(code, null); // 满员 → 观战
  }

  function enterRoom(code, seat) {
    online = { code, seat, channel: null, poll: null, room: null, finishedShown: false };
    if (seat) store.set('ch-seat-' + code, seat);
    mode = 'online';
    st = parseFEN(START_FEN);
    history = [];
    selected = -1; targets = []; lastMove = null; over = false; resultText = '';
    flipped = seat === 'b';
    startTime = Date.now();
    showGame('联机 · ' + (seat === 'w' ? '执白' : seat === 'b' ? '执黑' : '观战'));
    roomChip.hidden = false;
    roomChip.textContent = '房间 ' + code;
    if (cloudSb) {
      cloudSb.from('chess_rooms').select('*').eq('code', code).maybeSingle()
        .then(({ data }) => { if (data) onRoom(data); });
      online.channel = cloudSb.channel('chess-room-' + code)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chess_rooms', filter: 'code=eq.' + code },
          (payload) => { if (payload.new) onRoom(payload.new); })
        .subscribe();
    }
    online.poll = setInterval(async () => {
      if (!cloudSb || document.hidden) return;
      const { data } = await cloudSb.from('chess_rooms').select('*').eq('code', code).maybeSingle();
      if (data) onRoom(data);
    }, 4000);
    render();
  }

  function onRoom(room) {
    if (!online || gameEl.hidden) return;
    online.room = room;
    if (room.fen !== toFEN(st)) {
      st = parseFEN(room.fen);
      history = (room.moves || []).slice();
      lastMove = null;
      selected = -1; targets = [];
      const status = gameStatus(st);
      if (status.over && !online.finishedShown) {
        online.finishedShown = true;
        over = true;
        resultText = (room.result ? describeRoomResult(room.result) + ' · ' : '') + describeResult(status);
        showDialog('对局结束', resultText);
      }
    }
    if (room.status === 'finished' && !over) {
      over = true;
      resultText = describeRoomResult(room.result || '1/2-1/2');
      if (!online.finishedShown) { online.finishedShown = true; showDialog('对局结束', resultText); }
    }
    render();
  }

  function describeRoomResult(result) {
    if (result === '1-0') return '白方胜';
    if (result === '0-1') return '黑方胜';
    return '和棋';
  }

  function pushOnlineMove() {
    if (!online || !cloudSb) return;
    cloudSb.from('chess_rooms').update({
      fen: toFEN(st),
      moves: history,
      updated_at: new Date().toISOString(),
    }).eq('code', online.code).then(({ error }) => {
      if (error) console.warn('[棋] 走子同步失败：', error.message);
    });
    const status = gameStatus(st);
    if (status.over) markRoomFinished(statusToRoomResult(status));
  }

  function markRoomFinished(result) {
    if (!online || !cloudSb || !result) return;
    if (online.room && online.room.status === 'finished') return;
    cloudSb.from('chess_rooms').update({
      status: 'finished', result, updated_at: new Date().toISOString(),
    }).eq('code', online.code).then(({ error }) => {
      if (error) console.warn('[棋] 终局同步失败：', error.message);
    });
  }

  function leaveRoom() {
    if (online) {
      if (online.channel) cloudSb?.removeChannel(online.channel);
      if (online.poll) clearInterval(online.poll);
      online = null;
    }
    roomChip.hidden = true;
    st = parseFEN(START_FEN);
    history = []; selected = -1; targets = []; lastMove = null; over = false; resultText = '';
  }

  /* ---------- 计时 ---------- */
  function startClock() {
    stopClock();
    clockTimer = setInterval(() => {
      const t = Math.floor((Date.now() - startTime) / 1000);
      clockEl.textContent = `${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    }, 1000);
  }
  function stopClock() { clearInterval(clockTimer); clockTimer = null; clockEl.textContent = ''; }

  /* ---------- 云端身份 ---------- */
  async function initCloud() {
    if (!isConfigured()) return;
    try {
      const sb = await getSupabase();
      if (!sb) return;
      cloudSb = sb;
      const { data } = await sb.auth.getSession();
      cloudUser = data?.session?.user ? {
        id: data.session.user.id,
        name: data.session.user.user_metadata?.display_name || data.session.user.email?.split('@')[0] || '用户',
      } : null;
    } catch { /* 静默降级 */ }
  }

  /* ---------- 工具条 ---------- */
  $('#ch-exit').addEventListener('click', () => {
    leaveRoom();
    stopClock();
    showLauncher();
  });
  $('#ch-start-ai').addEventListener('click', startAiGame);
  $('#ch-new')?.addEventListener('click', startAiGame);
  $('#ch-undo').addEventListener('click', () => {
    if (mode !== 'ai' || thinking || !history.length) return;
    if (st.turn === aiColorMe && history.length) history.pop();
    if (history.length) { history.pop(); st = parseFEN(history[history.length - 1].fen); }
    else { history = []; st = parseFEN(START_FEN); }
    selected = -1; targets = []; lastMove = null; over = false;
    render();
  });
  $('#ch-resign').addEventListener('click', () => {
    if (over) return;
    if (mode === 'ai') {
      over = true;
      resultText = '你认输了 —— AI 获胜';
      showDialog('认输', '本局结束，点「新对局」再来。');
      render();
    } else if (online && online.seat) {
      const result = online.seat === 'w' ? '0-1' : '1-0';
      markRoomFinished(result);
      over = true;
      resultText = '你认输了 —— 对方胜';
      showDialog('认输', '已认输，对局结束。');
      render();
    }
  });
  $('#ch-flip').addEventListener('click', () => { flipped = !flipped; render(); });
  $('#ch-fs').addEventListener('click', async () => {
    const api = gameEl.requestFullscreen || gameEl.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit.call(document);
      if (p && p.then) { p.then(renderFs).catch(renderFs); }
      setTimeout(renderFs, 120);
    } else if (api) {
      try {
        await Promise.race([
          api.call(gameEl),
          new Promise((_, rej) => setTimeout(() => rej(new Error('fs-timeout')), 800)),
        ]);
        setTimeout(renderFs, 60);
      } catch {
        /* 全屏被拒：游戏视图本来就是铺满的，无需额外处理 */
      }
    }
  });
  function renderFs() { fitBoard(); }
  document.addEventListener('fullscreenchange', () => { renderFs(); });

  /* ---------- 日 / 夜切换（跟随并同步站点主题） ---------- */
  const themeBtn = $('#ch-theme');
  function renderTheme() {
    if (themeBtn) {
      const light = document.documentElement.dataset.theme === 'light';
      themeBtn.textContent = light ? '🌙' : '☀';
      themeBtn.title = light ? '切换到雨夜' : '切换到夏日';
    }
  }
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set('site-theme', next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'light' ? '#faf8f5' : '#0a0a0b';
    renderTheme();
  });
  renderTheme();

  $('#ch-create').addEventListener('click', createRoom);
  $('#ch-join').addEventListener('click', joinRoom);
  $('#ch-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  roomChip.addEventListener('click', async () => {
    if (!online) return;
    try {
      await navigator.clipboard.writeText(online.code);
      roomChip.textContent = '已复制 ' + online.code;
      setTimeout(() => { roomChip.textContent = '房间 ' + online.code; }, 1200);
    } catch { /* 剪贴板不可用则忽略 */ }
  });

  /* ---------- 人机参数 ---------- */
  for (const btn of document.querySelectorAll('#ch-aidiff .ch-chip')) {
    btn.addEventListener('click', () => {
      aiDiff = +btn.dataset.v;
      store.set('ch-aidiff-v1', aiDiff);
      for (const x of document.querySelectorAll('#ch-aidiff .ch-chip')) x.classList.toggle('on', x === btn);
    });
  }
  for (const btn of document.querySelectorAll('#ch-aiside .ch-chip')) {
    btn.addEventListener('click', () => {
      aiColorMe = btn.dataset.v;
      store.set('ch-aiside-v1', aiColorMe);
      for (const x of document.querySelectorAll('#ch-aiside .ch-chip')) x.classList.toggle('on', x === btn);
    });
  }

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (!document.getElementById('ch-modal').hidden) {
      if (e.key === 'Escape' || e.key === 'Enter') $('#ch-modal').hidden = true;
      return;
    }
    if (gameEl.hidden) return;
    const arrows = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in arrows) {
      e.preventDefault();
      if (selected < 0) { onSquare(flipped ? 63 : 56); return; }
      const sq = selected + arrows[e.key];
      if (sq >= 0 && sq < 64 && Math.abs((sq & 7) - (selected & 7)) <= 1) onSquare(dispToSq(flipped ? 63 - sq : sq));
      else onSquare(sq);
    } else if (e.key === 'Enter' && selected >= 0) {
      e.preventDefault();
      onSquare(dispToSq(flipped ? 63 - selected : selected));
    } else if (e.key === 'Escape') {
      // 真全屏时先让浏览器退出全屏，不连着退对局
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      $('#ch-exit').click();
    }
  });

  /* ---------- 尺寸 ---------- */
  function fitBoard() {
    const w = boardEl.clientWidth;
    if (w > 0) boardEl.style.setProperty('--ch-piece', (w / 8 * 0.74).toFixed(1) + 'px');
  }
  window.addEventListener('resize', fitBoard);

  /* ---------- 启动 ---------- */
  buildBoard();
  render();
  fitBoard();
  initCloud();
})();
