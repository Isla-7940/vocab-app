// 调用 AI 接口代理。前端不保存 DeepSeek 密钥，只发送单词和答题统计。
import { AI_ENDPOINT } from './config.js';

const ACCESS_CODE_KEY = 'vocab:access-code';

export const AI_ENABLED = Boolean(AI_ENDPOINT);

export class AiError extends Error {}

function readAccessCode() {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) || '';
  } catch {
    return '';
  }
}

function writeAccessCode(code) {
  try {
    localStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    // 忽略
  }
}

async function post(path, body, askCode = true) {
  let res;
  try {
    res = await fetch(AI_ENDPOINT + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': readAccessCode() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiError('无法连接 AI 服务，请检查网络后重试');
  }

  // 接口代理启用了访问口令时，提示输入一次并保存在本机
  if (res.status === 401 && askCode) {
    const code = window.prompt('请输入访问口令');
    if (code) {
      writeAccessCode(code.trim());
      return post(path, body, false);
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiError(data.error || `AI 服务暂不可用（${res.status}）`);
  return data;
}

export const analyze = (summary) => post('/api/analyze', summary);
export const generateExamples = (words) => post('/api/examples', { words });
