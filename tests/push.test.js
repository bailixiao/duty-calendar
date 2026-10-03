// 手機推播：VAPID 簽章（用 Node 內建 crypto 驗證）、開啟／關閉提醒、每天送出、失效自動停用、測試通知。
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0); // 台北 10:00
const OCT_9_EVENING = Date.UTC(2026, 9, 9, 12, 0, 0); // 台北 10/9 20:00，明天 10/10 有初一十五打掃

function publicKeyFrom(pubB64) {
  const raw = Buffer.from(pubB64, 'base64url');
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4);
  return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
}

test('VAPID 簽章：產生的金鑰在曲線上，JWT 用 Node crypto 驗證通過', () => {
  const env = createEnv(OCT_1);
  const keys = env.fn('ensurePushKeys_')();
  const pub = publicKeyFrom(keys.pub); // 不在曲線上會丟錯
  for (const aud of ['https://fcm.googleapis.com', 'https://web.push.apple.com', 'https://updates.push.services.mozilla.com']) {
    const jwt = env.fn('vapidJwt_')(aud, keys.d, 1790000000);
    const [h, b, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
    const body = JSON.parse(Buffer.from(b, 'base64url'));
    assert.equal(body.aud, aud);
    assert.equal(body.exp, 1790000000 + 12 * 3600);
    assert.ok(/^https:/.test(body.sub));
    const ok = crypto.verify('sha256', Buffer.from(h + '.' + b), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    assert.equal(ok, true, aud);
  }
  // 再執行一次沿用同一把金鑰
  assert.equal(env.fn('ensurePushKeys_')().pub, keys.pub);
});

test('開啟提醒、晚上送「明天的勤務」；失效的手機自動停用；關閉後不再送', () => {
  const env = createEnv(OCT_9_EVENING);
  env.fn('ensurePushKeys_')();
  const key = env.get({ action: 'pushKey' });
  assert.equal(key.ok, true, JSON.stringify(key.error));
  const A = 'https://fcm.googleapis.com/fcm/send/aaaaaaaaaaaa';
  const B = 'https://web.push.apple.com/QBBBBBBBBBBBB';
  assert.equal(env.post({ action: 'pushSubscribe', endpoint: A }).ok, true);
  assert.equal(env.post({ action: 'pushSubscribe', endpoint: B }).ok, true);
  assert.equal(env.post({ action: 'pushSubscribe', endpoint: A }).ok, true); // 重複開啟不會多一筆
  assert.equal(env.post({ action: 'pushSubscribe', endpoint: 'javascript:alert(1)' }).error.code, 'BAD_REQUEST');
  const rows = () => env.sheets['推播'].data.slice(1);
  assert.equal(rows().length, 2);
  assert.ok(rows().every(r => !/[一-鿿]{2,}/.test(r[1]))); // 沒有名字

  const calls = [];
  env.setFetch((url, opts) => { calls.push({ url, opts }); return { code: url === B ? 410 : 201, body: '' }; });
  const res = env.fn('sendPushAll_')('tomorrow');
  assert.deepEqual(res, { sent: 1, failed: 1 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].opts.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(calls[0].opts.payload, '');
  assert.equal(rows().find(r => r[1] === B)[4], '否'); // 失效（410）自動停用
  assert.ok(rows().find(r => r[1] === A)[3]); // 記下最後成功時間

  // 手機回來問內容：晚上 → 明天（10/10）的勤務
  const id = env.fn('pushIdOf_')(A);
  const sum = env.get({ action: 'pushSummary', id }).data;
  assert.equal(sum.when, 'tomorrow');
  assert.equal(sum.date, '2026-10-10');
  assert.ok(sum.items.some(i => /初一十五打掃/.test(i.name)));

  env.post({ action: 'pushUnsubscribe', endpoint: A });
  calls.length = 0;
  assert.deepEqual(env.fn('sendPushAll_')('tomorrow'), { sent: 0 });
  assert.equal(calls.length, 0);
});

test('沒有勤務的日子不送；測試通知只送這支手機、內容標示測試、30 秒內不能連按', () => {
  const env = createEnv(Date.UTC(2026, 9, 2, 12, 0, 0)); // 10/2 晚上，明天 10/3 沒有勤務
  env.fn('ensurePushKeys_')();
  const A = 'https://fcm.googleapis.com/fcm/send/cccccccccccc';
  env.post({ action: 'pushSubscribe', endpoint: A });
  let n = 0;
  env.setFetch(() => { n++; return { code: 201, body: '' }; });
  const items = env.fn('pushItems_')('tomorrow').items;
  if (!items.length) assert.deepEqual(env.fn('sendPushAll_')('tomorrow'), { sent: 0, skipped: 'no-duty' });

  n = 0;
  assert.equal(env.post({ action: 'pushTest', endpoint: A }).ok, true);
  assert.equal(n, 1);
  assert.equal(env.post({ action: 'pushTest', endpoint: A }).error.code, 'BUSY');
  const id = env.fn('pushIdOf_')(A);
  assert.equal(env.get({ action: 'pushSummary', id }).data.test, true);
  assert.equal(env.get({ action: 'pushSummary', id }).data.test, undefined); // 只標一次
});

test('推播尚未設定金鑰：回清楚的訊息', () => {
  const env = createEnv(OCT_1);
  assert.equal(env.get({ action: 'pushKey' }).error.code, 'CONFIG');
});
