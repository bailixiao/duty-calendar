// 執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名（測試甲、測試乙⋯），本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Rules.gs 不是 Node 模組，讀進來後在同一個 realm 執行（避免 vm 跨 realm 造成 deepEqual 失敗）
const rulesModule = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Rules.gs'), 'utf8'))(rulesModule);
const { normalizeName_, datesInRange_, parseLimit_, dayStatus_, validateSignup_ } = rulesModule.exports;

const duty = { '勤務ID': 'D1', '模式': '報名型', '開始日': '2026-11-08', '結束日': '2026-11-10' };
const positions = [
  { '了愿項目ID': 'P1', '勤務ID': 'D1', '了愿項目名稱': '烹飪', '最少': '4', '最多': '4' },
  { '了愿項目ID': 'P2', '勤務ID': 'D1', '了愿項目名稱': '清潔', '最少': '2', '最多': '' }
];

function signup(name, positionId, date, extra) {
  return Object.assign({ '姓名': name, '了愿項目ID': positionId, '日期': date, '陪同': '否', '狀態': '有效' }, extra);
}

// entries 沒寫身分的，預設「道親」
function req(overrides) {
  const r = Object.assign({
    duty, positions, signups: [], positionId: 'P1', dates: ['2026-11-08'],
    entries: [{ name: '測試甲' }], today: '2026-10-01'
  }, overrides);
  r.entries = r.entries.map((e) => Object.assign({ identity: '道親' }, e));
  return r;
}

test('normalizeName_ 去掉半形與全形空白', () => {
  assert.equal(normalizeName_('  測試甲　'), '測試甲');
  assert.equal(normalizeName_('　　測試 甲\t'), '測試 甲');
  assert.equal(normalizeName_(undefined), '');
});

