// 📸 活動相簿（2026/11/23）：任何人上傳照片（大圖＋縮圖）、貼相簿連結；活動當天起才能放；每天最多張數；管理者刪（檔案一起刪）。
const test = require('node:test');
const assert = require('node:assert/strict');

require('../tools/build-worker.js');

async function setup() {
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const store = createMemoryStore();
  store.setProp('NEWCOMER_INFO', '0');
  store.setProp('ADMIN_PASSWORD', 'test-pass');
  const app = createApp(store, { now: () => Date.UTC(2026, 10, 23, 2, 0, 0) });
  const call = async (payload, method) => {
    const req = method === 'GET'
      ? new Request('https://w.test/?' + new URLSearchParams(payload))
      : new Request('https://w.test/', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify(payload) });
    const res = await app.handle(req);
    store.persist();
    return res.json();
  };
  const token = (await call({ action: 'adminLogin', password: 'test-pass' })).data.token;
  const admin = (action, body) => call(Object.assign({ action, token }, body || {}));
  return { store, call, admin };
}
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');

test('活動相簿：上傳照片、貼連結、看相簿；未來的日期不行；管理者刪掉檔案也刪', async () => {
  const { store, call, admin } = await setup();
  const made = await admin('adminCreateDuties', { duties: [
    { name: '測試園遊會', category: '勤務', nature: '活動', mode: '報名型', start: '2026-11-22', end: '2026-11-24', location: '測試地點', positions: [{ name: '參加' }] }
  ] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const dutyId = made.data.ids[0];
  // 未來的日期、沒有名字：擋
  assert.equal((await call({ action: 'albumUpload', dutyId, date: '2026-11-24', by: '測試甲', data: JPG, thumb: JPG })).error.code, 'BAD_REQUEST');
  assert.equal((await call({ action: 'albumUpload', dutyId, date: '2026-11-22', by: '', data: JPG, thumb: JPG })).error.code, 'VALIDATION');
  let r = await call({ action: 'albumUpload', dutyId, date: '2026-11-22', by: '測試甲', data: JPG, thumb: JPG });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const p = r.data.dates['2026-11-22'].photos[0];
  assert.equal(p.by, '測試甲');
  assert.ok(store.getFile(p.file) && store.getFile(p.thumb), '大圖、縮圖都存了');
  // 連結
  assert.equal((await call({ action: 'albumLink', dutyId, date: '2026-11-22', by: '測試乙', url: 'javascript:alert(1)' })).error.code, 'VALIDATION');
  r = await call({ action: 'albumLink', dutyId, date: '2026-11-22', by: '測試乙', url: 'https://photos.example.com/album/123', label: 'LINE 相簿' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  r = await call({ action: 'album', dutyId }, 'GET');
  assert.equal(r.data.dates['2026-11-22'].photos.length, 1);
  assert.equal(r.data.dates['2026-11-22'].links[0].label, 'LINE 相簿');
  // 沒登入不能刪；管理者刪：檔案一起刪
  assert.equal((await call({ action: 'adminAlbumDelete', id: p.id })).error.code, 'UNAUTHORIZED');
  r = await admin('adminAlbumDelete', { id: p.id });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal((r.data.dates['2026-11-22'] || { photos: [] }).photos.length, 0);
  assert.equal(store.getFile(p.file), null);
  assert.equal(store.getFile(p.thumb), null);
});
