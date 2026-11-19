// 分區 ②（2026/11/19）：開通一區，印出「開通連結」（7 天內、只能用一次），交給那一區的總管理者自己設定密碼。
// 已開通的區再執行一次＝換一個新的開通連結（例如總管理者忘了密碼；舊密碼在新密碼設好前照常能用）。
//   node tools/new-region.js she            正式（金鑰：環境變數 REGION_ADMIN_KEY，或 worker/.region-admin-key 檔，不放 repo）
//   node tools/new-region.js fa --mock      測試版（node tools/dev-server.js --mock，金鑰 test-key）
const fs = require('fs');
const path = require('path');

const API = 'https://duty-calendar-api.duty-calendar-worker.workers.dev/region-admin';

async function main() {
  const args = process.argv.slice(2);
  const mock = args.includes('--mock');
  const region = args.find((a) => !a.startsWith('--'));
  if (!region) throw new Error('用法：node tools/new-region.js <區代號> [--mock]');
  let key = 'test-key';
  if (!mock) {
    const file = path.join(__dirname, '..', 'worker', '.region-admin-key');
    key = process.env.REGION_ADMIN_KEY || (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '');
    if (!key) throw new Error('找不到 REGION_ADMIN_KEY（環境變數或 worker/.region-admin-key）');
  }
  const url = mock ? 'http://localhost:' + (process.env.PORT || 5175) + '/region-admin' : API;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, region }) });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ? json.error.code + '：' + json.error.message : '失敗');
  const d = json.data;
  console.log(`${d.name}（${d.region}）${d.first ? '開通了' : '已經開通，換了新的開通連結'}${d.hasPassword ? '（已經有總管理者密碼）' : ''}`);
  console.log('開通連結（' + d.expires.slice(0, 10) + ' 前有效、只能用一次）：');
  console.log(d.link);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
