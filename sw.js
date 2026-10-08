// Service Worker：把網頁檔案存在手機裡，第二次以後打開不用重新下載，畫面幾乎立刻出現；沒網路也能看上次的資料。
//   - 網頁本身（index.html）：先向網路拿最新的，3 秒拿不到才用手機裡的（確保程式更新時大家拿到新版）。
//   - 帶版本號的 js／css（?v=…）、固定版本的外部函式庫：版本不變內容就不變，直接用手機裡的。
//     同一個檔案有新版本時，舊版本自動刪掉。
//   - 其他（圖示、勤務圖片、字型）：先用手機裡的，同時在背景更新。
//   - 資料 API（script.google.com）一律不經過這裡，永遠向伺服器拿。
'use strict';

const CACHE = 'duty-calendar-v2';
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && CDN_HOSTS.indexOf(url.hostname) === -1) return; // API 等其他網址：不處理
  if (sameOrigin && /\/api$/.test(url.pathname)) return; // 本機測試用的假 API

  if (req.mode === 'navigate') {
    ev.respondWith(networkFirst(req));
  } else if ((sameOrigin && url.searchParams.has('v')) || url.hostname === 'cdn.jsdelivr.net') {
    ev.respondWith(cacheFirst(req, sameOrigin ? url : null));
  } else {
    ev.respondWith(staleWhileRevalidate(req, ev));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const key = new URL('./', self.location).href; // 網頁本身只存一份（不分 #／?）
  try {
    const res = await withTimeout(fetch(req), 3000);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(key);
    if (cached) return cached;
    return fetch(req);
  }
}

async function cacheFirst(req, versionedUrl) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    if (versionedUrl) pruneOldVersions(cache, versionedUrl);
  }
  return res;
}

async function staleWhileRevalidate(req, ev) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    ev.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update;
}

