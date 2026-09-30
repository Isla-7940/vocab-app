// 页面与流程控制
import { loadProgress, saveProgress, clearProgress, loadSettings, saveSettings } from './storage.js';
import { recordAnswer, buildSession, stats, MAX_LEVEL, SESSION_SIZE } from './srs.js';
import { makeQuestion, buildPlacementTest, placementResult } from './quiz.js';
import { AI_ENABLED, AiError, analyze, generateExamples } from './ai.js';

const REPORT_MIN_ANSWERS = 20;   // 生成学习报告所需的最少答题数
const REPORT_WRONG_WORDS = 30;   // 发送给 AI 的错词上限
const EXAMPLES_BATCH = 10;       // 每次生成例句的单词数上限

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const state = {
  libs: [],            // 词库列表，来自 data/index.json
  libId: null,
  words: [],
  wordMap: new Map(),
  progress: null,
  settings: loadSettings(),
  quiz: null,          // 进行中的测试或练习
};
const wordCache = {};

const ICON_SPEAKER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// ---------- 数据 ----------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function init() {
  try {
    state.libs = (await fetchJson('data/index.json')).libraries;
    const saved = state.libs.find((l) => l.id === state.settings.lib);
    await selectLibrary((saved || state.libs[0]).id);
  } catch (err) {
    console.error(err);
    renderError('词库加载失败，请刷新页面重试。');
  }
}

async function selectLibrary(id) {
  wordCache[id] ??= (await fetchJson(`data/${id}.json`)).words;
  state.libId = id;
  state.words = wordCache[id];
  state.wordMap = new Map(state.words.map((w) => [w.w, w]));
  state.progress = loadProgress(id);
  state.settings.lib = id;
  saveSettings(state.settings);
  renderHome();
}

const currentLib = () => state.libs.find((l) => l.id === state.libId);

// ---------- 工具 ----------

function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

const speakButton = (word) =>
  `<button class="icon-btn" data-action="speak" data-word="${esc(word)}" aria-label="朗读 ${esc(word)}">${ICON_SPEAKER}</button>`;

const wordTitle = (w) =>
  `<p class="detail-word">${esc(w.w)} ${w.p ? `<span class="phonetic">/${esc(w.p)}/</span>` : ''}</p>`;

const levelTrack = (level) =>
  `<div class="level-track" aria-hidden="true">${Array.from({ length: MAX_LEVEL }, (_, i) => `<span class="${i < level ? 'on' : ''}"></span>`).join('')}</div>`;

const subHeader = (title) => `
  <header class="bar">
    <button class="link" data-action="home">返回</button>
    <span class="muted">${title}</span>
    <span class="bar-spacer"></span>
  </header>`;

const exampleBlock = (ex) => `
  <div class="example">
    <p lang="en">${esc(ex.sentence)}</p>
    <p>${esc(ex.translation)}</p>
    ${ex.tip ? `<p class="tip">记忆提示：${esc(ex.tip)}</p>` : ''}
  </div>`;

// 按答错次数从多到少排列的错词
function sortedWrongBook() {
  const p = state.progress;
  return p.wrongBook
    .filter((w) => state.wordMap.has(w))
    .sort((a, b) => (p.words[b]?.wrong ?? 0) - (p.words[a]?.wrong ?? 0));
}

// ---------- 首页 ----------

