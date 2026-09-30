// AI 接口代理地址（worker/）。留空则隐藏 AI 功能。
// 本地调试 Worker（npx wrangler dev）时，在页面地址后加 ?api=local
const useLocalWorker = new URLSearchParams(location.search).get('api') === 'local';

export const AI_ENDPOINT = useLocalWorker ? 'http://localhost:8787' : 'https://vocab-api.t-i.cc';
