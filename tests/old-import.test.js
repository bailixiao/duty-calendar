// 從檔案帶入舊資料：AI 提示、AI 結果整理、匯入（新增勤務帶結束日、性質）與還原。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const NOW = Date.UTC(2026, 9, 1, 2, 0, 0);

test('AI 提示與結果整理：民國換西元、不要個資、格式不對的清掉', () => {
  const env = createEnv(NOW);
  const p = env.fn('oldImportPrompt_')('日期是民國年', '活動.pdf 第 1～2 頁', '2024');
  assert.match(p, /民國 114 年 = 2025 年/);
  assert.match(p, /用 2024 年/);
  assert.match(p, /不要抄電話/);
  assert.match(p, /管理者補充說明：日期是民國年/);
  const x = env.fn('oldImportClean_')({
    name: ' 宏宗打掃 ', category: '勤務', date: '2025-03-07', end: '2025-03-01', startTime: '8:00', endTime: '午後',
    people: [{ name: '測試 甲', identity: '壇辦' }, '測試乙', { name: '', identity: '道親' }, { name: '測試丙', identity: '老師' }],
    uncertain: '第3個名字看不清楚'
  });
  assert.deepEqual(x, {
    name: '宏宗打掃', category: '勤務', date: '2025-03-07', end: '', startTime: '08:00', endTime: '', location: '',
    people: [{ name: '測試甲', identity: '壇辦' }, { name: '測試乙', identity: '' }, { name: '測試丙', identity: '' }],
    uncertain: ['第3個名字看不清楚']
  });
  assert.equal(env.fn('oldImportClean_')({ name: '課', category: '其他', date: '3/7' }).category, '');
});

test('匯入：新增的勤務帶結束日、結束時間、性質；同一場再匯入只補名單；可以還原', () => {
  const env = createEnv(NOW);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const r = call('adminImportAttendance', { sessions: [
    { create: { name: '測試研究班', category: '道務', nature: '亂寫', startTime: '09:00', endTime: '17:00', location: '區中心', end: '2025-03-09' }, date: '2025-03-07', entries: [{ name: '測試甲', identity: '壇辦' }, { name: '測試新人' }] }
  ] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const id = r.data.results[0].dutyId;
  const d = call('adminDutyForEdit', { id }).data.duty;
  assert.deepEqual([d.category, d.nature, d.start, d.end, d.startTime, d.endTime, d.location], ['道務', '法會', '2025-03-07', '2025-03-09', '09:00', '17:00', '區中心']);
  // 再帶一次同一場：只補新的人
  const again = call('adminImportAttendance', { sessions: [{ create: { name: '測試研究班', category: '道務' }, date: '2025-03-07', entries: [{ name: '測試甲' }, { name: '測試乙', identity: '道親' }] }] });
  assert.equal(again.data.results[0].dutyId, id);
  assert.deepEqual([again.data.results[0].added, again.data.results[0].skipped], [1, ['測試甲']]);
  // 還原第二次：只取消測試乙，勤務還在
  const logs = () => call('adminLogs', { offset: 0, limit: 10 }).data.logs.filter((l) => l.action !== '還原' && /匯入出勤名單/.test(l.summary) && !l.restoredAt);
  assert.equal(logs()[0].undoLabel, '還原');
  assert.equal(call('adminRestore', { row: logs()[0].row, signupId: '' }).ok, true);
  assert.deepEqual(call('adminDuty', { id }).data.signups.map((s) => s.name).sort(), ['測試新人', '測試甲'].sort());
  // 還原第一次：名單取消，勤務是這次新增的，一起刪掉
  assert.equal(call('adminRestore', { row: logs()[0].row, signupId: '' }).ok, true);
  assert.equal(call('adminDutyForEdit', { id }).error.code, 'NOT_FOUND');
});
