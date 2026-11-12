from pathlib import Path
import subprocess
r=Path(__file__).resolve().parents[1]
# Restore only the previous turn's integration; the other four games keep their existing UI.
for name in ['tools/chess/app.js','tools/chess/ai-worker.js','tools/chess/style.css','tools/chess/index.html','tools/chess/meta.json','supabase/schema.sql']:
    (r/name).write_bytes((r/'tmp'/('base-'+Path(name).name)).read_bytes())
old=r/'tools/chess/connect4.js'
engine=old.read_text(encoding='utf-8').split('/* Native SVG projection')[0]
(r/'tools/connect4/vendor').mkdir(parents=True,exist_ok=True)
(r/'tools/connect4/engine.js').write_text(engine,encoding='utf-8')
old.unlink()
p=r/'scripts/check_connect4.mjs'
p.write_text(p.read_text(encoding='utf-8').replace('../tools/chess/connect4.js','../tools/connect4/engine.js'),encoding='utf-8')
# Use the reference page's actual navigation, typography, and paper controls.
s=(r/'tools/sudoku/index.html').read_text(encoding='utf-8')
s=s.replace('纸感数独','三维四子棋').replace('现代纸感数独：入门到专家四档唯一解棋盘，铅笔笔记、提示、撤销与三次失误上限；成绩自动署名上云，英雄榜每人只计最快。','纸感桌面上的三维四子棋。两人同屏，点按立柱落子，拖动旋转棋盘；支持悔棋与 AI 提示。')
s=s.replace('<link rel="stylesheet" href="style.css?v=3">','<link rel="stylesheet" href="../sudoku/style.css?v=3">\n  <link rel="stylesheet" href="style.css?v=2">\n  <script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>')
a=s.index('        <p>现代纸感设计')
b=s.index('\n      </div>',a)
s=s[:a]+'        <p>两个人，一张棋盘。点立柱落子，拖动转个角度；任意方向四子相连就获胜。</p>'+s[b:]
a=s.index('      <div class="sk-layout">')
b=s.index('\n    </div>\n  </main>',a)
s=s[:a]+'''      <div class="sk-stage c4-stage" id="c4-stage">
        <section class="sk-sheet c4-sheet" aria-label="三维四子棋双人棋盘">
          <header class="c4-head">
            <div class="c4-players" aria-label="当前回合"><span class="c4-player active" id="player-1"><i class="black"></i>黑方<span>先手</span></span><span class="c4-versus">/</span><span class="c4-player" id="player-2"><i class="white"></i>白方<span>后手</span></span></div>
            <span class="c4-count" id="c4-count">00 <span>/ 64</span></span>
          </header>
          <div class="c4-viewport" id="c4-viewport" tabindex="0" role="application" aria-label="三维四子棋。点击立柱直接落子；拖动旋转。方向键选列，Enter 落子。">
            <div class="c4-loading" id="c4-loading" role="status">正在摆好棋盘…</div>
            <div class="c4-viewbar" aria-label="视角"><button class="c4-view on" data-view="angle" type="button" aria-pressed="true">立体</button><button class="c4-view" data-view="top" type="button" aria-pressed="false">俯视</button><button class="c4-reset" id="c4-reset" type="button" aria-label="复位视角" title="复位视角">↺</button></div>
            <span class="c4-gesture">拖动旋转 · 点按落子</span>
          </div>
          <div class="c4-statusline"><p id="c4-status" aria-live="polite">黑方先行，点一根立柱开始。</p><span id="c4-position"></span></div>
          <div class="sk-tools c4-tools">
            <button type="button" class="sk-btn" id="c4-undo" disabled>↶ 悔棋</button>
            <button type="button" class="sk-btn" id="c4-hint">✧ 提示</button>
            <button type="button" class="sk-btn" id="c4-new">↻ 重开</button>
            <button type="button" class="sk-btn" id="c4-fs">⛶ 全屏</button>
          </div>
        </section>
        <p class="sk-tip c4-tip">4 × 4 × 4 · 棋子沿杆落下，横、竖或空间斜线连成四子获胜。<br>看不清落点时，转动棋盘，或切到俯视。</p>
      </div>'''+s[b:]
s=s.replace('Tool <span>/</span> 08','Tool <span>/</span> 12').replace('src="app.js?v=4"','src="app.js?v=2"')
(r/'tools/connect4/index.html').write_text(s,encoding='utf-8')
# Keep an obvious link from the chess collection without reintroducing its launcher complexity.
p=r/'tools/chess/index.html';s=p.read_text(encoding='utf-8');s=s.replace('<p class="ch-label">对局模式</p>','<p class="ch-tip" style="margin:12px 0 18px"><a href="../connect4/">三维四子棋 ↗</a> · 纸感棋盘，两人直接开玩</p>\n          <p class="ch-label">对局模式</p>');p.write_text(s,encoding='utf-8')
print('Created standalone paper-style game; restored other chess games.')
