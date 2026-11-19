// Cloudflare Worker 入口：每一區一個 Durable Object（DutyStore），同一區的請求依序處理，資料存在它的 SQLite。
// 分區（2026/11/19）：網址帶 region=<代號> 就交給那一區（Durable Object 名稱＝代號）；沒帶的是教全區（原本的「main」，資料不動）。
import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app.js';
import { createSqlStore } from './store.js';
import { regionOf, SITE_BASE } from './regions.js';
import { regionAdmin } from './region-admin.js';
import { createSqlBackups } from './backup-store.js';
import { runSchedule } from './schedule.js';

export class DutyStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.store = createSqlStore(ctx.storage);
      this.app = createApp(this.store);
      this.store.persist(); // 第一次啟動：建立分頁標題
    });
  }

  async fetch(request) {
    try {
      return await this.app.handle(request);
    } finally {
      this.store.persist();
    }
  }

  /** 排程（worker/src/schedule.js）：回傳結果和這一區今天的用量 */
  async cron(when, region) {
    try {
      const result = await this.app.cron(when, region);
      return { result, usage: this.app.usageToday() };
    } finally {
      this.store.persist();
    }
  }

  /** 教全區（main）記著哪些區已經開通（排程只跑這些區） */
  openRegions() {
    return this.app.openRegions();
  }

  // 開通新區用（worker/src/region-admin.js）
  vapidKeys() { try { return this.app.vapidKeys(); } finally { this.store.persist(); } }
  openRegion(opts) { try { return this.app.openRegion(opts); } finally { this.store.persist(); } }
  addOpenRegion(code) { try { return this.app.addOpenRegion(code); } finally { this.store.persist(); } }

  // 用量、備份（schedule.js、backup-store.js）
  usageCheck(total) { return this.app.usageCheck(total).finally(() => this.store.persist()); }
  /** 把這一區的資料存一份到 backup（直接從這裡存，資料不經過 Worker） */
  async backupTo(region, at) {
    const text = this.app.snapshot();
    await this.env.DB.get(this.env.DB.idFromName('backup'), { locationHint: 'apac' }).saveBackup(region, at, text);
    return text.length;
  }
  /** 用 backup 裡的一份還原這一區 */
  async restoreFrom(region, at) {
    const text = await this.env.DB.get(this.env.DB.idFromName('backup'), { locationHint: 'apac' }).getBackup(region, at);
    if (!text) throw new Error('找不到這份備份');
    try { return this.app.restore(text); } finally { this.store.persist(); }
  }
  // 下面三個只在名叫「backup」的那一個用
  backups() { return this.bk || (this.bk = createSqlBackups(this.ctx.storage)); }
  saveBackup(region, at, text) { this.backups().save(region, at, text); return true; }
  listBackups() { return this.backups().list(); }
  getBackup(region, at) { return this.backups().get(region, at); }
}

function stub(env, region) {
  // 第一次建立時放在亞太區（離台灣近）
  return env.DB.get(env.DB.idFromName(region || 'main'), { locationHint: 'apac' });
}

const badRegion = () => new Response(JSON.stringify({ ok: false, error: { code: 'BAD_REGION', message: '找不到這一區，請確認網址' } }), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/region-admin') { // 開通新區（tools/new-region.js）
      let body = {};
      try { body = await request.json(); } catch (e) { /* 空的 */ }
      const out = request.method === 'POST' ? await regionAdmin(body, { key: env.REGION_ADMIN_KEY, siteBase: SITE_BASE, stub: (r) => stub(env, r), backup: stub(env, 'backup') }) : { ok: false };
      return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    const region = regionOf(url);
    if (!region) return badRegion();
    // 告訴 Durable Object 自己是哪一區（沒開通的區要擋）
    const req = new Request(request);
    req.headers.set('X-Region', region);
    return stub(env, region).fetch(req);
  },
  // 台北 07:00（UTC 23:00）提醒今天、台北 20:00（UTC 12:00）提醒明天；每 5 分鐘送排定時間到了的後台推播
  // 教全區先跑，再輪流跑已開通的區；用量提醒、每週備份見 schedule.js
  async scheduled(event, env, ctx) {
    const when = event.cron === '0 23 * * *' ? 'today' : event.cron === '0 12 * * *' ? 'tomorrow' : 'plans';
    ctx.waitUntil(runSchedule(when, { stub: (r) => stub(env, r), now: new Date(event.scheduledTime || Date.now()) }));
  }
};