function renderHome() {
  state.quiz = null;
  app.innerHTML = `
    <header class="bar">
      <h1>AI 背单词</h1>
      <select data-change="library" aria-label="选择词库">
        ${state.libs.map((l) => `<option value="${l.id}"${l.id === state.libId ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}
      </select>
    </header>
    ${state.progress.tested ? homeProgress() : homeIntro()}
    <footer class="foot">
      <p>学习记录仅保存在本机浏览器</p>
      <p>
        <button class="link" data-action="toggle-speak">自动发音：${state.settings.autoSpeak ? '开' : '关'}</button>
        ·
        <button class="link" data-action="reset">重置进度</button>
      </p>
      <p>作者：iteaisla</p>
    </footer>`;
}

function homeIntro() {
  const lib = currentLib();
  return `
    <section class="card">
      <h2>先做一次水平测试</h2>
      <p>从「${esc(lib.name)}」${lib.count} 个单词中抽取 30 题，约 2–3 分钟，用于确定起始难度。</p>
      <button class="btn" data-action="start-test">开始测试</button>
      <button class="btn plain" data-action="skip-test">跳过，从 1 级开始</button>
    </section>`;
}

function homeProgress() {
  const p = state.progress;
  const s = stats(p);
  return `
    <section class="card">
      <div class="level-head">
        <span class="muted">当前难度</span>
        <span class="level"><strong>${p.level}</strong> / ${MAX_LEVEL} 级</span>
      </div>
      ${levelTrack(p.level)}
      <div class="stats">
        <div><b>${s.learned}</b><span>已学</span></div>
        <div><b>${s.mastered}</b><span>已掌握</span></div>
        <div><b>${s.due}</b><span>待复习</span></div>
        <div><b>${s.wrong}</b><span>错词</span></div>
      </div>
    </section>
    <button class="btn" data-action="start-practice">开始练习（${SESSION_SIZE} 题）</button>
    ${s.due ? `<p class="muted center">将优先安排 ${Math.min(s.due, SESSION_SIZE)} 个待复习单词</p>` : ''}
    <div class="btn-row">
      <button class="btn secondary" data-action="wrong-book">错词本</button>
      <button class="btn secondary" data-action="start-test">重新测试</button>
    </div>
    ${AI_ENABLED ? '<button class="btn ai" data-action="report">AI 学习报告</button>' : ''}`;
}

// ---------- 测试与练习 ----------

function startQuiz(kind) {
  const items = kind === 'test' ? buildPlacementTest(state.words) : buildSession(state.progress, state.words);
  if (!items.length) {
    toast('暂无需要练习的单词');
    return;
  }
  state.quiz = { kind, items, index: 0, results: [], current: null, answered: false };
  showQuestion();
}

function showQuestion() {
  const q = state.quiz;
  if (q.index >= q.items.length) {
    finishQuiz();
    return;
  }
  const word = q.items[q.index];
  // 已学过的词随机改为看义选词，新词和测试一律看词选义
  const reviewing = q.kind === 'practice' && state.progress.words[word.w];
  const mode = reviewing && Math.random() < 0.5 ? 'zh2en' : 'en2zh';
  q.current = makeQuestion(word, state.words, mode);
  q.answered = false;
  renderQuestion();
  if (mode === 'en2zh' && state.settings.autoSpeak) speak(word.w);
}

function renderQuestion() {
  const q = state.quiz;
  const { word, mode, options } = q.current;
  const prompt = mode === 'en2zh'
    ? `<p class="word">${esc(word.w)}</p>
       ${word.p ? `<p class="phonetic">/${esc(word.p)}/</p>` : ''}
       ${speakButton(word.w)}`
    : `<p class="muted">选择对应的英文单词</p>
       <p class="meaning">${esc(word.t)}</p>`;

  app.innerHTML = `
    <header class="bar">
      <button class="link" data-action="home">退出</button>
      <span class="muted">${q.kind === 'test' ? '水平测试' : '练习'} · ${q.index + 1} / ${q.items.length}</span>
      <span class="bar-spacer"></span>
    </header>
    <div class="progress"><span style="width:${(q.index / q.items.length) * 100}%"></span></div>
    <section class="prompt">${prompt}</section>
    <div class="options">
      ${options.map((o, i) => `
        <button class="option" data-action="answer" data-index="${i}">
          <span class="key">${i + 1}</span><span>${esc(mode === 'en2zh' ? o.t : o.w)}</span>
        </button>`).join('')}
      <button class="option ghost" data-action="answer" data-index="-1">不认识</button>
    </div>
    <div id="feedback" aria-live="polite"></div>`;
}

function answer(choice) {
  const q = state.quiz;
  if (!q || q.answered) return;
  q.answered = true;

  const { word, mode, answer: right } = q.current;
  const correct = choice === right;
  q.results.push({ word: word.w, lv: word.lv, correct });

  const buttons = app.querySelectorAll('.option');
  buttons.forEach((b) => { b.disabled = true; });

  if (q.kind === 'test') {
    // 测试不公布答案，直接进入下一题
    buttons[choice < 0 ? buttons.length - 1 : choice].classList.add('chosen');
    setTimeout(nextQuestion, 350);
    return;
  }

  const change = recordAnswer(state.progress, word.w, correct);
  saveProgress(state.libId, state.progress);
  if (change > 0) toast(`近期正确率较高，难度提升至 ${state.progress.level} 级`);
  if (change < 0) toast(`难度调整至 ${state.progress.level} 级`);

  buttons[right].classList.add('correct');
  if (!correct && choice >= 0) buttons[choice].classList.add('wrong');

  const last = q.index === q.items.length - 1;
  const feedback = document.getElementById('feedback');
  feedback.innerHTML = `
    <section class="card">
      <p class="verdict ${correct ? 'ok' : 'bad'}">${correct ? '回答正确' : '回答错误'}</p>
      <div class="detail">
        <div>${wordTitle(word)}<p>${esc(word.t)}</p></div>
        ${speakButton(word.w)}
      </div>
      ${correct ? '' : feedbackExample(word)}
      <button class="btn" data-action="next">${last ? '查看结果' : '下一题'}</button>
    </section>`;
  feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (mode === 'zh2en' && state.settings.autoSpeak) speak(word.w);
}

// 答错时提供 AI 例句：已生成过的直接显示
function feedbackExample(word) {
  if (!AI_ENABLED) return '';
  const cached = state.progress.aiCache[word.w];
  return cached
    ? exampleBlock(cached)
    : `<button class="link ai-link" data-action="word-example" data-word="${esc(word.w)}">查看 AI 例句</button>`;
}

function nextQuestion() {
  if (!state.quiz) return;
  state.quiz.index += 1;
  showQuestion();
}

function finishQuiz() {
  const q = state.quiz;
  state.quiz = null;
  if (q.kind === 'test') {
    const result = placementResult(q.results, state.words);
    Object.assign(state.progress, { tested: true, level: result.level, recent: [] });
    saveProgress(state.libId, state.progress);
    renderTestResult(result);
  } else {
    renderSessionResult(q.results);
  }
}

// ---------- 结果与错词本 ----------

function renderTestResult(r) {
  app.innerHTML = `
    <header class="bar"><h1>测试结果</h1></header>
    <section class="card">
      <div class="level-head">
        <span class="muted">起始难度</span>
        <span class="level"><strong>${r.level}</strong> / ${MAX_LEVEL} 级</span>
      </div>
      ${levelTrack(r.level)}
      <p>估算已掌握本词库约 <b>${r.estimate}</b> 词（共 ${r.total} 词）</p>
    </section>
    <section class="card">
      <h2>各难度正确率</h2>
      ${r.levels.map((l) => {
        const pct = Math.round(l.accuracy * 100);
        return `<div class="bar-row"><span>${l.level} 级</span><div class="meter"><span style="width:${pct}%"></span></div><span>${pct}%</span></div>`;
      }).join('')}
      <p class="muted">起始难度为正确率低于 70% 的最低等级。</p>
    </section>
    <button class="btn" data-action="start-practice">开始练习</button>
    <button class="btn plain" data-action="home">返回首页</button>`;
}

function wordList(words, { count = false } = {}) {
  const p = state.progress;
  return `<ul class="words">${words.map((w) => `
    <li>
      <div>
        ${wordTitle(w)}<p class="muted">${esc(w.t)}</p>
        ${p.aiCache[w.w] ? exampleBlock(p.aiCache[w.w]) : ''}
      </div>
      ${count ? `<span class="count">错 ${p.words[w.w]?.wrong ?? 0} 次</span>` : ''}
      ${speakButton(w.w)}
    </li>`).join('')}</ul>`;
}

function renderSessionResult(results) {
  const right = results.filter((r) => r.correct).length;
  const wrong = results.filter((r) => !r.correct).map((r) => state.wordMap.get(r.word));
  app.innerHTML = `
    <header class="bar"><h1>本组完成</h1></header>
    <section class="card">
      <p class="big">${right} / ${results.length}</p>
      <p class="muted">答对题数 · 当前难度 ${state.progress.level} 级</p>
    </section>
    ${wrong.length ? `<section class="card"><h2>本组错词</h2>${wordList(wrong)}</section>` : ''}
    <button class="btn" data-action="start-practice">再练一组</button>
    <button class="btn plain" data-action="home">返回首页</button>`;
}

function renderWrongBook() {
  const words = sortedWrongBook().map((w) => state.wordMap.get(w));
  const pending = words.filter((w) => !state.progress.aiCache[w.w]).length;
  app.innerHTML = `
    ${subHeader(`错词本 · ${words.length}`)}
    ${words.length
      ? `${AI_ENABLED && pending ? `<button class="btn ai" data-action="examples">AI 生成例句（${Math.min(pending, EXAMPLES_BATCH)} 个）</button>` : ''}
         <section class="card">${wordList(words, { count: true })}</section>
         <p class="muted center">连续答对 3 次后，单词自动移出错词本</p>`
      : '<section class="card empty"><p>暂无错词</p></section>'}`;
}

// ---------- AI ----------

function renderReport() {
  const s = stats(state.progress);
  const report = state.progress.aiReport;
  const ready = s.answered >= REPORT_MIN_ANSWERS;
  const listCard = (title, items) => (items?.length
    ? `<section class="card"><h2>${title}</h2><ul class="bullets">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`
    : '');
  const focus = (report?.focusWords || []).map((w) => state.wordMap.get(w)).filter(Boolean);

  app.innerHTML = `
    ${subHeader('AI 学习报告')}
    ${report
      ? `<section class="card">
           <p class="muted">${new Date(report.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 生成</p>
           <p class="summary">${esc(report.summary)}</p>
         </section>
         ${listCard('薄弱点', report.weaknesses)}
         ${listCard('学习建议', report.suggestions)}
         ${focus.length ? `<section class="card"><h2>优先复习</h2>${wordList(focus)}</section>` : ''}`
      : `<section class="card"><p>${ready
          ? '根据答题记录分析薄弱点，并给出学习建议。'
          : `累计完成 ${REPORT_MIN_ANSWERS} 题后可生成报告，当前 ${s.answered} 题。`}</p></section>`}
    <button class="btn" data-action="generate-report"${ready ? '' : ' disabled'}>${report ? '重新生成' : '生成报告'}</button>
    <p class="muted center">由 DeepSeek 生成，仅供参考。发送内容仅包含单词和答题统计。</p>`;
}

async function generateReport(button) {
  const { libId, progress } = state;
  const s = stats(progress);
  const payload = {
    library: currentLib().name,
    level: progress.level,
    answered: s.answered,
    accuracy: Math.round(s.accuracy * 100) / 100,
    wrongWords: sortedWrongBook().slice(0, REPORT_WRONG_WORDS),
  };
  await withBusy(button, 'AI 分析中，请稍候…', async () => {
    progress.aiReport = { at: Date.now(), ...(await analyze(payload)) };
    saveProgress(libId, progress);
    if (state.libId === libId && button.isConnected) renderReport();
  });
}

async function requestExamples(words, button, onDone) {
  const { libId, progress } = state;
  await withBusy(button, 'AI 生成中…', async () => {
    const { items } = await generateExamples(words);
    for (const { word, sentence, translation, tip } of items) {
      progress.aiCache[word] = { sentence, translation, tip };
    }
    saveProgress(libId, progress);
    if (items.length < words.length) toast('部分单词未生成例句，可稍后重试');
    if (state.libId === libId && button.isConnected) onDone();
  });
}

// 请求期间禁用按钮；失败时提示并恢复按钮
async function withBusy(button, busyText, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    await task();
  } catch (err) {
    console.error(err);
    toast(err instanceof AiError ? err.message : 'AI 服务暂不可用，请稍后再试');
  }
  if (button.isConnected) {
    button.disabled = false;
    button.textContent = label;
  }
}

function renderError(message) {
  app.innerHTML = `
    <section class="card">
      <p>${esc(message)}</p>
      <button class="btn" data-action="reload">刷新</button>
    </section>`;
}

// ---------- 事件 ----------

const actions = {
  'start-test': () => startQuiz('test'),
  'skip-test': () => {
    Object.assign(state.progress, { tested: true, level: 1 });
    saveProgress(state.libId, state.progress);
    renderHome();
  },
  'start-practice': () => startQuiz('practice'),
  answer: (el) => answer(Number(el.dataset.index)),
  next: nextQuestion,
  home: renderHome,
  speak: (el) => speak(el.dataset.word),
  'wrong-book': renderWrongBook,
  report: renderReport,
  'generate-report': (el) => generateReport(el),
  examples: (el) => {
    const words = sortedWrongBook().filter((w) => !state.progress.aiCache[w]).slice(0, EXAMPLES_BATCH);
    requestExamples(words, el, renderWrongBook);
  },
  'word-example': (el) => {
    const word = el.dataset.word;
    requestExamples([word], el, () => {
      const ex = state.progress.aiCache[word];
      if (ex) el.outerHTML = exampleBlock(ex);
    });
  },
  'toggle-speak': () => {
    state.settings.autoSpeak = !state.settings.autoSpeak;
    saveSettings(state.settings);
    renderHome();
  },
  reset: () => {
    if (!confirm(`确定清空「${currentLib().name}」的学习记录？`)) return;
    clearProgress(state.libId);
    state.progress = loadProgress(state.libId);
    renderHome();
  },
  reload: () => location.reload(),
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) actions[el.dataset.action]?.(el);
});

app.addEventListener('change', async (e) => {
  if (e.target.dataset.change !== 'library') return;
  try {
    await selectLibrary(e.target.value);
  } catch (err) {
    console.error(err);
    renderError('词库加载失败，请刷新页面重试。');
  }
});

// 键盘：1–4 选择答案，0 为“不认识”，回车或空格进入下一题
document.addEventListener('keydown', (e) => {
  const q = state.quiz;
  if (!q || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!q.answered) {
    const n = Number(e.key);
    if (e.key === '0') answer(-1);
    else if (n >= 1 && n <= q.current.options.length) answer(n - 1);
  } else if (q.kind === 'practice' && (e.key === 'Enter' || e.key === ' ')) {
    if (e.target.closest('button, select')) return;  // 按钮获得焦点时由浏览器触发点击
    e.preventDefault();
    nextQuestion();
  }
});

init();
