// sw.js 收到推播後顯示的通知：標題、內容（最多 4 項＋缺人提醒）、點了打開哪裡；問不到伺服器時顯示通用通知。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

function loadSw(summary) {
  const listeners = {};
  const shown = [];
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting() {},
    location: { origin: 'https://example.test' },
    registration: {
      scope: 'https://example.test/duty-calendar/',
      pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }) },
      showNotification: async (title, opts) => { shown.push({ title, ...opts }); }
    },
    clients: { claim() {}, matchAll: async () => [] }
  };
  const fetchLog = [];
  const ctx = {
    self, caches: {}, crypto: webcrypto, TextEncoder, URL, console,
    importScripts: () => { self.SITE = { name: '教全區行事曆' }; self.APP_CONFIG = { API_URL: 'https://api.test/exec' }; },
    fetch: async (url) => { fetchLog.push(url); if (summary instanceof Error) throw summary; return { json: async () => summary }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), ctx);
  const push = async () => {
    let p;
    listeners.push({ waitUntil: (x) => { p = x; } });
    await p;
    return shown[0];
  };
  return { push, fetchLog };
}

test('明天有 5 項勤務：顯示前 4 項、還有幾項、缺人提醒，點了打開「近期」', async () => {
  const items = [
    { id: 'D1', name: '初一十五打掃（宏宗）', time: '08:00', label: '缺 2 人', short: true },
    { id: 'D2', name: '彌勒山志工輪值', time: '', label: '人數足・3 人' },
    { id: 'D3', name: '烹飪團輪值', time: '09:00', label: '' },
    { id: 'D4', name: '敬老活動', nature: '活動', time: '10:00', label: '' },
    { id: 'D5', name: '拜香輪值', time: '', label: '輪值：第五組' }
  ];
  const { push, fetchLog } = loadSw({ ok: true, data: { when: 'tomorrow', date: '2026-10-10', items } });
  const n = await push();
  assert.equal(n.title, '🙏 明天的行程提醒（10/10 六）');
  const lines = n.body.split('\n');
  assert.equal(lines[0], '🧹 08:00 初一十五打掃（宏宗）　缺 2 人');
  assert.equal(lines[1], '🙌 彌勒山志工輪值　人數足・3 人');
  assert.equal(lines[4], '⋯還有 1 項');
  assert.equal(lines[5], '🙋 部分勤務還需要人手，歡迎您發心了愿');
  assert.equal(lines[6], '感恩您的護持 🙏');
  assert.equal(n.data.url, '#/recent');
  assert.match(fetchLog[0], /^https:\/\/api\.test\/exec\?action=pushSummary&id=[0-9a-f]{16}$/);
});

test('只有一項：點了直接打開那個勤務；測試通知；問不到伺服器時用通用通知', async () => {
  let n = await loadSw({ ok: true, data: { when: 'today', date: '2026-10-24', items: [{ id: 'D9', name: '宏宗大掃除', time: '09:00', label: '' }] } }).push();
  assert.equal(n.title, '🙏 今天的行程提醒（10/24 六）');
  assert.equal(n.data.url, '#/duty/D9?date=2026-10-24');

  n = await loadSw({ ok: true, data: { when: 'today', date: '2026-10-24', items: [], test: true } }).push();
  assert.equal(n.title, '🔔 測試通知');

  n = await loadSw(new Error('offline')).push();
  assert.equal(n.title, '🙏 教全區行事曆提醒');
  assert.equal(n.data.url, '#/recent');
});
