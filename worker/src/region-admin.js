// 分區 ②（2026/11/19）：開通一區。Claude 用 tools/new-region.js 呼叫（POST /region-admin，要 Worker 的秘密金鑰 REGION_ADMIN_KEY），
// 回傳一個「開通連結」（7 天內、只能用一次），交給那一區的總管理者自己設定密碼。Claude 不碰真的密碼。
// main、target 是教全區與那一區（正式是 Durable Object，測試版是同樣方法的物件）。
import { REGIONS, regionSiteUrl } from './regions.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { backupAll, taipeiStamp } from './schedule.js';

const sha = (s) => createHash('sha256').update(String(s)).digest();

export async function regionAdmin(body, opts) {
  const expected = String(opts.key || '');
  if (!expected) return { ok: false, error: { code: 'CONFIG', message: '還沒設定 REGION_ADMIN_KEY' } };
  if (!timingSafeEqual(sha(body && body.key), sha(expected))) return { ok: false, error: { code: 'UNAUTHORIZED', message: '金鑰不正確' } };
  const region = String((body && body.region) || '');
  const op = String((body && body.op) || 'open');
  if (op !== 'open') return backupOp(op, region, body, opts);
  if (!Object.prototype.hasOwnProperty.call(REGIONS, region)) return { ok: false, error: { code: 'BAD_REGION', message: '找不到這一區：' + region } };
  const main = opts.stub('main');
  const vapid = await main.vapidKeys(); // 推播金鑰各區共用（同一個網站在手機上只能有一組）
  const out = await opts.stub(region).openRegion({ region, vapid, siteBase: opts.siteBase });
  await main.addOpenRegion(region); // 排程（每天的提醒）會跑這一區
  return { ok: true, data: Object.assign({ region, name: REGIONS[region], link: regionSiteUrl(region, opts.siteBase) + '#/setup/' + out.token }, out) };
}

// ---------- 備份（tools/region-backup.js） ----------
//   op=backups：列出所有備份；op=backup：現在備份（region 留空＝全部已開通的區＋教全區）；
//   op=restore：用 region 的 at 那一份還原（還原前先把現在的資料備份一份「⋯ 還原前」，弄錯可以再還原回來）
async function backupOp(op, region, body, opts) {
  const known = (r) => r === 'main' || Object.prototype.hasOwnProperty.call(REGIONS, r);
  const fail = (code, message) => ({ ok: false, error: { code, message } });
  if (op === 'backups') return { ok: true, data: await opts.backup.listBackups() };
  if (op === 'backup') {
    if (region && !known(region)) return fail('BAD_REGION', '找不到這一區：' + region);
    const list = region ? [region] : ['main'].concat(await opts.stub('main').openRegions());
    return { ok: true, data: await backupAll(list, { stub: opts.stub, at: taipeiStamp(new Date()) + ' 手動' }) };
  }
  if (op === 'restore') {
    if (!known(region)) return fail('BAD_REGION', '找不到這一區：' + region);
    const at = String(body.at || '');
    const have = (await opts.backup.listBackups()).some((b) => b.region === region && b.at === at);
    if (!have) return fail('NOT_FOUND', '找不到這份備份：' + region + ' ' + at);
    const before = taipeiStamp(new Date()) + ' 還原前';
    await opts.stub(region).backupTo(region, before);
    const out = await opts.stub(region).restoreFrom(region, at);
    return { ok: true, data: Object.assign({ region, from: at, savedBefore: before }, out) };
  }
  return fail('BAD_REQUEST', '不認得的 op：' + op);
}
