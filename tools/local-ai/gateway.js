// 本機 AI 門口（2026/11/26）：讓網站的 AI 判讀先用這台電腦的模型（Ollama），省 Gemini 的錢；這台電腦沒開時網站自動改用 Gemini。
//
//   node tools/local-ai/gateway.js            啟動（開著這個視窗就能用；關掉就停）
//   node tools/local-ai/gateway.js --setup    第一次：產生門口密碼，存在這台電腦（%USERPROFILE%\.duty-local-ai.json），並設定到 Cloudflare Worker（LOCAL_AI_KEY）
//
// 做的事：
//   1. 在 127.0.0.1:8788 開一個只收 POST /generate 的門口，要帶 x-local-ai-key（門口密碼）才收；一次只做一件（顯示卡只有一張）。
//   2. 用 cloudflared 開臨時通道（https://xxx.trycloudflare.com，不用帳號），把通道網址連同密碼告訴 Worker（POST /local-ai），每 5 分鐘再說一次；
//      關掉時告訴 Worker「沒開了」。Worker 超過 15 分鐘沒收到就當作沒開。
//   3. 收到的 { parts: [{ text } | { inline_data: { mime_type, data } }] } 轉成 Ollama 的 /api/chat（JSON 輸出），回傳 { text, model }。
// 密碼只存在這台電腦和 Worker 的祕密設定，不放進程式、不印出來。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const CONF = path.join(os.homedir(), '.duty-local-ai.json');
const PORT = 8788;
const OLLAMA = 'http://127.0.0.1:11434';
const WORKER = 'https://duty-calendar-api.duty-calendar-worker.workers.dev';
const ROOT = path.join(__dirname, '..', '..');

function loadConf() {
  try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch (e) { return null; }
}

// ---------- 第一次：產生密碼、設定到 Worker ----------
if (process.argv.includes('--setup')) {
  let conf = loadConf();
  if (!conf || !conf.key) {
    conf = Object.assign(conf || {}, { key: crypto.randomBytes(32).toString('hex'), model: (conf && conf.model) || 'gemma3:12b' });
    fs.writeFileSync(CONF, JSON.stringify(conf, null, 2));
    console.log('已產生門口密碼，存在 ' + CONF);
  } else {
    console.log('門口密碼已經有了（' + CONF + '）');
  }
  // 交給 wrangler secret put（從標準輸入讀，不會出現在畫面或指令列）
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', 'wrangler@4', 'secret', 'put', 'LOCAL_AI_KEY'], { cwd: path.join(ROOT, 'worker'), input: conf.key, stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  console.log('Worker 的 LOCAL_AI_KEY 設定好了。之後執行：node tools/local-ai/gateway.js');
  process.exit(0);
}

const conf = loadConf();
if (!conf || !conf.key) { console.error('還沒設定：先執行 node tools/local-ai/gateway.js --setup'); process.exit(1); }
const MODEL = process.env.LOCAL_AI_MODEL || conf.model || 'gemma3:12b';

const same = (a, b) => { const x = crypto.createHash('sha256').update(String(a || '')).digest(); const y = crypto.createHash('sha256').update(String(b || '')).digest(); return crypto.timingSafeEqual(x, y); };

// 一次只做一件
let chain = Promise.resolve();
const queue = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

// 「從照片或檔案新增」的格式（2026/11/27）：小模型照 JSON schema 輸出準很多
const S = { type: 'string' };
const DRAFT_SCHEMA = { type: 'object', required: ['duties'], properties: { duties: { type: 'array', items: { type: 'object', required: ['name', 'start', 'end', 'regionText', 'positions'], properties: {
  name: S, nature: S, mode: S, start: S, end: S, lunarDate: S, startTime: S, endTime: S, location: S, attire: S, description: S, deadline: S,
  positions: { type: 'array', items: { type: 'object', required: ['name', 'min'], properties: { name: S, min: { type: 'number' }, max: { type: 'number' } } } },
  keywords: { type: 'array', items: S }, regionText: S, uncertain: { type: 'array', items: S }
} } } } };
const FILE_HEAD = '以下是檔案的文字：\n';
const PIECE = 2500; // 本機一次讀太多會漏：用分工表量過，8000 字一次只抓到 12 個本區日期裡的 2 個

/** 檔案文字照【第 N 頁】切成大約 2500 字一段（一頁太長就整頁） */
function pieces(text) {
  const pages = text.split(/\n(?=【第 \d+ 頁】)/);
  const out = [];
  pages.forEach((p) => { if (out.length && out[out.length - 1].length + p.length + 1 <= PIECE) out[out.length - 1] += '\n' + p; else out.push(p); });
  return out;
}

