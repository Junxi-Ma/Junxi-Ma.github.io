/**
 * Stardy · 大气探测学知识卡片 — 交互逻辑
 *
 * 功能：浏览 / 背诵 / 问答三种模式
 * 数据持久化：localStorage（学习进度）
 */

import { SUBJECT, CHAPTERS, CARDS } from './atmos-data.js';

/* ========================================================
   工具函数
   ======================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 章节映射
const CHAPTER_MAP = Object.fromEntries(CHAPTERS.map(c => [c.id, c]));

// 卡片按章节分组
const CARDS_BY_CHAPTER = CARDS.reduce((acc, card) => {
  (acc[card.chapter] ||= []).push(card);
  return acc;
}, {});

/* ========================================================
   简易 Markdown 渲染（支持 bold/table/list/quote/math）
   ======================================================== */

function renderMarkdown(text) {
  if (!text) return '';

  let html = text;

  // 转义 HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 表格（简单支持）
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.slice(1, -1).split('|').map(c => c.trim());
    // 检测是否是分隔行 |---|---|
    if (cells.every(c => /^[-:]+$/.test(c))) return '';
    const isHeader = cells.some(c => c.startsWith('---'));
    const tag = isHeader ? 'th' : 'td';
    return `<tr>${cells.map(c => `<${tag}>${c.replace(/^---/, '')}</${tag}>`).join('')}</tr>`;
  });

  // 表格检测：连续的 |...| 行
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\s*)+/g, (match) => {
    return `<table><tbody>${match}</tbody></table>`;
  });

  // 引用块 > ...
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // 公式块 $$...$$
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) =>
    katex.renderToString(tex, { displayMode: true, throwOnError: false })
  );

  // 行内公式 $...$
  html = html.replace(/\$([^\$\n]+?)\$/g, (_, tex) =>
    katex.renderToString(tex, { displayMode: false, throwOnError: false })
  );

  // 粗体 **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 行内代码 `...`
  html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

  // 有序列表 1. 2.
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>(\s*))/g, (match) => `<ol>${match}</ol>`);

  // 无序列表 - ...
  html = html.replace(/^[-]\s+(.+)$/gm, '<li class="ul-item">$1</li>');
  html = html.replace(/(<li class="ul-item">[\s\S]*?<\/li>(\s*))/g, (match) => `<ul>${match}</ul>`);

  // 段落：双换行 → 段落分隔
  html = html.replace(/\n\n/g, '</p><p>');
  html = `<p>${html}</p>`;

  // 清理空段落
  html = html.replace(/<p>\s*<\/p>/g, '');

  // 去掉 li 上的 class
  html = html.replace(/class="ul-item"/g, '');

  return html;
}

/* ========================================================
   挖空（Cloze）渲染
   ======================================================== */

function renderCloze(html) {
  // 在已有 HTML 里，对 <strong> 内的关键词挖空
  // 同时对 <td> 里的数值挖空
  const tokenizer = /[\u4e00-\u9fa5]{2,}|[A-Za-z]{2,}|\d+(?:\.\d+)?/g;

  // 对 <strong> 标签内的内容挖空
  html = html.replace(/<strong>([^<]+)<\/strong>/g, (_, content) => {
    const blanks = [];
    let idx = 0;
    const replaced = content.replace(tokenizer, (match) => {
      const id = `blk-${Date.now()}-${idx++}`;
      blanks.push(`<span class="sdy-blank" data-idx="${id}" data-text="${match}">&nbsp;</span>`);
      return blanks[blanks.length - 1];
    });
    return replaced;
  });

  // 对 <code> 内的内容也挖空（公式变量名）
  html = html.replace(/<code>([^<]+)<\/code>/g, (_, content) => {
    return `<span class="sdy-blank" data-text="${content}">&nbsp;</span>`;
  });

  return html;
}

/* ========================================================
   状态管理（localStorage）
   ======================================================== */

const STORAGE_KEY = 'stardy-progress';

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

let progress = loadProgress();

// 记录卡片状态：unseen / studying / mastered
function setCardStatus(cardId, status) {
  progress[cardId] = status;
  saveProgress(progress);
}

