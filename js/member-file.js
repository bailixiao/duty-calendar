// 匯入成員資料：讀 Excel／Word／PDF／貼上的表格，自動找出姓名、佛堂、年齡（出生年）、身分、清口、國外（2026/11/22）。
// 全部在瀏覽器裡讀，檔案不會上傳；讀出來的只送「要更新的欄位」到後台（adminImportMembers）。
// 純函式（detect、toItems、parseBirth⋯）也給 node 測試用。
(function (root) {
  'use strict';

  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // 欄位：key、顯示名稱、表頭關鍵字
  const FIELDS = [
    ['name', '姓名', /姓\s*名|名\s*字|^名稱$|成員|人員|學員|^名$/],
    ['temple', '佛堂', /佛\s*堂|壇\s*名|所屬|道\s*場|^壇$|公\s*共/],
    ['age', '年齡', /年\s*齡|歲/],
    ['birth', '出生年', /出\s*生|生\s*日|生\s*年|年\s*次/],
    ['identity', '身分', /身\s*[分份]|職\s*稱|類\s*別/],
    ['vegetarian', '清口', /清\s*口|吃\s*素|素\s*食|茹素/],
    ['overseas', '國外', /國\s*外|地\s*區|國\s*家/],
    // 道二代、道三代（2026/11/22）：父親、母親分兩欄也可以
    ['parents', '父母', /父\s*母|家\s*長|父\s*親|母\s*親|爸|媽/],
    ['parents2', '父母（另一欄）', /父\s*母|家\s*長|父\s*親|母\s*親|爸|媽/],
    ['school', '學校', /學\s*校|就\s*讀|校\s*名/],
    ['interest', '興趣', /興\s*趣|專\s*長|嗜\s*好|才\s*藝/]
  ];
  const FIELD_KEYS = FIELDS.map((f) => f[0]);
  // 找表頭時先看父母（「父親姓名」不要被當成姓名）
  const DETECT_ORDER = FIELDS.filter((f) => /^parents/.test(f[0])).concat(FIELDS.filter((f) => !/^parents/.test(f[0])));

  // NFKC：PDF 常把「身、口、乙」讀成長得一樣的部首字（⾝、⼝、⼄），換回一般的字
  const clean = (v) => String(v == null ? '' : v).normalize('NFKC').replace(/[\s　]+/g, ' ').trim();
  const NAME_RE = /^[一-鿿]{2,4}$/;

  /** 身分：點傳師、壇辦（壇主、講師也算壇辦）、道親、未求道（新朋友） */
  function parseIdentity(v) {
    const s = clean(v);
    if (!s) return '';
    if (/點傳師/.test(s)) return '點傳師';
    if (/壇辦|壇主|講師|辦事員/.test(s)) return '壇辦';
    if (/未求道|新朋友|未入道/.test(s)) return '未求道';
    if (/道親|求道|已求道/.test(s)) return '道親';
    return '';
  }

  function parseVegetarian(v) {
    const s = clean(v);
    return /^(是|v|V|✓|✔|○|O|o|Y|y|yes|有|清口|全素|●|◎)$/.test(s);
  }

  function parseOverseas(v, options) {
    const s = clean(v);
    if (!s) return '';
    if (/大陸|中國|陸/.test(s) && options.indexOf('陸') !== -1) return '陸';
    const hit = options.find((o) => s.indexOf(o) !== -1);
    return hit || '';
  }

  /** 年齡：1～120 的數字（「65歲」也可以） */
  function parseAge(v) {
    const m = clean(v).match(/^(\d{1,3})\s*歲?$/);
    const n = m ? Number(m[1]) : NaN;
    return n >= 1 && n <= 120 ? n : null;
  }

  /**
   * 出生年 → 西元年：1965、1965/3/2、1965-03-02、民國54年、54、54.03.02、054/03/02、Date、Excel 日期序號。
   * 兩三位數當民國年。thisYear 給測試用。
   */
  function parseBirth(v, thisYear) {
    thisYear = thisYear || new Date().getFullYear();
    if (v instanceof Date && !isNaN(v)) return v.getFullYear();
    if (typeof v === 'number' && v > 3000 && v < 60000) { // Excel 日期序號（1900 起算）
      return new Date(Math.round((v - 25569) * 86400000)).getUTCFullYear();
    }
    const s = clean(v).replace(/^民國\s*/, '');
    let m = s.match(/^(\d{4})(?:\D|$)/);
    if (m) { const y = Number(m[1]); return y > 1900 && y <= thisYear ? y : null; }
    m = s.match(/^(\d{2,3})(?:\s*年|[./\-]|$)/);
    if (m) { const y = Number(m[1]) + 1911; return y > 1900 && y <= thisYear ? y : null; }
    return null;
  }

  /** 生日的月日 →「MM-dd」（2026/11/23，選填）：Date、Excel 序號、1965/3/2、54.03.02、1965-03-02；只有年就回 '' */
  function parseMonthDay(v) {
    const two = (n) => String(n).padStart(2, '0');
    if (v instanceof Date && !isNaN(v)) return two(v.getMonth() + 1) + '-' + two(v.getDate());
    if (typeof v === 'number' && v > 3000 && v < 60000) { const d = new Date(Math.round((v - 25569) * 86400000)); return two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate()); }
    const s = clean(v).replace(/^民國\s*/, '').replace(/\s/g, '');
    const m = s.match(/^\d{2,4}\s*[年./\-]\s*(\d{1,2})\s*[月./\-]\s*(\d{1,2})日?$/);
    if (!m) return '';
    const mo = Number(m[1]), d = Number(m[2]);
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? two(mo) + '-' + two(d) : '';
  }

  /** 找表頭那一列：前 15 列裡，有「姓名」又最多欄位對得上的 */
  function findHeader(rows) {
    let best = null;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const map = {};
      let hits = 0;
      (rows[i] || []).forEach((cell, c) => {
        const t = clean(cell && cell.text !== undefined ? cell.text : cell);
        if (!t || t.length > 12) return;
        if (/電話|手機|地址|信箱|e-?mail|line/i.test(t)) return; // 家長電話、地址不要對到父母（也不會匯入）
        const f = DETECT_ORDER.find(([k, , re]) => map[k] === undefined && re.test(t));
        if (f) { map[f[0]] = c; hits++; }
      });
      if (map.name !== undefined && (!best || hits > best.hits)) best = { index: i, map, hits };
    }
    return best;
  }

  /** 沒有表頭：看內容猜（姓名＝大多是兩到四個中文字的欄，身分、年齡也看內容） */
  function guessColumns(rows) {
    const width = Math.max(0, ...rows.map((r) => r.length));
    const map = {};
    const score = (c, test) => {
      let n = 0, filled = 0;
      rows.forEach((r) => { const t = clean(r[c]); if (!t) return; filled++; if (test(r[c])) n++; });
      return filled >= 2 ? n / filled : 0;
    };
    let bestName = -1, bestScore = 0.6;
    for (let c = 0; c < width; c++) {
      const s = score(c, (v) => NAME_RE.test(clean(v)) && !parseIdentity(v));
      if (s > bestScore) { bestScore = s; bestName = c; }
    }
    if (bestName === -1) return null;
    map.name = bestName;
    for (let c = 0; c < width; c++) {
      if (c === bestName) continue;
      if (map.identity === undefined && score(c, (v) => !!parseIdentity(v)) > 0.6) map.identity = c;
      else if (map.age === undefined && map.birth === undefined && score(c, (v) => parseAge(v) !== null) > 0.8) map.age = c;
      else if (map.temple === undefined && score(c, (v) => /佛堂|壇|公共/.test(clean(v))) > 0.6) map.temple = c;
    }
    return { index: -1, map };
  }

  /** 表頭判斷：{ index（表頭列，-1＝沒有表頭）, map: { name: 欄, ... }, headers: [每欄名稱] } */
  function detect(rows) {
    const h = findHeader(rows) || guessColumns(rows);
    if (!h) return null;
    const width = Math.max(0, ...rows.map((r) => r.length));
    const headers = [];
    for (let c = 0; c < width; c++) {
      const t = h.index >= 0 ? clean(rows[h.index][c]) : '';
      headers.push(t ? `第${c + 1}欄「${t}」` : `第${c + 1}欄`);
    }
    // 年齡、出生年只用一個；表頭寫「出生」但內容是兩三位數小的⋯照出生年（民國）算
    return { index: h.index, map: h.map, headers };
  }

  /** 依對應表轉成 adminImportMembers 的 items；同名同佛堂只留一筆 */
  function toItems(rows, det, opts) {
    opts = opts || {};
    const overseasOptions = opts.overseas || ['陸', '韓國'];
    const thisYear = opts.thisYear;
    const map = det.map;
    const seen = new Set();
    const out = [];
    rows.forEach((r, i) => {
      if (i <= det.index) return;
      const get = (k) => (map[k] === undefined || map[k] === '' ? '' : r[map[k]]);
      let name = clean(get('name')).replace(/[(（][^)）]*[)）]/g, '').replace(/^\d+[.、)）]?\s*/, '').replace(/\s+/g, '');
      if (!name || name.length > 20 || /^(姓名|名字|合計|總計|小計)$/.test(name) || /^\d+$/.test(name)) return;
      const it = { name };
      const temple = clean(get('temple'));
      if (temple) it.temple = temple;
      const age = parseAge(get('age'));
      if (age !== null) it.age = age;
      const by = map.birth !== undefined ? parseBirth(get('birth'), thisYear) : null;
      if (by) it.birthYear = by;
      const md = map.birth !== undefined ? parseMonthDay(get('birth')) : '';
      if (md) it.birthday = md;
      const id = parseIdentity(get('identity'));
      if (id) it.identity = id;
      if (map.vegetarian !== undefined && parseVegetarian(get('vegetarian'))) it.vegetarian = true;
      const ov = parseOverseas(get('overseas'), overseasOptions);
      if (ov) it.overseas = ov;
      const ps = [get('parents'), get('parents2')].map(clean).join('、').split(/[、，,;；/／\s]+/).map((p) => p.replace(/[(（][^)）]*[)）]/g, '')).filter((p) => p && p !== name);
      if (ps.length) it.parents = ps.filter((p, k) => ps.indexOf(p) === k);
      const school = clean(get('school'));
      if (school) it.school = school;
      const interest = clean(get('interest'));
      if (interest) it.interest = interest;
      const key = name + '|' + (it.temple || '');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(it);
    });
    return out;
  }

  // ---------- 讀檔 ----------

  /** Word 的 document.xml → 表格（每列每格的文字）；表格外的段落用 tab／兩個以上空白切 */
  function docxXmlToTables(xml) {
    const text = (s) => s.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, ' ').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const tables = [];
    const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
      const rows = (tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map((tr) =>
        (tr.match(/<w:tc>[\s\S]*?<\/w:tc>|<w:tc [\s\S]*?<\/w:tc>/g) || []).map((tc) =>
          (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((p) => clean(text(p))).filter(Boolean).join(' ')));
      if (rows.length) tables.push(rows);
      return '';
    });
    const lines = (body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((p) => text(p)).filter((l) => clean(l));
    if (lines.length) tables.push(lines.map((l) => l.split(/\t|\s{2,}|　+/).map(clean).filter(Boolean)));
    return tables;
  }

  /**
   * PDF 的文字片段 → 列：同一高度（y 差 3 以內）同一列；同一列裡隔比較開的分成不同格。
   * items: [{ str, x, y, w }]（同一頁）。回傳每格 { text, x }（x＝格子中間），之後依表頭的位置對欄。
   */
  function pdfItemsToRows(items) {
    const lines = [];
    items.filter((it) => clean(it.str)).sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
      let line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
      if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push(it);
    });
    return lines.sort((a, b) => b.y - a.y).map((l) => {
      const cells = [];
      l.items.sort((a, b) => a.x - b.x).forEach((it) => {
        const last = cells[cells.length - 1];
        const h = it.h || 10;
        if (last && it.x - last.end < h * 0.8) { last.text += it.str; last.end = Math.max(last.end, it.x + it.w); }
        else cells.push({ text: it.str, start: it.x, end: it.x + it.w });
      });
      return cells.map((c) => ({ text: clean(c.text), x: (c.start + c.end) / 2 }));
    });
  }

  /** PDF：有表頭時，每格依位置放到最近的表頭欄（空格不會讓後面的欄位跑掉） */
  function alignByHeader(rows, headerIndex) {
    const head = rows[headerIndex];
    if (!head || !head.length || head[0].x === undefined) return rows.map((r) => r.map((c) => (c && c.text !== undefined ? c.text : c)));
    const xs = head.map((c) => c.x);
    return rows.map((r, i) => {
      if (i <= headerIndex) return r.map((c) => c.text);
      const out = new Array(xs.length).fill('');
      r.forEach((c) => {
        let best = 0;
        xs.forEach((x, k) => { if (Math.abs(x - c.x) < Math.abs(xs[best] - c.x)) best = k; });
        out[best] = out[best] ? out[best] + ' ' + c.text : c.text;
      });
      return out;
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入讀檔工具，請檢查網路'));
      document.head.appendChild(s);
    });
  }
  const sheetJs = () => (root.XLSX ? Promise.resolve() : loadScript(SHEETJS));
  const pdfJs = () => (root.pdfjsLib ? Promise.resolve() : loadScript(PDFJS)).then(() => { root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; });

  /** 讀一個檔案 → [{ label, rows }]（rows：每列每格的文字；PDF 已經依表頭對齊） */
  async function readFile(file) {
    const name = file.name || '檔案';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const buf = await file.arrayBuffer();
    if (['xlsx', 'xls', 'xlsm', 'csv', 'ods'].indexOf(ext) !== -1) {
      await sheetJs();
      const wb = root.XLSX.read(buf, { type: 'array', cellDates: true });
      return wb.SheetNames.map((sn) => ({
        label: wb.SheetNames.length > 1 ? `${name}（${sn}）` : name,
        rows: root.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' })
      })).filter((s) => s.rows.length);
    }
    if (ext === 'docx') {
      await sheetJs();
      const zip = root.XLSX.CFB.read(new Uint8Array(buf), { type: 'array' });
      const di = zip.FullPaths.findIndex((p) => /(^|\/)word\/document\.xml$/i.test(p)); // 路徑前面會有「Root Entry/」
      const doc = di === -1 ? null : zip.FileIndex[di];
      if (!doc) throw new Error(`「${name}」看起來不是 Word 檔`);
      const xml = new TextDecoder('utf-8').decode(doc.content);
      return docxXmlToTables(xml).map((rows, i, all) => ({ label: all.length > 1 ? `${name}（第 ${i + 1} 個表格）` : name, rows }));
    }
    if (ext === 'doc') throw new Error(`「${name}」是舊版 Word（.doc），請用 Word 打開後「另存新檔」成 .docx 再選`);
    if (ext === 'pdf') {
      await pdfJs();
      const pdf = await root.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      let rows = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        rows = rows.concat(pdfItemsToRows(tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height }))));
      }
      if (!rows.length) throw new Error(`「${name}」讀不到文字（可能是掃描的圖片），請改用 Excel／Word，或請 Claude 整理`);
      const h = findHeader(rows.map((r) => r.map((c) => c.text)));
      return [{ label: name, rows: alignByHeader(rows, h ? h.index : -1) }];
    }
    throw new Error(`「${name}」不是 Excel、Word 或 PDF 檔`);
  }

  /** 貼上的文字（從 Excel 複製的表格：tab 分欄；或一行一位） */
  function textToRows(text) {
    return String(text || '').split(/\r?\n/).filter((l) => clean(l)).map((l) => (l.indexOf('\t') !== -1 ? l.split('\t') : l.split(/\s{2,}|　+|,|，/)).map(clean));
  }

  const api = { loadPdfJs: pdfJs, loadSheetJs: sheetJs, FIELDS, FIELD_KEYS, parseIdentity, parseVegetarian, parseAge, parseBirth, parseMonthDay, parseOverseas, detect, toItems, docxXmlToTables, pdfItemsToRows, alignByHeader, readFile, textToRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemberFile = api;
})(typeof window !== 'undefined' ? window : globalThis);
