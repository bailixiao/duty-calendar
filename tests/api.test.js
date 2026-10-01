// 整合測試：以記憶體模擬 SpreadsheetApp 等 Apps Script 服務，載入 apps-script/*.gs，
// 匯入初始資料後實際呼叫 doGet / doPost。
// 執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createEnv(fixedNow) {
  const sheets = {};
  function makeSheet(name) {
    const data = [];
    const sheet = {
      name,
      data,
      getLastRow: () => data.length,
      getRange(row, col, numRows = 1, numCols = 1) {
        return {
          getDisplayValues: () => Array.from({ length: numRows }, (_, i) =>
            Array.from({ length: numCols }, (_, j) => String((data[row - 1 + i] || [])[col - 1 + j] ?? ''))),
          setValues(values) {
            values.forEach((r, i) => {
              data[row - 1 + i] = data[row - 1 + i] || [];
              r.forEach((v, j) => { data[row - 1 + i][col - 1 + j] = v; });
            });
          }
        };
      }
    };
    sheets[name] = sheet;
    return sheet;
  }

  const clock = { now: fixedNow };
  const env = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null }),
      flush() {}
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate(date, tz, pattern) {
        const d = clock.now ? new Date(clock.now) : date;
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).formatToParts(d).map(p => [p.type, p.value]));
        return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
          .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Logger: { log() {} },
    console: { error() {}, log() {} }
  };

  const dir = path.join(__dirname, '..', 'apps-script');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.gs'));
  const source = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const names = Object.keys(env);
  const api = new Function(...names,
    source + '\nreturn { SHEETS, seedInitialDuties, doGet, doPost };')(...names.map(n => env[n]));

  Object.values(api.SHEETS).forEach(def => {
    const s = makeSheet(def.name);
    if (def.headers.length) s.data.push(def.headers.slice());
  });
  api.seedInitialDuties();

  return {
    sheets,
    clock,
    get(params) { return JSON.parse(api.doGet({ parameter: params }).text); },
    // 報名的 entries 沒寫身分的，預設「道親」
    post(body) {
      if (Array.isArray(body.entries)) body = { ...body, entries: body.entries.map(e => ({ identity: '道親', ...e })) };
      return this.postRaw(JSON.stringify(body));
    },
    postRaw(text) { return JSON.parse(api.doPost({ postData: { contents: text } }).text); }
  };
}

// 2026-10-01 10:00 台北時間 = 02:00 UTC
const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function findDuty(env, from, to, predicate) {
  return env.get({ action: 'getEvents', from, to }).data.duties.find(predicate);
}

test('ping 回傳台北時間的今天', () => {
  // 2026-10-01 23:30 UTC = 台北 10/2 07:30
  const env = createEnv(Date.UTC(2026, 9, 1, 23, 30));
  const r = env.get({ action: 'ping' });
  assert.equal(r.ok, true);
  assert.equal(r.data.today, '2026-10-02');
});

test('getEvents 回傳區間內勤務與每日人數，不含名字', () => {
  const env = createEnv(OCT_1);
  const r = env.get({ action: 'getEvents', from: '2026-11-01', to: '2026-11-30' });
  assert.equal(r.ok, true);
  const team = r.data.duties.find(d => d.name === '12人小組輪值');
  assert.equal(Object.keys(team.days).length, 8);
  assert.equal(team.positions.length, 4);
  assert.equal(team.days['2026-11-08'].shortage, 10);
  assert.ok(!JSON.stringify(r).includes('姓名'));
  const announce = r.data.duties.find(d => d.mode === '公告型');
  assert.deepEqual(announce.days, {});
});

test('getEvents 只截取區間內的天數', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-10', '2026-11-12', d => d.name === '12人小組輪值');
  assert.deepEqual(Object.keys(team.days), ['2026-11-10', '2026-11-11', '2026-11-12']);
});

