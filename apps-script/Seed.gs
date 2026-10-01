/**
 * 匯入規格第 12 節的初始勤務（115/10/1 起）。
 * 初一十五打掃與拜香輪值只到 116/2/20（115 年度結束）；彌勒山志工輪值依已公布的表排到 116/4/20。
 * 不含任何人名；成員與各組組員請管理者直接在 Sheet 填寫。
 *
 * 只能在「勤務」分頁沒有資料時執行，避免重複匯入。
 * 在 Apps Script 編輯器選 seedInitialDuties 後按「執行」。
 *
 * 時間慣例：單日勤務若結束時間早於或等於開始時間，代表跨到隔天（例如除夕值夜 21:00–08:00）。
 * 初一十五的國曆日期已用 lunar-javascript 換算，並與規格第 12 節打掃表核對過。
 */

var SEED_GROUPS = [
  ['打掃組', ['第1組', '第2組', '第3組', '第4組', '第5組', '青年組']],
  ['勤務了愿組', ['第1組', '第2組', '第3組', '第4組', '第5組']],
  ['拜香輪值組', ['第一組', '第二組', '第三組', '第四組', '第五組（青年組）']]
];

/** 總務派給教全區的勤務 */
var SEED_GENERAL = [
  {
    name: '捐血低碳蔬食推廣活動', nature: '支援', start: '2026-10-18',
    location: '樹林頭活動地', positions: [{ name: '支援' }]
  },
  {
    name: '志工團輪值：統班', nature: '勤務', start: '2026-10-24',
    location: '彌勒山', positions: [{ name: '志工' }]
  },
  {
    name: '12人小組輪值', nature: '勤務', start: '2026-11-08', end: '2026-11-15',
    startTime: '14:00', endTime: '14:00', location: '彌勒山',
    desc: '週日 14:00 交接。每天 10–12 人。值勤 SOP 另附。',
    positions: [
      { name: '烹飪', min: 4, max: 4 },
      { name: '清潔', min: 2, max: 4 },
      { name: '早上維安', slot: '早上', min: 2, max: 2 },
      { name: '晚上維安', slot: '晚上', min: 2, max: 2 }
    ]
  },
  {
    name: '烹飪團輪值：青少年班、高大班烹飪', nature: '烹飪', start: '2026-11-15',
    location: '彌勒山', positions: [{ name: '烹飪' }]
  },
  {
    name: '烹飪團輪值：統班烹飪', nature: '烹飪', start: '2026-12-27',
    location: '彌勒山', positions: [{ name: '烹飪' }]
  },
  {
    name: '志工團輪值：敦化班', nature: '勤務', start: '2027-01-01', end: '2027-01-03',
    location: '宏宗', positions: [{ name: '志工' }]
  },
  {
    name: '宏宗打蠟', nature: '勤務', start: '2027-01-31', startTime: '08:00',
    location: '宏宗', positions: [{ name: '打蠟', min: 1, max: 1 }]
  },
  {
    name: '除夕值夜', nature: '勤務', start: '2027-02-05', startTime: '21:00', endTime: '08:00',
    location: '厚德樓',
    desc: '21:00 至初一 08:00。3F 辭歲拜年執禮、守燈、接待、保安、早餐。',
    positions: [{ name: '值夜' }]
  }
];

/** 初一十五打掃：[國曆, 農曆, 宏宗負責組, 區中心負責組, 彌勒山母殿負責組, 宏宗是否大掃除] */
var SEED_CLEANING = [
  ['2026-10-10', '九月初一', '第3組', '第1組', '第2組', false],
  ['2026-10-24', '九月十五', '第4組', '第5組', '青年組', true],
  ['2026-11-09', '十月初一', '第2組', '青年組', '第3組', false],
  ['2026-11-23', '十月十五', '第5組', '第1組', '第4組', false],
  ['2026-12-09', '十一月初一', '第1組', '第2組', '第3組', false],
  ['2026-12-23', '十一月十五', '第4組', '青年組', '第5組', false],
  ['2027-01-08', '十二月初一', '第2組', '第1組', '第4組', false],
  ['2027-01-22', '十二月十五', '第3組', '青年組', '第1組', false],
  ['2027-02-06', '正月初一', '第5組', '第4組', '第2組', true],
  ['2027-02-20', '正月十五', '第4組', '第3組', '第5組', false]
];

var CLEANING_SCOPE = {
  '宏宗': '負責範圍：餐廳、資訊室地板、桌椅儲存區。',
  '區中心': '負責範圍：待確認。',
  '彌勒山母殿': '負責範圍：教全區負責拜墊。'
};

