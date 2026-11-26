/**
 * 從檔案帶入舊資料（2026/11/26，規格「從檔案帶入舊資料」）：給 AI 的提示。
 * 表格讀得懂的在瀏覽器裡直接讀（js/old-parse.js），讀不懂的（PDF、照片、沒有表頭的表格）才送 AI。
 * 呼叫 AI 在 Cloudflare（worker/src/hq.js adminOldImportAi），這裡只產生提示，方便測試。
 */

var OLD_IMPORT_MAX = 200; // 一批最多幾場

function oldImportPrompt_(hint, part, year) {
  var today = todayString_();
  var region = SITE.org || SITE.aiRegion || '本區';
  return [
    '你是' + region + '的資料整理助理。下面是以前的勤務、活動紀錄（可能是表格文字、PDF 的幾頁或照片），請把「每一場」整理成 JSON。' + (part ? '（這是' + part + '）' : ''),
    '今天是 ' + today + '（台灣時間）。這些是以前的紀錄。民國年請換成西元（民國 114 年 = 2025 年）。' +
      (year ? '表上沒寫年份時用 ' + year + ' 年。' : '表上沒寫年份時，看標題、檔名的年份；都沒有就填空字串，不要猜。'),
    '只輸出 JSON 陣列，每個元素是一場：',
    '{',
    '  "name": 勤務或活動名稱（照原文，例如「宏宗打掃」「中秋聯誼」；不要加日期）,',
    '  "category": "勤務"（打掃、輪值、支援、烹飪、場地佈置等工作）| "道務"（法會、開班、研究班、辦道、道務會議）| "教育"（兒童班、青少年班、讀書會、教育課程）,',
    '  "date": "yyyy-MM-dd"（這一場的日期）, "end": "yyyy-MM-dd"（連續好幾天才填，不然空字串）,',
    '  "startTime": "HH:mm", "endTime": "HH:mm"（沒寫就空字串）,',
    '  "location": 地點（沒寫就空字串）,',
    '  "people": [{ "name": 參加的人的名字（照原文，一格一個人）, "identity": 表上寫明是「壇辦」「道親」「點傳師」「未求道」才填，不然空字串 }],',
    '  "uncertain": [看不清楚或不確定的地方，用中文簡短說明，例如「第3個名字看不清楚」「日期的月份不確定」]',
    '}',
    '規則：',
    '- 同一個活動有好幾個日期：每個日期一筆，各自列那天的人。',
    '- 名字照原文抄，不要改字、不要合併、不要自己補；看不清楚的字照看到的寫，並寫進 uncertain。好幾個人寫在同一格要分開。',
    '- 不要抄電話、地址、身分證等其他個資；合計、小計、目錄、說明文字不要輸出。',
    '- 看不清楚的欄位填空字串，不要猜；最多輸出 ' + OLD_IMPORT_MAX + ' 筆。',
    hint ? '管理者補充說明：' + hint : ''
  ].filter(Boolean).join('\n');
}

/** AI 回來的一場 → 整理過的（欄位都是字串，名字去空白；格式不對的欄位清掉） */
function oldImportClean_(x) {
  var s = function (v, n) { return String(v === undefined || v === null ? '' : v).trim().slice(0, n || 60); };
  var date = /^\d{4}-\d{2}-\d{2}$/.test(s(x.date)) ? s(x.date) : '';
  var end = /^\d{4}-\d{2}-\d{2}$/.test(s(x.end)) && s(x.end) > date ? s(x.end) : '';
  var people = (Array.isArray(x.people) ? x.people : []).map(function (p) {
    var name = typeof p === 'string' ? p : p && p.name;
    var identity = p && typeof p === 'object' ? s(p.identity, 4) : '';
    return { name: normalizeName_(s(name, 20).replace(/[\s　]+/g, '')), identity: OPTIONS.identity.indexOf(identity) !== -1 ? identity : '' };
  }).filter(function (p) { return p.name; });
  return {
    name: s(x.name, 40), category: CATEGORIES.indexOf(s(x.category)) !== -1 ? s(x.category) : '',
    date: date, end: end, startTime: oldImportTime_(s(x.startTime)), endTime: oldImportTime_(s(x.endTime)),
    location: s(x.location, 40), people: people,
    uncertain: (Array.isArray(x.uncertain) ? x.uncertain : [x.uncertain]).map(function (u) { return s(u, 120); }).filter(Boolean).slice(0, 5)
  };
}

function oldImportTime_(v) {
  var t = cleanTime_(v);
  return /^\d{2}:\d{2}$/.test(t) ? t : '';
}
