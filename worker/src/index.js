// Cloudflare Worker 入口：所有請求都交給同一個 Durable Object（DutyStore）依序處理，資料存在它的 SQLite。
import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app.js';
import { createSqlStore } from './store.js';

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

  async cron(when) {
    try {
      return await this.app.cron(when);
    } finally {
      this.store.persist();
    }
  }
}

function stub(env) {
  // 第一次建立時放在亞太區（離台灣近）
  return env.DB.get(env.DB.idFromName('main'), { locationHint: 'apac' });
}

export default {
  fetch: (request, env) => stub(env).fetch(request),
  // 台北 07:00（UTC 23:00）提醒今天、台北 20:00（UTC 12:00）提醒明天；每 5 分鐘送排定時間到了的後台推播
  async scheduled(event, env, ctx) {
    const when = event.cron === '0 23 * * *' ? 'today' : event.cron === '0 12 * * *' ? 'tomorrow' : 'plans';
    ctx.waitUntil(stub(env).cron(when));
  }
};