/** 彌勒山志工輪值：[國曆, 負責組] */
var SEED_VOLUNTEER = [
  ['2026-10-01', '第1組'], ['2026-10-13', '第2組'], ['2026-10-24', '第3組'],
  ['2026-11-05', '第4組'], ['2026-11-15', '第5組'], ['2026-11-28', '第1組'],
  ['2026-12-08', '第2組'], ['2026-12-20', '第3組'], ['2026-12-31', '第4組'],
  ['2027-01-12', '第5組'], ['2027-02-21', '第1組'], ['2027-03-07', '第2組'],
  ['2027-03-16', '第3組'], ['2027-03-28', '第4組'], ['2027-04-08', '第5組'],
  ['2027-04-20', '第1組']
];

/** 初一十五拜香輪值（公告型）：[國曆, 農曆, 輪值組, 是否大典]；十二月十五、正月初一無輪值組 */
var SEED_CLASS_DUTY = [
  ['2026-10-10', '九月初一', '第五組（青年組）', false],
  ['2026-10-24', '九月十五', '第五組（青年組）', true],
  ['2026-11-09', '十月初一', '第三組', false],
  ['2026-11-23', '十月十五', '第二組', false],
  ['2026-12-09', '十一月初一', '第四組', false],
  ['2026-12-23', '十一月十五', '第一組', true],
  ['2027-01-08', '十二月初一', '第二組', false],
  ['2027-02-20', '正月十五', '第一組', false]
];

var CLASS_DUTY_ITEMS = '工作項目：拜香執禮（服裝：白色 POLO 衫）、參獻駕執禮、準備拜墊、' +
  '經理及講師茶水毛巾與淨手毛巾及接待、課桌椅排列、課程結束後佛堂環境整理及垃圾處理、視聽。';

function seedInitialDuties() {
  if (dataRowCount_(SHEETS.DUTIES) > 0) {
    throw new Error('「勤務」分頁已有資料，為避免重複匯入已停止。');
  }

  var duties = [];

  SEED_GENERAL.forEach(function (d) {
    duties.push(d);
  });

  SEED_CLEANING.forEach(function (c) {
    var targets = [['宏宗', '宏宗', c[2]], ['區中心', '區中心', c[3]], ['彌勒山母殿', '彌勒山', c[4]]];
    targets.forEach(function (t) {
      var bigClean = t[0] === '宏宗' && c[5];
      duties.push({
        name: (bigClean ? '宏宗大掃除' : '初一十五打掃（' + t[0] + '）'),
        nature: '勤務', start: c[0], location: t[1],
        groupType: '打掃組', group: t[2],
        desc: '農曆' + c[1] + '。' + CLEANING_SCOPE[t[0]] + '組員實際打掃日期由組內自行協調。',
        positions: [{ name: '打掃' }]
      });
    });
  });

  SEED_VOLUNTEER.forEach(function (v) {
    duties.push({
      name: '彌勒山志工輪值', nature: '勤務', start: v[0], location: '彌勒山',
      groupType: '勤務了愿組', group: v[1],
      positions: [{ name: '志工', max: 2 }]
    });
  });

  SEED_CLASS_DUTY.forEach(function (c) {
    duties.push({
      name: c[1] + '拜香輪值' + (c[3] ? '（大典）' : ''), nature: '勤務', mode: '公告型',
      start: c[0], groupType: '拜香輪值組', group: c[2], attire: '白色 POLO 衫',
      desc: '農曆' + c[1] + '拜香開課。' + CLASS_DUTY_ITEMS,
      positions: []
    });
  });

  var dutyRows = [];
  var positionRows = [];
  duties.forEach(function (d) {
    var dutyId = newId_('D');
    dutyRows.push({
      '勤務ID': dutyId,
      '名稱': d.name,
      '性質': d.nature,
      '模式': d.mode || '報名型',
      '開始日': d.start,
      '結束日': d.end || d.start,
      '開始時間': d.startTime,
      '結束時間': d.endTime,
      '地點': d.location,
      '分組類型': d.groupType,
      '負責組': d.group,
      '服裝': d.attire,
      '說明': d.desc
    });
    d.positions.forEach(function (p) {
      positionRows.push({
        '了愿項目ID': newId_('P'),
        '勤務ID': dutyId,
        '了愿項目名稱': p.name,
        '時段': p.slot,
        '最少': p.min,
        '最多': p.max
      });
    });
  });

  appendRows_(SHEETS.DUTIES, dutyRows);
  appendRows_(SHEETS.POSITIONS, positionRows);
  seedGroups_();

  Logger.log('已匯入勤務 ' + dutyRows.length + ' 筆、了愿項目 ' + positionRows.length + ' 筆');
}

/** 只建立組名，組長、佐理、組員留空由管理者在 Sheet 填寫。分組分頁已有資料時略過。 */
function seedGroups_() {
  if (dataRowCount_(SHEETS.GROUPS) > 0) return;
  var rows = [];
  SEED_GROUPS.forEach(function (g) {
    g[1].forEach(function (groupName) {
      rows.push({ '分組類型': g[0], '組名': groupName });
    });
  });
  appendRows_(SHEETS.GROUPS, rows);
}