function getCardStatus(cardId) {
  return progress[cardId] || 'unseen';
}

// 统计
function getStats() {
  const cards = Object.values(progress);
  return {
    studied: cards.filter(s => s !== 'unseen').length,
    mastered: cards.filter(s => s === 'mastered').length,
    streak: progress.__streak || 0,
  };
}

/* ========================================================
   状态
   ======================================================== */

let currentMode = 'browse';
let currentChapterFilter = 'all';
let studyQueue = [];
let studyIndex = 0;
let clozeMode = false;

let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;

/* ========================================================
   初始化
   ======================================================== */

function init() {
  // 总卡片数
  $('#total-count').textContent = CARDS.length;

  // 章节按钮
  renderChapterButtons();

  // 统计
  updateStats();

  // 模式切换
  $$('.sdy-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });

  // 浏览模式
  renderCardGrid();

  // 背诵模式
  initStudyMode();

  // 问答模式
  initQuizMode();

  // Modal
  initModal();

  // 主题切换（复用站点逻辑）
  initThemeToggle();

  // 导航汉堡
  initNavToggle();
}

/* ========================================================
   浏览模式
   ======================================================== */

function renderChapterButtons() {
  const container = $('#chapter-list');
  CHAPTERS.forEach(ch => {
    const count = (CARDS_BY_CHAPTER[ch.id] || []).length;
    if (count === 0) return;
    const btn = document.createElement('button');
    btn.className = 'sdy-ch-btn';
    btn.dataset.ch = ch.id;
    btn.innerHTML = `${ch.title} <span class="sdy-ch-btn__count">${count}</span>`;
    btn.addEventListener('click', () => {
      $$('.sdy-ch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentChapterFilter = ch.id;
      renderCardGrid();
    });
    container.appendChild(btn);
  });

  // "全部" 按钮
  const allBtn = container.querySelector('[data-ch="all"]');
  allBtn.addEventListener('click', () => {
    $$('.sdy-ch-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    currentChapterFilter = 'all';
    renderCardGrid();
  });
}

function renderCardGrid() {
  const grid = $('#cards-grid');
  grid.innerHTML = '';

  const cards = currentChapterFilter === 'all'
    ? CARDS
    : CARDS.filter(c => c.chapter === currentChapterFilter);

  cards.forEach((card, i) => {
    const ch = CHAPTER_MAP[card.chapter];
    const status = getCardStatus(card.id);

    const el = document.createElement('div');
    el.className = 'sdy-card sdy-anim-pending';
    el.style.setProperty('--card-color', ch.color);
    el.style.animationDelay = `${Math.min(i * 40, 600)}ms`;
    el.setAttribute('role', 'listitem');

    const statusClass = status === 'mastered' ? 'mastered'
      : status === 'studying' ? 'studied' : '';
    const statusText = status === 'mastered' ? '已掌握'
      : status === 'studying' ? '学习中' : '未学习';

    el.innerHTML = `
      <div class="sdy-card__header">
        <span class="sdy-card__chapter">${ch.icon} ${ch.title}</span>
        <span class="sdy-card__status ${statusClass}">
          <span class="dot"></span>
          ${statusText}
        </span>
      </div>
      <h3 class="sdy-card__title">${card.title}</h3>
      <div class="sdy-card__front">${card.front}</div>
      <div class="sdy-card__tags">
        ${(card.tags || []).map(t => `<span class="sdy-card__tag">${t}</span>`).join('')}
      </div>
    `;

    el.addEventListener('click', () => openModal(card, i));

    grid.appendChild(el);
  });

  // IntersectionObserver 入场动画
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.remove('sdy-anim-pending');
        entry.target.classList.add('sdy-anim-in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05 });

  $$('.sdy-card', grid).forEach(card => observer.observe(card));
}

/* ========================================================
   背诵模式
   ======================================================== */

function initStudyMode() {
  // 填充章节下拉
  const sel = $('#study-chapter-sel');
  CHAPTERS.forEach(ch => {
    if (!CARDS_BY_CHAPTER[ch.id]) return;
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = ch.title;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', () => startStudySession());
  $('#btn-shuffle').addEventListener('click', () => startStudySession());

  // 闪卡点击翻转
  const fc = $('#flashcard');
  fc.addEventListener('click', flipCard);
  fc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  // 操作按钮
  $('#btn-correct').addEventListener('click', (e) => {
    e.stopPropagation();
    markCard('mastered');
  });
  $('#btn-wrong').addEventListener('click', (e) => {
    e.stopPropagation();
    markCard('studying');
  });
  $('#btn-skip').addEventListener('click', (e) => {
    e.stopPropagation();
    nextCard();
  });

  // 挖空开关
  $('#cloze-toggle').addEventListener('change', (e) => {
    clozeMode = e.target.checked;
    if (studyQueue.length > 0) renderFlashcard();
  });

  startStudySession();
}

function startStudySession() {
  const ch = $('#study-chapter-sel').value;
  studyQueue = ch === 'all'
    ? [...CARDS].sort(() => Math.random() - 0.5)
    : [...(CARDS_BY_CHAPTER[ch] || [])].sort(() => Math.random() - 0.5);

  studyIndex = 0;
  $('#prog-total').textContent = studyQueue.length;
  renderFlashcard();
}

function renderFlashcard() {
  if (studyQueue.length === 0) return;

  const card = studyQueue[studyIndex];
  const ch = CHAPTER_MAP[card.chapter];

  // 重置翻转
  $('#flashcard').classList.remove('flipped');

  // 章节标签
  $('#fc-chapter').textContent = `${ch.icon} ${ch.title}`;
  $('#fc-chapter-b').textContent = `${ch.icon} ${ch.title}`;

  // 正面
  $('#fc-front').innerHTML = `<p>${card.front}</p>`;

  // 背面
  let backHtml = renderMarkdown(card.back);
  if (clozeMode) {
    backHtml = renderCloze(backHtml);
  }
  $('#fc-title').textContent = card.title;
  $('#fc-back').innerHTML = backHtml;

  // 绑定挖空点击
  if (clozeMode) {
    $$('.sdy-blank', $('#fc-back')).forEach(blank => {
      blank.addEventListener('click', (e) => {
        e.stopPropagation();
        if (blank.classList.contains('revealed')) return;
        blank.textContent = blank.dataset.text;
        blank.classList.add('revealed');
      });
    });
  }

  // 进度
  $('#prog-cur').textContent = studyIndex + 1;
  $('#progress-bar').style.width = `${(studyIndex + 1) / studyQueue.length * 100}%`;

  // 按钮状态
  const flipped = $('#flashcard').classList.contains('flipped');
  $('#btn-correct').disabled = !flipped;
  $('#btn-wrong').disabled = !flipped;
  $('#btn-skip').disabled = studyQueue.length === 0;

  // KaTeX 重新渲染
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement($('#fc-back'), {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
    });
  }
}

function flipCard() {
  const fc = $('#flashcard');
  fc.classList.toggle('flipped');
  const flipped = fc.classList.contains('flipped');
  $('#btn-correct').disabled = !flipped;
  $('#btn-wrong').disabled = !flipped;
}

function markCard(status) {
  const card = studyQueue[studyIndex];
  setCardStatus(card.id, status);
  updateStats();
  nextCard();
}

function nextCard() {
  studyIndex++;
  if (studyIndex >= studyQueue.length) {
    // 完成所有卡片
    showStudyComplete();
    return;
  }
  renderFlashcard();
}

function showStudyComplete() {
  $('#flashcard-inner').innerHTML = `
    <div class="sdy-flashcard__face sdy-flashcard__front" style="gap: 24px;">
      <div style="font-size: 48px;">✓</div>
      <h2 style="font-family: var(--font-serif); font-size: 28px; color: var(--text-1); margin: 0;">
        本轮完成
      </h2>
      <p style="font-size: var(--fs-sm); color: var(--text-3);">
        你复习了 ${studyQueue.length} 张卡片
      </p>
      <button class="sdy-btn sdy-btn--primary" onclick="location.reload()">
        再来一轮
      </button>
    </div>
  `;
  $('#btn-correct').disabled = true;
  $('#btn-wrong').disabled = true;
  $('#btn-skip').disabled = true;
}

/* ========================================================
   问答模式
   ======================================================== */

function initQuizMode() {
  $('#btn-start-quiz').addEventListener('click', startQuiz);
  $('#btn-new-quiz').addEventListener('click', startQuiz);
  $('#btn-next-q').addEventListener('click', nextQuestion);
}

function startQuiz() {
  $('#btn-start-quiz').style.display = 'none';
  $('#quiz-feedback').classList.add('hidden');

  // 生成题目：从随机卡片中出题，4 选项
  quizQuestions = generateQuizQuestions(10);
  quizIndex = 0;
  quizScore = 0;

  $('#quiz-total').textContent = quizQuestions.length;
  $('#quiz-score').textContent = '0';

  renderQuestion();
}

function generateQuizQuestions(count) {
  const shuffled = [...CARDS].sort(() => Math.random() - 0.5);
  const questions = [];

  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    const correct = shuffled[i];
    // 随机取3个错误选项
    const wrongPool = CARDS.filter(c => c.id !== correct.id);
    const wrong = wrongPool.sort(() => Math.random() - 0.5).slice(0, 3);

    // 题目类型：正面问，选正确答案（标题+背面摘要）
    // 或者：背面问，选正确标题
    const type = Math.random() > 0.5 ? 'front-to-back' : 'back-to-front';

    if (type === 'front-to-back') {
      // 题干 = front，答案 = title，选项 = 4个 title
      const options = [...wrong, correct].sort(() => Math.random() - 0.5)
        .map(c => c.title);
      questions.push({
        question: correct.front,
        options,
        answer: correct.title,
        explanation: correct.back,
        chapter: correct.chapter,
      });
    } else {
      // 题干 = "下列哪个是 [title] 的定义？"，答案 = front
      const options = [...wrong, correct].sort(() => Math.random() - 0.5)
        .map(c => c.front);
      questions.push({
        question: `「${correct.title}」的要点是什么？`,
        options,
        answer: correct.front,
        explanation: correct.back,
        chapter: correct.chapter,
      });
    }
  }

  return questions;
}

function renderQuestion() {
  if (quizIndex >= quizQuestions.length) {
    showQuizComplete();
    return;
  }

  const q = quizQuestions[quizIndex];
  quizAnswered = false;

  $('#quiz-num').textContent = quizIndex + 1;
  $('#quiz-feedback').classList.add('hidden');

  const ch = CHAPTER_MAP[q.chapter];
  $('#quiz-question').innerHTML = `
    <span style="font-size: var(--fs-xs); color: var(--accent); font-weight: 600; letter-spacing: 0.04em;">
      ${ch.icon} ${ch.title}
    </span>
    <p style="margin: 12px 0 0; font-family: var(--font-serif); font-size: 22px; line-height: 1.5;">
      ${q.question}
    </p>
  `;

  const optionsEl = $('#quiz-options');
  optionsEl.innerHTML = '';

  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'sdy-quiz-option';
    btn.innerHTML = `
      <span class="sdy-quiz-option__letter">${String.fromCharCode(65 + i)}</span>
      <span>${opt}</span>
    `;
    btn.addEventListener('click', () => selectOption(btn, opt, q));
    optionsEl.appendChild(btn);
  });

  // KaTeX
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement($('#quiz-card'), {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
    });
  }
}

function selectOption(btn, selected, q) {
  if (quizAnswered) return;
  quizAnswered = true;

  const isCorrect = selected === q.answer;

  $$('.sdy-quiz-option').forEach(b => {
    b.classList.add('disabled');
    if (b.querySelector('span:last-child').textContent === q.answer) {
      b.classList.add('correct');
    } else if (b === btn && !isCorrect) {
      b.classList.add('wrong');
    }
  });

  if (isCorrect) {
    quizScore++;
    $('#quiz-score').textContent = quizScore;
  }

  // 显示反馈
  const fb = $('#quiz-feedback');
  fb.classList.remove('hidden');
  $('#quiz-feedback-inner').innerHTML = `
    <p style="font-size: 18px; font-weight: 600; color: ${isCorrect ? 'var(--ok)' : 'var(--err)'};">
      ${isCorrect ? '✓ 正确' : '✗ 正确答案：' + q.answer}
    </p>
    <div class="sdy-md" style="text-align: left; max-width: 520px; margin-top: 8px;">
      ${renderMarkdown(q.explanation)}
    </div>
  `;
}

function nextQuestion() {
  quizIndex++;
  renderQuestion();
}

function showQuizComplete() {
  const total = quizQuestions.length;
  const pct = Math.round(quizScore / total * 100);

  $('#quiz-card').innerHTML = `
    <div style="text-align: center; padding: 40px 0;">
      <div style="font-size: 56px;">${pct >= 80 ? '🏆' : pct >= 60 ? '👍' : '💪'}</div>
      <h2 style="font-family: var(--font-serif); font-size: 32px; color: var(--text-1); margin: 16px 0 8px;">
        ${quizScore} / ${total}
      </h2>
      <p style="font-size: var(--fs-sm); color: var(--text-3); margin-bottom: 24px;">
        正确率 ${pct}%
      </p>
      <button class="sdy-btn sdy-btn--primary" onclick="location.reload()">
        再来一轮
      </button>
    </div>
  `;
  $('#btn-next-q').style.display = 'none';
}

/* ========================================================
   Modal（卡片详情）
   ======================================================== */

let modalCardIndex = 0;
let modalCardList = [];

function initModal() {
  $('#modal-close').addEventListener('click', closeModal);
  $('.sdy-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  $('#modal-prev').addEventListener('click', () => {
    modalCardIndex = (modalCardIndex - 1 + modalCardList.length) % modalCardList.length;
    renderModalCard();
  });
  $('#modal-next').addEventListener('click', () => {
    modalCardIndex = (modalCardIndex + 1) % modalCardList.length;
    renderModalCard();
  });
  $('#modal-study-this').addEventListener('click', () => {
    const card = modalCardList[modalCardIndex];
    closeModal();
    $('#study-chapter-sel').value = card.chapter;
    startStudySession();
    switchMode('study');
    // 跳到当前卡
    studyIndex = studyQueue.findIndex(c => c.id === card.id);
    if (studyIndex < 0) studyIndex = 0;
    renderFlashcard();
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('.sdy-modal-overlay').classList.contains('hidden')) {
      closeModal();
    }
  });
}