test('datesInRange_ 含頭尾、可跨月', () => {
  assert.deepEqual(datesInRange_('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(datesInRange_('2027-02-05', '2027-02-05'), ['2027-02-05']);
  assert.deepEqual(datesInRange_('2026-11-08', '2026-11-15').length, 8);
});

test('parseLimit_ 空白代表不限', () => {
  assert.equal(parseLimit_(''), null);
  assert.equal(parseLimit_('2'), 2);
});

test('dayStatus_ 計算人數、缺人與額滿，陪同與已取消不計', () => {
  const signups = [
    signup('測試甲', 'P1', '2026-11-08'),
    signup('測試乙', 'P1', '2026-11-08', { '陪同': '是' }),
    signup('測試丙', 'P1', '2026-11-08', { '狀態': '已取消' }),
    signup('測試丁', 'P1', '2026-11-09'),
    signup('測試戊', 'P2', '2026-11-08')
  ];
  const s = dayStatus_(positions, signups, '2026-11-08');
  assert.equal(s.positions[0].count, 1);
  assert.equal(s.positions[0].shortage, 3);
  assert.equal(s.positions[1].count, 1);
  assert.equal(s.positions[1].shortage, 1);
  assert.equal(s.total, 2);
  assert.equal(s.shortage, 4);
  assert.equal(s.full, false);
});

test('dayStatus_ 所有了愿項目都額滿才算額滿；有不限人數了愿項目就不會額滿', () => {
  const p = [{ '了愿項目ID': 'P9', '了愿項目名稱': '志工', '最多': '2' }];
  const full = dayStatus_(p, [signup('測試甲', 'P9', '2026-11-08'), signup('測試乙', 'P9', '2026-11-08')], '2026-11-08');
  assert.equal(full.full, true);
  const notFull = dayStatus_(positions, [], '2026-11-08');
  assert.equal(notFull.full, false);
});

test('正常報名，可一次報多人', () => {
  assert.deepEqual(validateSignup_(req({ entries: [{ name: '測試甲' }, { name: '測試乙' }] })), []);
});

test('勤務前一天可以報名；當天（含）之後不行（以傳入的台北日期判斷）', () => {
  assert.deepEqual(validateSignup_(req({ today: '2026-11-07' })), []);
  const sameDay = validateSignup_(req({ today: '2026-11-08' }));
  assert.equal(sameDay.length, 1);
  assert.match(sameDay[0].message, /勤務當天不能報名，請聯絡管理者/);
  const past = validateSignup_(req({ today: '2026-11-09' }));
  assert.match(past[0].message, /已經過去/);
});

test('多天勤務只擋當天和已過去的那幾天', () => {
  const errors = validateSignup_(req({ today: '2026-11-09', dates: ['2026-11-08', '2026-11-09', '2026-11-10'] }));
  assert.deepEqual(errors.map(e => e.date), ['2026-11-08', '2026-11-09']);
});

test('日期不在勤務期間內', () => {
  const errors = validateSignup_(req({ dates: ['2026-11-11'] }));
  assert.match(errors[0].message, /不在勤務期間/);
});

test('同一勤務同一天重複報另一個了愿項目會被擋，名字比對忽略全形空白', () => {
  const errors = validateSignup_(req({
    positionId: 'P2',
    entries: [{ name: '　測試甲 ' }],
    signups: [signup('測試甲', 'P1', '2026-11-08')]
  }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, '測試甲');
  assert.match(errors[0].message, /烹飪/);
});

test('同一勤務不同天可以各報一次', () => {
  const errors = validateSignup_(req({
    dates: ['2026-11-09'], signups: [signup('測試甲', 'P1', '2026-11-08')]
  }));
  assert.deepEqual(errors, []);
});

test('已取消的報名不算重複', () => {
  const errors = validateSignup_(req({
    signups: [signup('測試甲', 'P1', '2026-11-08', { '狀態': '已取消' })]
  }));
  assert.deepEqual(errors, []);
});

test('陪同者不受同日重複檢查限制', () => {
  const errors = validateSignup_(req({
    positionId: 'P2',
    entries: [{ name: '測試甲', identity: '壇辦', accompany: true }],
    signups: [signup('測試甲', 'P1', '2026-11-08')]
  }));
  assert.deepEqual(errors, []);
});

test('既有的陪同紀錄不會擋住同名者正式報名', () => {
  const errors = validateSignup_(req({
    signups: [signup('測試甲', 'P2', '2026-11-08', { '陪同': '是' })]
  }));
  assert.deepEqual(errors, []);
});

test('額滿會被擋', () => {
  const full = ['測試甲', '測試乙', '測試丙', '測試丁'].map(n => signup(n, 'P1', '2026-11-08'));
  const errors = validateSignup_(req({ entries: [{ name: '測試戊' }], signups: full }));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /已額滿/);
});

test('一次報多人超過剩餘名額，整批擋下並說明剩幾個', () => {
  const some = ['測試甲', '測試乙', '測試丙'].map(n => signup(n, 'P1', '2026-11-08'));
  const errors = validateSignup_(req({ entries: [{ name: '測試丁' }, { name: '測試戊' }], signups: some }));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /只剩 1 個名額，這次要報 2 人/);
});

test('陪同者不佔名額：額滿時仍可加陪同', () => {
  const full = ['測試甲', '測試乙', '測試丙', '測試丁'].map(n => signup(n, 'P1', '2026-11-08'));
  const errors = validateSignup_(req({ entries: [{ name: '測試戊', identity: '壇辦', accompany: true }], signups: full }));
  assert.deepEqual(errors, []);
});

test('陪同紀錄不計入既有人數', () => {
  const signups = ['測試甲', '測試乙', '測試丙'].map(n => signup(n, 'P1', '2026-11-08'))
    .concat([signup('測試己', 'P1', '2026-11-08', { '陪同': '是' })]);
  assert.deepEqual(validateSignup_(req({ entries: [{ name: '測試戊' }], signups })), []);
});

test('不限人數的了愿項目不會額滿', () => {
  const many = Array.from({ length: 30 }, (_, i) => signup('測試' + i, 'P2', '2026-11-08'));
  assert.deepEqual(validateSignup_(req({ positionId: 'P2', signups: many })), []);
});

test('同一批重複填同一個名字', () => {
  const errors = validateSignup_(req({ positionId: 'P2', entries: [{ name: '測試甲' }, { name: '測試甲　' }] }));
  assert.match(errors[0].message, /名字重複填寫/);
});

test('每個名字都要選身分（壇辦／道親），陪同者也一樣', () => {
  assert.deepEqual(validateSignup_(req({ entries: [{ name: '測試甲', identity: '壇辦' }] })), []);
  const errors = validateSignup_(req({
    entries: [{ name: '測試甲', identity: undefined }, { name: '測試乙', identity: '其他' }, { name: '測試丙', identity: undefined, accompany: true }]
  }));
  assert.deepEqual(errors.map(e => e.name), ['測試甲', '測試乙', '測試丙']);
  assert.match(errors[0].message, /請選擇身分/);
});

test('只有壇辦可以選陪同', () => {
  assert.deepEqual(validateSignup_(req({ entries: [{ name: '測試甲', identity: '壇辦', accompany: true }] })), []);
  const errors = validateSignup_(req({ entries: [{ name: '測試乙', identity: '道親', accompany: true }] }));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /只有壇辦可以選「陪同」/);
});