/** 同一個檔案（同路徑）只留目前這個版本 */
async function pruneOldVersions(cache, url) {
  const keys = await cache.keys();
  await Promise.all(keys.map((k) => {
    const u = new URL(k.url);
    return u.origin === url.origin && u.pathname === url.pathname && u.search !== url.search ? cache.delete(k) : null;
  }));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ---------- 手機提醒（推播，見 apps-script/Push.gs） ----------
// 推播本身不帶內容：收到後回伺服器問「今天／明天有什麼勤務」，再顯示通知。點通知打開勤務或「近期」。

self.window = self; // config.js 寫的是 window.APP_CONFIG
try { importScripts('js/site.js', 'js/config.js'); } catch (e) { /* 讀不到就用通用通知 */ }

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function dutyEmoji(it) {
  const n = it.name || '';
  if (/打掃|掃除|打蠟|洗/.test(n)) return '🧹';
  if (/烹飪|廚|蔬食/.test(n)) return '🍳';
  if (/捐血/.test(n)) return '🩸';
  if (/值夜/.test(n)) return '🌙';
  if (/拜香/.test(n)) return '🙏';
  if (/敬老|重陽|長青/.test(n)) return '👴';
  if (/志工/.test(n)) return '🙌';
  if (/班/.test(n)) return '📖';
  if (it.nature === '活動') return '🎉';
  return '✨';
}

/** 推播網址的代號（與伺服器的 pushIdOf_ 相同：SHA-256 前 16 個十六進位字） */
async function pushId(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildNotification() {
  const fallback = { title: '🙏 ' + ((self.SITE && self.SITE.name) || '行事曆') + '提醒', body: '有勤務或活動喔，歡迎點開看看 😊', url: '#/recent' };
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const api = self.APP_CONFIG && self.APP_CONFIG.API_URL;
    if (!sub || !api) return fallback;
    const res = await fetch(api + '?action=pushSummary&id=' + await pushId(sub.endpoint));
    const json = await res.json();
    if (!json.ok) return fallback;
    const d = json.data;
    if (d.message) return { title: d.message.title, body: d.message.body, url: d.message.url || '#/', tag: 'msg-' + d.message.id, plan: d.message.plan ? d.message.id : '', dev: await pushId(sub.endpoint) }; // 借場地通知、後台推播
    if (d.test) return { title: '🔔 測試通知', body: '您好！已順利收到通知 😊\n有勤務時，前一天晚上 8 點、當天早上 7 點會溫馨提醒您 🙏', url: '#/recent' };
    if (!d.items.length) return fallback;
    const p = d.date.split('-').map(Number);
    const wd = WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()];
    const day = d.when === 'today' ? '今天' : '明天';
    const go = (id) => `#/duty/${encodeURIComponent(id)}?date=${d.date}&go=signup`;
    // 填了「我是誰」的手機：只列他報名的，另外附缺人數
    if (Array.isArray(d.mine)) {
      const short = d.shortItems || [];
      // 組長：標題寫是哪個勤務的組長，點開到點名頁
      const lead = d.mine.find((it) => it.leader);
      if (lead) {
        const lines = [`⏰ ${lead.time || '時間見勤務頁'}${lead.location ? '　📍' + lead.location : ''}`, `🙋 目前報名 ${lead.people} 位`];
        if (lead.code) lines.push(`📋 點名碼：${lead.code}（點開就能點名）`);
        const others = d.mine.filter((it) => it !== lead);
        if (others.length) lines.push(`另外還有 ${others.length} 個您報名的勤務`);
        lines.push('感恩您承擔 🙏');
        return { title: `★ ${day}您是「${lead.name}」的${lead.leader}（${p[1]}/${p[2]} ${wd}）`, body: lines.join('\n'), url: `#/rollcall/${encodeURIComponent(lead.id)}?date=${d.date}` };
      }
      if (d.mine.length) {
        const lines = d.mine.slice(0, 4).map((it) => `${dutyEmoji(it)} ${it.time ? it.time + ' ' : ''}${it.name}${it.position ? '・' + it.position : ''}${it.location ? '（📍' + it.location + '）' : ''}`);
        if (short.length) lines.push(`🙋 另外還有 ${short.length} 個勤務缺人，點我看看`);
        lines.push('感恩您的發心 🙏');
        return { title: `🙏 ${day}您的勤務（${p[1]}/${p[2]} ${wd}）`, body: lines.join('\n'), url: short.length ? '#/recent' : `#/duty/${encodeURIComponent(d.mine[0].id)}?date=${d.date}` };
      }
      if (short.length) {
        const lines = short.slice(0, 4).map((it) => `${dutyEmoji(it)} ${it.time ? it.time + ' ' : ''}${it.name}　${it.label}`);
        if (short.length > 4) lines.push(`⋯還有 ${short.length - 4} 項`);
        lines.push('歡迎您發心了愿 🙏');
        return { title: `🙋 ${day}還有 ${short.length} 個勤務缺人（${p[1]}/${p[2]} ${wd}）`, body: lines.join('\n'), url: short.length === 1 ? go(short[0].id) : '#/recent' };
      }
      return fallback;
    }
    const lines = d.items.slice(0, 4).map((it) => `${dutyEmoji(it)} ${it.time ? it.time + ' ' : ''}${it.name}${it.label ? '　' + it.label : ''}`);
    if (d.items.length > 4) lines.push(`⋯還有 ${d.items.length - 4} 項`);
    const shortCount = d.items.filter((it) => it.short).length;
    if (shortCount) lines.push('🙋 部分勤務還需要人手，歡迎您發心了愿');
    lines.push('感恩您的護持 🙏');
    return {
      title: `🙏 ${d.when === 'today' ? '今天' : '明天'}的行程提醒（${p[1]}/${p[2]} ${wd}）`,
      body: lines.join('\n'),
      url: d.items.length === 1 ? (d.items[0].short ? go(d.items[0].id) : `#/duty/${encodeURIComponent(d.items[0].id)}?date=${d.date}`) : '#/recent'
    };
  } catch (e) {
    return fallback;
  }
}

self.addEventListener('push', (ev) => {
  ev.waitUntil(buildNotification().then((n) => self.registration.showNotification(n.title, {
    body: n.body,
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag: n.tag || 'duty-reminder',
    renotify: true,
    data: { url: n.url, plan: n.plan || '', dev: n.dev || '' }
  })));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const data = ev.notification.data || {};
  const url = new URL(data.url || '#/recent', self.registration.scope).href;
  ev.waitUntil((async () => {
    // 後台推播：記一次「點開」（推播成效）
    const api = self.APP_CONFIG && self.APP_CONFIG.API_URL;
    if (data.plan && api) fetch(api + '?action=pushClick&id=' + encodeURIComponent(data.plan) + '&dev=' + encodeURIComponent(data.dev)).catch(() => {});
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      return win.navigate ? win.navigate(url) : null;
    }
    return self.clients.openWindow(url);
  })());
});
