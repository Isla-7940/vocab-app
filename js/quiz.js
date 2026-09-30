// 出题：选择题选项生成与水平测试
import { MIN_LEVEL, MAX_LEVEL, shuffle } from './srs.js';

const TEST_PER_LEVEL = 6;
const TEST_PASS_ACCURACY = 0.7;
const DISTRACTORS = 3;

const posOf = (word) => (word.t.match(/^([a-z]+)\./) || [])[1] || '';

// mode：'en2zh' 看词选义；'zh2en' 看义选词
export function makeQuestion(word, words, mode) {
  const key = mode === 'en2zh' ? 't' : 'w';
  const pos = posOf(word);
  const seen = new Set([word.w, word.t]);
  const distractors = [];

  // 干扰项优先选同难度、同词性的单词，降低凭词性猜题的可能
  const tiers = [
    (w) => w.lv === word.lv && posOf(w) === pos,
    (w) => posOf(w) === pos,
    (w) => w.lv === word.lv,
    () => true,
  ];
  for (const match of tiers) {
    for (const w of shuffle(words.filter(match))) {
      if (distractors.length === DISTRACTORS) break;
      if (seen.has(w.w) || seen.has(w.t) || seen.has(w[key])) continue;
      seen.add(w.w);
      seen.add(w.t);
      distractors.push(w);
    }
    if (distractors.length === DISTRACTORS) break;
  }

  const options = shuffle([word, ...distractors]);
  return { word, mode, options, answer: options.indexOf(word) };
}

// 每个难度等级各抽若干词，由易到难排列
export function buildPlacementTest(words) {
  const items = [];
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    items.push(...shuffle(words.filter((w) => w.lv === level)).slice(0, TEST_PER_LEVEL));
  }
  return items;
}

// 起始难度：正确率低于 70% 的最低等级；全部达标则为最高等级
export function placementResult(results, words) {
  const levels = [];
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    const answered = results.filter((r) => r.lv === level);
    const accuracy = answered.length ? answered.filter((r) => r.correct).length / answered.length : 0;
    const total = words.filter((w) => w.lv === level).length;
    levels.push({ level, accuracy, total });
  }
  const weakest = levels.find((l) => l.accuracy < TEST_PASS_ACCURACY);
  const estimate = Math.round(levels.reduce((sum, l) => sum + l.accuracy * l.total, 0));
  return { level: weakest ? weakest.level : MAX_LEVEL, estimate, total: words.length, levels };
}
