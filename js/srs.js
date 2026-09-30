// 复习与难度规则，参数见 DESIGN.md 第 5 节
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// 各复习阶段的间隔：10 分钟、1、3、7、15、30 天
const INTERVALS = [10 * MINUTE, DAY, 3 * DAY, 7 * DAY, 15 * DAY, 30 * DAY];
const MAX_BOX = INTERVALS.length - 1;
const WRONG_BOOK_EXIT_BOX = 3;

const RECENT_SIZE = 20;
const LEVEL_UP_ACCURACY = 0.85;
const LEVEL_DOWN_ACCURACY = 0.6;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;
export const SESSION_SIZE = 10;

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 记录一次答题结果；返回难度变化：1 升级，-1 降级，0 不变
export function recordAnswer(progress, word, correct, now = Date.now()) {
  const isNew = !progress.words[word];
  const rec = progress.words[word] || { box: 0, next: 0, right: 0, wrong: 0 };

  if (correct) {
    rec.right += 1;
    if (!isNew && rec.box === MAX_BOX) rec.mastered = true;
    rec.box = isNew ? 1 : Math.min(rec.box + 1, MAX_BOX);
    if (rec.box >= WRONG_BOOK_EXIT_BOX) {
      progress.wrongBook = progress.wrongBook.filter((w) => w !== word);
    }
  } else {
    rec.wrong += 1;
    rec.box = 0;
    rec.mastered = false;
    if (!progress.wrongBook.includes(word)) progress.wrongBook.push(word);
  }
  rec.next = now + INTERVALS[rec.box];
  progress.words[word] = rec;

  return adjustLevel(progress, correct);
}

function adjustLevel(progress, correct) {
  progress.recent.push(correct ? 1 : 0);
  if (progress.recent.length > RECENT_SIZE) progress.recent.shift();
  if (progress.recent.length < RECENT_SIZE) return 0;

  const accuracy = progress.recent.reduce((a, b) => a + b, 0) / RECENT_SIZE;
  let change = 0;
  if (accuracy >= LEVEL_UP_ACCURACY && progress.level < MAX_LEVEL) change = 1;
  else if (accuracy < LEVEL_DOWN_ACCURACY && progress.level > MIN_LEVEL) change = -1;

  if (change) {
    progress.level += change;
    progress.recent = [];
  }
  return change;
}

// 组一组练习：先安排到期复习词，其余为当前难度的新词
export function buildSession(progress, words, now = Date.now()) {
  const due = words
    .filter((w) => {
      const rec = progress.words[w.w];
      return rec && !rec.mastered && rec.next <= now;
    })
    .sort((a, b) => progress.words[a.w].next - progress.words[b.w].next);

  const picked = due.slice(0, SESSION_SIZE);
  for (const level of levelsFrom(progress.level)) {
    if (picked.length >= SESSION_SIZE) break;
    const fresh = words.filter((w) => w.lv === level && !progress.words[w.w]);
    picked.push(...shuffle(fresh).slice(0, SESSION_SIZE - picked.length));
  }
  return shuffle(picked);
}

// 当前难度的新词用完后，先取更高难度，再取更低难度
function levelsFrom(level) {
  const order = [];
  for (let l = level; l <= MAX_LEVEL; l++) order.push(l);
  for (let l = level - 1; l >= MIN_LEVEL; l--) order.push(l);
  return order;
}

export function stats(progress, now = Date.now()) {
  let learned = 0;
  let mastered = 0;
  let due = 0;
  let answered = 0;
  let right = 0;
  for (const rec of Object.values(progress.words)) {
    learned += 1;
    answered += rec.right + rec.wrong;
    right += rec.right;
    if (rec.mastered) mastered += 1;
    else if (rec.next <= now) due += 1;
  }
  const accuracy = answered ? right / answered : 0;
  return { learned, mastered, due, wrong: progress.wrongBook.length, answered, accuracy };
}
