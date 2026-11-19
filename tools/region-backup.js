// 分區（2026/11/19）：每週自動備份的查看、手動備份、還原（要 REGION_ADMIN_KEY，和 tools/new-region.js 一樣）。
//   node tools/region-backup.js list                     列出所有備份
//   node tools/region-backup.js backup [區代號]            現在備份（不寫區＝全部）
//   node tools/region-backup.js restore <區代號> "<時間>"  還原（教全區的代號是 main）；還原前會先自動備份現在的資料
// 加 --mock 用測試版（node tools/dev-server.js --mock）。還原會整個取代那一區的資料，一定要先問過使用者。
const fs = require('fs');
const path = require('path');

const API = 'https://duty-calendar-api.duty-calendar-worker.workers.dev/region-admin';

async function main() {
  const args = process.argv.slice(2);
  const mock = args.includes('--mock');
  const [op, region, at] = args.filter((a) => !a.startsWith('--'));
  if (['list', 'backup', 'restore'].indexOf(op) === -1) throw new Error('用法：node tools/region-backup.js list | backup [區] | restore <區> "<時間>" [--mock]');
  let key = 'test-key';
  if (!mock) {
    const file = path.join(__dirname, '..', 'worker', '.region-admin-key');
    key = process.env.REGION_ADMIN_KEY || (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '');
    if (!key) throw new Error('找不到 REGION_ADMIN_KEY（環境變數或 worker/.region-admin-key）');
  }
  const url = mock ? 'http://localhost:' + (process.env.PORT || 5175) + '/region-admin' : API;
  const body = { key, op: op === 'list' ? 'backups' : op, region: region || '', at: at || '' };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ? json.error.code + '：' + json.error.message : '失敗');
  if (op === 'list') {
    if (!json.data.length) console.log('還沒有備份');
    json.data.forEach((b) => console.log(`${b.region.padEnd(5)} ${b.at}  ${Math.round(b.size / 1024)} KB`));
  } else {
    console.log(JSON.stringify(json.data, null, 2));
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
