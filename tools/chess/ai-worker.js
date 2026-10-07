/* ============================================================
   ai-worker.js — 棋类 AI 专用 Worker（模块型）
   把中国象棋 / 五子棋 / 围棋的搜索挪出主线程，避免长时间思考冻结界面。
   兜底：Worker 创建失败时 app.js 直接在主线程调用同一批函数。
   ============================================================ */
import * as Xiangqi from './xiangqi.js?v=22';
import * as Gomoku from './gomoku.js?v=22';
import * as GoMod from './go.js?v=22';

const IMPL = {
  xiangqi: (st, opts) => Xiangqi.findBestMove(st, opts),
  gomoku: (bd, me, level) => Gomoku.bestMove(bd, me, level),
  go: (bd, color, ko, level) => GoMod.aiMove(bd, color, ko, level),
};

self.onmessage = (e) => {
  const { id, fn, args } = e.data || {};
  const impl = IMPL[fn];
  if (!impl) { self.postMessage({ id, ok: false, error: 'unknown fn ' + fn }); return; }
  try {
    self.postMessage({ id, ok: true, result: impl(...args) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
