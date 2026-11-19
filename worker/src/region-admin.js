// 分區 ②（2026/11/19）：開通一區。Claude 用 tools/new-region.js 呼叫（POST /region-admin，要 Worker 的秘密金鑰 REGION_ADMIN_KEY），
// 回傳一個「開通連結」（7 天內、只能用一次），交給那一區的總管理者自己設定密碼。Claude 不碰真的密碼。
// main、target 是教全區與那一區（正式是 Durable Object，測試版是同樣方法的物件）。
import { REGIONS } from './regions.js';
import { createHash, timingSafeEqual } from 'node:crypto';

const sha = (s) => createHash('sha256').update(String(s)).digest();

export async function regionAdmin(body, opts) {
  const expected = String(opts.key || '');
  if (!expected) return { ok: false, error: { code: 'CONFIG', message: '還沒設定 REGION_ADMIN_KEY' } };
  if (!timingSafeEqual(sha(body && body.key), sha(expected))) return { ok: false, error: { code: 'UNAUTHORIZED', message: '金鑰不正確' } };
  const region = String((body && body.region) || '');
  if (!Object.prototype.hasOwnProperty.call(REGIONS, region)) return { ok: false, error: { code: 'BAD_REGION', message: '找不到這一區：' + region } };
  const main = opts.stub('main');
  const vapid = await main.vapidKeys(); // 推播金鑰各區共用（同一個網站在手機上只能有一組）
  const out = await opts.stub(region).openRegion({ region, vapid, siteBase: opts.siteBase });
  await main.addOpenRegion(region); // 排程（每天的提醒）會跑這一區
  return { ok: true, data: Object.assign({ region, name: REGIONS[region], link: opts.siteBase + region + '/#/setup/' + out.token }, out) };
}