test('getEvents 日期格式錯誤', () => {
  const env = createEnv(OCT_1);
  const r = env.get({ action: 'getEvents', from: '2026/11/01', to: '2026-11-30' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_REQUEST');
});

test('報名成功後，詳情頁看得到名字、人數更新、寫入操作紀錄', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const cook = team.positions.find(p => p.name === '烹飪');

  const r = env.post({
    action: 'signup', dutyId: team.id, positionId: cook.id, dates: ['2026-11-08', '2026-11-09'],
    entries: [{ name: ' 測試甲　' }, { name: '測試乙' }, { name: '測試丙', identity: '壇辦', accompany: true }]
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.created.length, 6);
  assert.equal(r.data.days['2026-11-08'].counts[cook.id], 2);

  const detail = env.get({ action: 'getDuty', id: team.id }).data;
  const names = detail.signups.filter(s => s.date === '2026-11-08').map(s => s.name).sort();
  assert.deepEqual(names, ['測試丙', '測試乙', '測試甲'].sort());
  assert.equal(detail.days['2026-11-08'].total, 2);
  assert.equal(env.sheets['操作紀錄'].data.length, 1 + 6);
  assert.match(env.sheets['操作紀錄'].data[1][3], /^測試甲（道親）｜2026-11-08｜12人小組輪值｜烹飪$/);
});

test('報名寫入身分欄（報名分頁最後一欄），操作紀錄含身分', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const r = env.post({
    action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'],
    entries: [{ name: '測試甲', identity: '壇辦' }, { name: '測試乙', identity: '壇辦', accompany: true }]
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const rows = env.sheets['報名'].data;
  assert.equal(rows[0][10], '身分');
  assert.deepEqual(rows.slice(1).map(x => [x[4], x[10], x[5]]), [['測試甲', '壇辦', '否'], ['測試乙', '壇辦', '是']]);
  assert.match(env.sheets['操作紀錄'].data[2][3], /^測試乙（壇辦・陪同）｜/);
});

test('沒選身分的報名被擋', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const r = env.postRaw(JSON.stringify({
    action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲' }]
  }));
  assert.equal(r.ok, false);
  assert.match(r.error.details[0].message, /請選擇身分/);
  assert.equal(env.sheets['報名'].data.length, 1);
});

test('同一勤務同一天報第二個崗位被擋，整批不寫入', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const [cook, clean] = team.positions;
  env.post({ action: 'signup', dutyId: team.id, positionId: cook.id, dates: ['2026-11-08'], entries: [{ name: '測試甲' }] });

  const before = env.sheets['報名'].data.length;
  const r = env.post({
    action: 'signup', dutyId: team.id, positionId: clean.id, dates: ['2026-11-08'],
    entries: [{ name: '測試乙' }, { name: '測試甲' }]
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.details[0].name, '測試甲');
  assert.equal(env.sheets['報名'].data.length, before);
});

test('不同勤務同一天可以各報一個', () => {
  const env = createEnv(OCT_1);
  const day = '2026-10-24';
  const duties = env.get({ action: 'getEvents', from: day, to: day }).data.duties.filter(d => d.mode === '報名型');
  assert.ok(duties.length >= 2);
  duties.slice(0, 2).forEach(d => {
    const r = env.post({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: [day], entries: [{ name: '測試甲' }] });
    assert.equal(r.ok, true, JSON.stringify(r.error));
  });
});

test('彌勒山志工輪值最多 2 人，第 3 人被擋，陪同仍可加', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const base = { action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'] };
  assert.equal(env.post({ ...base, entries: [{ name: '測試甲' }, { name: '測試乙' }] }).ok, true);
  const third = env.post({ ...base, entries: [{ name: '測試丙' }] });
  assert.equal(third.ok, false);
  assert.match(third.error.details[0].message, /已額滿/);
  assert.equal(env.post({ ...base, entries: [{ name: '測試丙', identity: '壇辦', accompany: true }] }).ok, true);
  assert.equal(findDuty(env, '2026-10-13', '2026-10-13', d => d.id === v.id).days['2026-10-13'].full, true);
});

test('今天的勤務可以報名，過去的不行（台北時間）', () => {
  const env = createEnv(OCT_1);
  const today = findDuty(env, '2026-10-01', '2026-10-01', d => d.name === '彌勒山志工輪值');
  const base = { action: 'signup', dutyId: today.id, positionId: today.positions[0].id, dates: ['2026-10-01'], entries: [{ name: '測試甲' }] };
  assert.equal(env.post(base).ok, true);

  // 台北 10/2 00:30（UTC 10/1 16:30）時，10/1 的勤務已過去
  env.clock.now = Date.UTC(2026, 9, 1, 16, 30);
  const r = env.post({ ...base, entries: [{ name: '測試乙' }] });
  assert.equal(r.ok, false);
  assert.match(r.error.details[0].message, /已經過去/);
});

test('公告型勤務：詳情回傳輪值組資訊，不能報名', () => {
  const env = createEnv(OCT_1);
  const groups = env.sheets['分組'].data;
  const row = groups.find(r => r[0] === '班輪值組' && r[1] === '第五組（青年組）');
  row[2] = '測試組長'; row[3] = '測試佐理'; row[4] = '測試甲、測試乙，測試丙';

  const a = findDuty(env, '2026-10-10', '2026-10-10', d => d.mode === '公告型');
  const detail = env.get({ action: 'getDuty', id: a.id }).data;
  assert.deepEqual(detail.groupInfo, {
    name: '第五組（青年組）', leader: '測試組長', assistant: '測試佐理', members: ['測試甲', '測試乙', '測試丙']
  });
  const r = env.post({ action: 'signup', dutyId: a.id, positionId: 'x', dates: ['2026-10-10'], entries: [{ name: '測試甲' }] });
  assert.equal(r.ok, false);
});

test('searchMembers 沒輸入字就不回傳任何名字', () => {
  const env = createEnv(OCT_1);
  env.sheets['成員'].data.push(['測試甲', '道親', '第1組', '', '', '', '是']);
  assert.deepEqual(env.get({ action: 'searchMembers' }).data.members, []);
  assert.deepEqual(env.get({ action: 'searchMembers', q: ' 　' }).data.members, []);
});

test('searchMembers 只回相符者的姓名與組別，略過停用者', () => {
  const env = createEnv(OCT_1);
  const m = env.sheets['成員'].data;
  m.push(['　測試甲 ', '道親', '第1組', '第2組', '第一組', '備註內容', '是']);
  m.push(['測試乙', '壇辦', '', '', '', '', '否']);
  m.push(['範例丙', '道親', '', '', '', '', '是']);
  const r = env.get({ action: 'searchMembers', q: '測試' });
  assert.deepEqual(r.data.members, [{ name: '測試甲', identity: '道親', groups: { '佛堂組': '第1組', '打掃組': '第2組', '班輪值組': '第一組' } }]);
  assert.ok(!JSON.stringify(r).includes('備註內容'));
});

test('searchMembers 負責組組員排最前面，最多 10 筆', () => {
  const env = createEnv(OCT_1);
  const m = env.sheets['成員'].data;
  for (let i = 0; i < 12; i++) m.push(['測試' + i, '道親', '第1組', '', '', '', '是']);
  m.push(['測試組員', '道親', '第3組', '', '', '', '是']);
  const r = env.get({ action: 'searchMembers', q: '測試', groupType: '佛堂組', group: '第3組' });
  assert.equal(r.data.members.length, 10);
  assert.equal(r.data.members[0].name, '測試組員');
});

test('未知 action 與錯誤 JSON', () => {
  const env = createEnv(OCT_1);
  assert.equal(env.get({ action: 'nope' }).error.code, 'BAD_REQUEST');
  assert.equal(env.post({ action: 'nope' }).error.code, 'BAD_REQUEST');
  const bad = env.postRaw('{not json');
  assert.equal(bad.error.code, 'BAD_REQUEST');
  assert.match(bad.error.message, /JSON/);
});