test('空白名字、未選了愿項目、公告型勤務', () => {
  assert.match(validateSignup_(req({ entries: [{ name: '　' }] }))[0].message, /不可空白/);
  assert.match(validateSignup_(req({ entries: [] }))[0].message, /請填寫名字/);
  assert.match(validateSignup_(req({ positionId: 'PX' }))[0].message, /請選擇了愿項目/);
  assert.match(validateSignup_(req({ duty: Object.assign({}, duty, { '模式': '公告型' }) }))[0].message, /公告型/);
  assert.match(validateSignup_(req({ duty: undefined }))[0].message, /找不到/);
});

test('最少留空預設 2 人；最多小於 2 時以最多為準；有填照填', () => {
  const { effectiveMin_ } = rulesModule.exports;
  assert.equal(effectiveMin_({ '最少': '', '最多': '' }), 2);
  assert.equal(effectiveMin_({ '最少': '', '最多': '1' }), 1);
  assert.equal(effectiveMin_({ '最少': '', '最多': '4' }), 2);
  assert.equal(effectiveMin_({ '最少': '3', '最多': '' }), 3);
  assert.equal(effectiveMin_({ '最少': '0', '最多': '' }), 0);
});

test('dayStatus_：不限人數的了愿項目不到 2 人算缺人，2 人以上不缺', () => {
  const open = [{ '了愿項目ID': 'P9', '了愿項目名稱': '打掃', '最少': '', '最多': '' }];
  assert.equal(dayStatus_(open, [], '2026-10-10').shortage, 2);
  assert.equal(dayStatus_(open, [signup('測試甲', 'P9', '2026-10-10')], '2026-10-10').shortage, 1);
  const two = [signup('測試甲', 'P9', '2026-10-10'), signup('測試乙', 'P9', '2026-10-10')];
  assert.equal(dayStatus_(open, two, '2026-10-10').shortage, 0);
  // 陪同不算人數
  const withAccompany = [signup('測試甲', 'P9', '2026-10-10'), signup('測試乙', 'P9', '2026-10-10', { '陪同': '是' })];
  assert.equal(dayStatus_(open, withAccompany, '2026-10-10').shortage, 1);
});

test('sameName_：三個字以上去掉第一個字，有連續兩個字相同就視為同一人', () => {
  const { sameName_ } = rulesModule.exports;
  assert.equal(sameName_('小明', '王小明'), true);
  assert.equal(sameName_('王小明', '林小明'), true);
  assert.equal(sameName_('測試甲', ' 測試甲　'), true);
  assert.equal(sameName_('測試甲', '測試乙'), false); // 只有姓相同不算
  assert.equal(sameName_('蔡甲', '蔡乙'), false);
  assert.equal(sameName_('甲', '甲乙'), false);
  assert.equal(sameName_('甲', '甲'), true);
});

test('名字相近視為同一人：同一勤務同一天被擋，同一批也不能重複填', () => {
  const errors = validateSignup_(req({
    positionId: 'P2', entries: [{ name: '試甲' }], signups: [signup('測試甲', 'P1', '2026-11-08')]
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /已有「測試甲」，視為同一人/);
  const batch = validateSignup_(req({ positionId: 'P2', entries: [{ name: '測試甲' }, { name: '試甲' }] }));
  assert.match(batch[0].message, /視為同一人，名字重複填寫/);
});

test('身分可選未求道；未求道不能陪同', () => {
  assert.deepEqual(validateSignup_(req({ entries: [{ name: '測試甲', identity: '未求道' }] })), []);
  const errors = validateSignup_(req({ entries: [{ name: '測試甲', identity: '未求道', accompany: true }] }));
  assert.match(errors[0].message, /只有壇辦可以選「陪同」/);
});
