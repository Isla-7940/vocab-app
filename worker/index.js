// AI 接口代理（Cloudflare Worker）：保存 DeepSeek 密钥、校验请求、限流，并将模型输出整理为固定格式。
// 配置见 wrangler.toml；密钥 API_KEY 通过 `npx wrangler secret put API_KEY` 设置，不写入代码。

const MAX_BODY_LENGTH = 4096;
const WORD_RE = /^[a-z][a-z-]{0,39}$/;

const ANALYZE_PROMPT = `你是英语词汇学习顾问。用户会以 json 提供背单词统计：词库名称、当前难度等级（1–5）、累计答题数、正确率、答错较多的单词。
请分析学习情况，只输出 json，格式如下：
{"summary": "一句话总结当前学习情况", "weaknesses": ["薄弱点"], "suggestions": ["具体可执行的学习建议"], "focusWords": ["需要优先复习的单词"]}
要求：使用简体中文；weaknesses 与 suggestions 各 2–4 条，每条不超过 40 字；focusWords 从用户提供的错词中选出不超过 5 个，没有错词时返回空数组。`;

const EXAMPLES_PROMPT = `你是英语老师。用户会以 json 提供一组英文单词。请为每个单词写一个贴近工作或日常生活的英文例句（不超过 20 个英文单词），附简体中文翻译和一句简短的记忆提示（不超过 30 字）。
只输出 json，格式如下：
{"items": [{"word": "单词", "sentence": "英文例句", "translation": "中文翻译", "tip": "记忆提示"}]}`;

class BadRequest extends Error {}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const textList = (value, maxItems, maxLength) =>
  Array.isArray(value) ? value.map((v) => text(v, maxLength)).filter(Boolean).slice(0, maxItems) : [];

function wordList(value, max) {
  if (!Array.isArray(value) || value.length > max) throw new BadRequest('words');
  const words = value.map((w) => String(w).toLowerCase());
  if (!words.every((w) => WORD_RE.test(w))) throw new BadRequest('words');
  return [...new Set(words)];
}

const ROUTES = {
  '/api/analyze': {
    prompt: ANALYZE_PROMPT,
    maxTokens: 800,
    validate(body) {
      const { level, answered, accuracy } = body;
      if (!Number.isInteger(level) || level < 1 || level > 5) throw new BadRequest('level');
      if (!Number.isInteger(answered) || answered < 0 || answered > 1e6) throw new BadRequest('answered');
      if (typeof accuracy !== 'number' || accuracy < 0 || accuracy > 1) throw new BadRequest('accuracy');
      return { library: text(body.library, 40), level, answered, accuracy, wrongWords: wordList(body.wrongWords, 30) };
    },
    clean(output) {
      return {
        summary: text(output.summary, 200),
        weaknesses: textList(output.weaknesses, 4, 120),
        suggestions: textList(output.suggestions, 4, 120),
        focusWords: textList(output.focusWords, 5, 40).map((w) => w.toLowerCase()),
      };
    },
  },
  '/api/examples': {
    prompt: EXAMPLES_PROMPT,
    maxTokens: 1500,
    validate(body) {
      const words = wordList(body.words, 10);
      if (!words.length) throw new BadRequest('words');
      return { words };
    },
    clean(output, input) {
      const requested = new Set(input.words);
      const items = Array.isArray(output.items) ? output.items : [];
      return {
        items: items
          .map((item) => ({
            word: text(item?.word, 40).toLowerCase(),
            sentence: text(item?.sentence, 300),
            translation: text(item?.translation, 200),
            tip: text(item?.tip, 120),
          }))
          .filter((item) => requested.has(item.word) && item.sentence),
      };
    },
  },
};

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function callModel(env, route, input) {
  const res = await fetch(`${env.API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.API_KEY}` },
    body: JSON.stringify({
      model: env.MODEL,
      messages: [
        { role: 'system', content: route.prompt },
        { role: 'user', content: JSON.stringify(input) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: route.maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  // JSON 模式偶尔返回空内容，由调用方重试
  return JSON.parse(data.choices?.[0]?.message?.content || '');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin'), env);
    if (!cors) return json({ error: '来源不被允许' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const route = ROUTES[new URL(request.url).pathname];
    if (!route || request.method !== 'POST') return json({ error: '接口不存在' }, 404, cors);
    if (!env.API_KEY) return json({ error: 'AI 服务未配置' }, 500, cors);
    if (env.ACCESS_CODE && request.headers.get('X-Access-Code') !== env.ACCESS_CODE) {
      return json({ error: '访问口令错误' }, 401, cors);
    }
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return json({ error: '请求过于频繁，请稍后再试' }, 429, cors);
    }

    let input;
    try {
      const body = await request.text();
      if (body.length > MAX_BODY_LENGTH) throw new BadRequest('size');
      input = route.validate(JSON.parse(body));
    } catch {
      return json({ error: '请求内容无效' }, 400, cors);
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return json(route.clean(await callModel(env, route, input), input), 200, cors);
      } catch (err) {
        console.error(`attempt ${attempt}:`, err.message);
      }
    }
    return json({ error: 'AI 服务暂不可用，请稍后再试' }, 502, cors);
  },
};
