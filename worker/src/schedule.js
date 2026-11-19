// 排程（2026/11/19 分區後）：教全區先跑，再輪流跑已開通的區。
//   - 每 5 分鐘（plans）：排定時間到了的後台推播；順便把各區今天的用量加起來，到免費額度 8 成通知（usageCheck）。
//   - 台北 07:00（today）、20:00（tomorrow）：手機提醒。
//   - 每週日台北 07:00（UTC 週六 23:00 的 today）：每一區自動備份一份到「backup」（worker/src/backup-store.js）。
// stub(r) 是那一區的 Durable Object（測試時是同樣方法的物件）。

/** 台北時間的「YYYY-MM-DD HH:mm」（備份的名字） */
export function taipeiStamp(d) {
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 每一區存一份備份（那一區自己直接存到 backup，資料不經過 Worker：免費方案 Worker 的 CPU 時間很短）；回傳每區的大小 */
export async function backupAll(regions, { stub, at }) {
  const out = {};
  for (const r of regions) {
    try {
      out[r] = await stub(r).backupTo(r, at);
    } catch (e) {
      console.error('備份', r, e);
      out[r] = 'error';
    }
  }
  return out;
}

export async function runSchedule(when, { stub, now }) {
  const date = now || new Date();
  const main = stub('main');
  const res = { when, regions: {} };
  let total = 0;
  const one = async (r) => {
    try {
      const x = await stub(r).cron(when, r);
      total += (x && x.usage) || 0;
      res.regions[r] = x && x.result;
    } catch (e) {
      console.error('排程', r, e);
    }
  };
  await one('main');
  const list = await main.openRegions();
  for (const r of list) await one(r);
  if (when === 'plans') res.usage = await main.usageCheck(total);
  if (when === 'today' && date.getUTCDay() === 6) res.backup = await backupAll(['main'].concat(list), { stub, at: taipeiStamp(date) });
  return res;
}