function openModal(card, index) {
  modalCardList = currentChapterFilter === 'all'
    ? CARDS
    : CARDS.filter(c => c.chapter === currentChapterFilter);
  modalCardIndex = modalCardList.findIndex(c => c.id === card.id);
  renderModalCard();
  $('.sdy-modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderModalCard() {
  const card = modalCardList[modalCardIndex];
  const ch = CHAPTER_MAP[card.chapter];

  $('#modal-chapter').textContent = `${ch.icon} ${ch.title}`;
  $('#modal-title').textContent = card.title;
  $('#modal-front').innerHTML = `<p>${card.front}</p>`;
  $('#modal-back').innerHTML = renderMarkdown(card.back);

  // KaTeX
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement($('#modal-back'), {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
    });
  }
}

function closeModal() {
  $('.sdy-modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ========================================================
   模式切换
   ======================================================== */

function switchMode(mode) {
  currentMode = mode;
  $$('.sdy-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  $$('.sdy-view').forEach(v => v.classList.add('hidden'));
  $(`#view-${mode}`).classList.remove('hidden');
}

/* ========================================================
   统计
   ======================================================== */

function updateStats() {
  const stats = getStats();
  $('#stat-studied').textContent = stats.studied;
  $('#stat-mastered').textContent = stats.mastered;
  $('#stat-streak').textContent = stats.streak || 1;
}

/* ========================================================
   主题切换 & 导航（复用站点逻辑）
   ======================================================== */

function initThemeToggle() {
  const toggle = $('#theme-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('site-theme', next); } catch {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'light' ? '#faf8f5' : '#0a0a0b';
  });
}

function initNavToggle() {
  const toggle = $('#nav-toggle');
  const links = $('#nav-links');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
}

/* ========================================================
   启动
   ======================================================== */

// 等待 DOM 就绪
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
