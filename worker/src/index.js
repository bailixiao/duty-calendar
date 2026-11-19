// Cloudflare Worker 入口：每一區一個 Durable Object（DutyStore），同一區的請求依序處理，資料存在它的 SQLite。
// 分區（2026/11/19）：網址帶 region=<代號> 就交給那一區（Durable Object 名稱＝代號）；沒帶的是教全區（原本的「main」，資料不動）。
import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app.js';
import { createSqlStore } from './store.js';
import { regionOf } from './regions.js';

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

  async cron(when, region) {
    try {
      return await this.app.cron(when, region);
    } finally {
      this.store.persist();
    }
  }

  /** 教全區（main）記著哪些區已經開通（排程只跑這些區） */
  openRegions() {
    return this.app.openRegions();
  }
}

function stub(env, region) {
  // 第一次建立時放在亞太區（離台灣近）
  return env.DB.get(env.DB.idFromName(region || 'main'), { locationHint: 'apac' });
}

const badRegion = () => new Response(JSON.stringify({ ok: false, error: { code: 'BAD_REGION', message: '找不到這一區，請確認網址' } }), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
});

export default {
  fetch(request, env) {
    const region = regionOf(new URL(request.url));
    if (!region) return badRegion();
    // 告訴 Durable Object 自己是哪一區（沒開通的區要擋）
    const req = new Request(request);
    req.headers.set('X-Region', region);
    return stub(env, region).fetch(req);
  },
  // 台北 07:00（UTC 23:00）提醒今天、台北 20:00（UTC 12:00）提醒明天；每 5 分鐘送排定時間到了的後台推播
  // 教全區先跑，再輪流跑已開通的區
  async scheduled(event, env, ctx) {
    const when = event.cron === '0 23 * * *' ? 'today' : event.cron === '0 12 * * *' ? 'tomorrow' : 'plans';
    ctx.waitUntil((async () => {
      const main = stub(env, 'main');
      await main.cron(when, 'main');
      const list = await main.openRegions();
      for (const r of list) {
        try { await stub(env, r).cron(when, r); } catch (e) { console.error('排程', r, e); }
      }
    })());
  }
};