async function generate(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const isDraft = list.some((p) => p && typeof p.text === 'string' && /整理成勤務草稿 JSON/.test(p.text));
  const file = list.find((p) => p && typeof p.text === 'string' && p.text.startsWith(FILE_HEAD));
  if (!isDraft || !file || file.text.length <= FILE_HEAD.length + PIECE) return generateOne(list, isDraft);
  // 檔案文字太長：一段一段讀再合起來
  const duties = [];
  let model = '';
  for (const piece of pieces(file.text.slice(FILE_HEAD.length))) {
    const r = await generateOne(list.map((p) => (p === file ? { text: FILE_HEAD + piece } : p)), true);
    model = r.model;
    try { const j = JSON.parse(r.text); (Array.isArray(j) ? j : j.duties || []).forEach((d) => duties.push(d)); } catch (e) { /* 這段看不懂就算了 */ }
  }
  return { text: JSON.stringify({ duties }), model };
}

async function generateOne(parts, isDraft) {
  const texts = [];
  const images = [];
  (Array.isArray(parts) ? parts : []).forEach((p) => {
    if (p && typeof p.text === 'string') texts.push(p.text);
    else if (p && p.inline_data && p.inline_data.data) images.push(String(p.inline_data.data));
  });
  const t0 = Date.now();
  const res = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: false, format: isDraft ? DRAFT_SCHEMA : 'json', keep_alive: '30m',
      options: { temperature: 0.1, num_ctx: 16384 },
      messages: [{ role: 'user', content: texts.join('\n\n'), images }]
    }),
    signal: AbortSignal.timeout(170000)
  });
  if (!res.ok) throw new Error('Ollama ' + res.status + '：' + (await res.text()).slice(0, 200));
  const j = await res.json();
  const text = (j.message && j.message.content) || '';
  console.log(new Date().toLocaleTimeString() + ' 讀好一批：' + images.length + ' 張圖、' + texts.join('').length + ' 字，' + Math.round((Date.now() - t0) / 1000) + ' 秒');
  return { text, model: '本機 ' + MODEL };
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/ping') return send(200, { ok: true, model: MODEL });
  if (req.method !== 'POST' || req.url !== '/generate') return send(404, { ok: false });
  if (!same(req.headers['x-local-ai-key'], conf.key)) return send(401, { ok: false });
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 40 * 1024 * 1024) req.destroy(); else chunks.push(c); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(400, { ok: false }); }
    // 通道（trycloudflare）超過 100 秒沒收到東西就斷（524）；本機讀一批常要 1～2 分鐘：先回表頭，每 20 秒送一個空白（JSON 前面的空白不影響解析），讀好再送結果
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.write(' ');
    const keep = setInterval(() => res.write(' '), 20000);
    let out;
    try { out = Object.assign({ ok: true }, await queue(() => generate(body.parts))); } catch (e) { console.error('讀不好：' + e.message); out = { ok: false, error: e.message }; }
    clearInterval(keep);
    res.end(JSON.stringify(out));
  });
});

let tunnelUrl = '';
async function register(url) {
  try {
    const r = await fetch(WORKER + '/local-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: conf.key, url }), signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!j.ok) console.error('告訴網站失敗：' + JSON.stringify(j.error || j));
    return j.ok;
  } catch (e) { console.error('告訴網站失敗：' + e.message); return false; }
}

server.listen(PORT, '127.0.0.1', async () => {
  // 先確認 Ollama 和模型都在
  try {
    const tags = await (await fetch(OLLAMA + '/api/tags')).json();
    if (!(tags.models || []).some((m) => m.name === MODEL || m.model === MODEL)) { console.error('Ollama 裡沒有模型 ' + MODEL + '，請先執行：ollama pull ' + MODEL); process.exit(1); }
  } catch (e) { console.error('連不到 Ollama（' + OLLAMA + '），請確認 Ollama 有開'); process.exit(1); }
  console.log('本機 AI 門口開好了（模型 ' + MODEL + '），開通道中⋯');
  const exe = process.env.CLOUDFLARED || ['C:/Program Files (x86)/cloudflared/cloudflared.exe', 'C:/Program Files/cloudflared/cloudflared.exe'].find((p) => fs.existsSync(p)) || 'cloudflared';
  const cf = spawn(exe, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + PORT], { windowsHide: true });
  let lastLog = '';
  const onLine = async (buf) => {
    lastLog = (lastLog + String(buf)).slice(-600);
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf));
    if (m && m[0] !== tunnelUrl) {
      tunnelUrl = m[0];
      // 通道剛開好時網址要等一下才連得到
      setTimeout(async () => { if (await register(tunnelUrl)) console.log('✅ 網站現在會先用這台電腦讀（關掉這個視窗就改用 Gemini）'); }, 8000);
    }
  };
  cf.stdout.on('data', onLine);
  cf.stderr.on('data', onLine);
  cf.on('exit', (code) => { console.error('通道關了（' + code + '）：' + lastLog.trim().split(/\r?\n/).slice(-2).join(' / ')); register('').finally(() => process.exit(1)); });
  setInterval(() => { if (tunnelUrl) register(tunnelUrl); }, 5 * 60 * 1000);
  const bye = () => { cf.kill(); register('').finally(() => process.exit(0)); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
});
