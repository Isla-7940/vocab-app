// 本地存储：学习记录按词库分别保存，数据结构见 DESIGN.md 4.2
const PREFIX = 'vocab:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 存储不可用（如隐私模式）时，记录仅在本次打开期间有效
  }
}

function emptyProgress() {
  return { tested: false, level: 1, recent: [], words: {}, wrongBook: [], aiCache: {}, aiReport: null };
}

export function loadProgress(libId) {
  return { ...emptyProgress(), ...read(libId, {}) };
}

export function saveProgress(libId, progress) {
  write(libId, progress);
}

export function clearProgress(libId) {
  try {
    localStorage.removeItem(PREFIX + libId);
  } catch {
    // 忽略
  }
}

export function loadSettings() {
  return { lib: null, autoSpeak: true, ...read('settings', {}) };
}

export function saveSettings(settings) {
  write('settings', settings);
}
