// 前處理（2026/11/27）：「從照片或檔案新增」讀 PDF、Word、Excel 時，程式先挑出跟本區有關的部分，再給 AI。
// 純函式，不碰畫面；瀏覽器用 window.RegionLines，Node 測試用 module.exports（tests/region-lines.test.js）。
// 規格見 docs/spec.md「從照片或檔案新增：程式先挑本區的行」。
//   - 分壇的年度分工表一頁有很多區（區別寫簡寫：「真全」「慈理捨全真」「( 全 )」）。
//     看得出是很多區的表（出現 8 個以上的區字），又完全沒有本區 → 這一頁不用給 AI（skip）。
//     有本區 → 只給表頭和有本區的那幾行（前 3 行、後 2 行一起，表格一格好幾行時區名和日期可能不在同一行）。
//   - 月曆（一行有「日 一 二 三 四 五 六」或「週日」，上面有「X 月份」）：格子固定是「幾號 區別」，程式直接讀，不用 AI。
//   - 其他（一般通知、看不出是哪幾區的）：整頁照舊給 AI。
(function (root) {
  'use strict';

  // 各區名稱（js/region.js、worker/src/regions.js 有一樣的清單；教全區沒有代號）
  const NAMES = ['教全區', '教真區', '教善區', '教美區', '教志區', '教孝區', '教仁區', '教勇區', '教定區', '教慧區', '教發區', '教慈區', '教捨區'];
  const shortOf = (name) => { const m = /^教(.)區$/.exec(String(name || '')); return m ? m[1] : ''; };
  const SHORTS = NAMES.map(shortOf);
  // 本區的字也常出現在一般的詞裡（只影響「要不要跳過」：誤以為有本區只會多給 AI 一點，不會漏）
  const COMMON = {
    全: /全球|全部|全年|全體|全家|全國|全力|全程|全天|全員|全面|全新|全心|安全|完全|健全|齊全|周全|保全/g,
    真: /認真|真的|真正|真心|真誠|真理|天真|真實/g,
    善: /改善|善心|善款|善良|完善|慈善|親善/g,
    美: /美食|美好|美麗|美化|完美|讚美|美術/g,
    志: /志工|志願|意志|同志|雜誌/g,
    孝: /孝順|孝道|孝心|孝親/g,
    仁: /仁愛|仁心|仁慈/g,
    勇: /勇敢|勇氣|英勇/g,
    定: /一定|決定|固定|確定|預定|規定|定期|定時|穩定|指定|安定|約定|訂定|定點/g,
    慧: /智慧|慧命|聰慧/g,
    發: /發心|發放|發送|發表|發起|發現|發生|出發|開發|發展|發揮|發票|發願/g,
    慈: /慈悲|慈善|慈愛|仁慈|慈心/g,
    捨: /捨不得|施捨|取捨|割捨/g
  };
  const strip = (s, ch) => (COMMON[ch] ? String(s).replace(COMMON[ch], '') : String(s));

  /** 這一行有沒有本區：寫全名，或簡寫（不算一般的詞，例「安全」的全） */
  function hasRegion(line, name) {
    const s = String(line || '');
    if (name && s.indexOf(name) !== -1) return true;
    const ch = shortOf(name);
    return !!ch && strip(s, ch).indexOf(ch) !== -1;
  }

  /** 這一頁出現幾個不同的區（全名或簡寫，不算一般的詞） */
  function regionCount(lines) {
    const text = lines.join('\n');
    return SHORTS.filter((ch) => strip(text, ch).indexOf(ch) !== -1).length;
  }

  /**
   * 一頁的行 → { kind, lines }
   *   kind：'skip'（很多區的表、沒有本區）、'part'（只留表頭和本區那幾行）、'all'（整頁）
   * opts = { before: 3, after: 2, head: 2 }（2026/11/27 用分工表量過：前 3 後 2 本區的日期都留得住，前 2 後 1 會漏掉一格好幾行的表）
   */
  function pick(lines, name, opts) {
    opts = opts || {};
    const ls = (lines || []).map((l) => String(l || '').trim()).filter(Boolean);
    if (!name || !shortOf(name) || ls.length < 4) return { kind: 'all', lines: ls };
    const multi = regionCount(ls) >= 8;
    if (!multi) return { kind: 'all', lines: ls };
    const keep = new Set();
    for (let i = 0; i < Math.min(opts.head === undefined ? 2 : opts.head, ls.length); i++) keep.add(i);
    let mine = 0;
    ls.forEach((l, i) => {
      if (!hasRegion(l, name)) return;
      mine++;
      for (let k = i - (opts.before === undefined ? 3 : opts.before); k <= i + (opts.after === undefined ? 2 : opts.after); k++) if (k >= 0 && k < ls.length) keep.add(k);
    });
    if (!mine) return { kind: 'skip', lines: [] };
    if (keep.size >= ls.length * 0.7) return { kind: 'all', lines: ls };
    return { kind: 'part', lines: ls.filter((l, i) => keep.has(i)) };
  }

  const pad = (n) => String(n).padStart(2, '0');

  /**
   * 月曆頁 → [{ date, text }]（本區那幾天，text 是那一格的區別）；不是月曆回傳 null
   *   月份：「115 年 1 月份」「2026年1月份」，沒寫年的「1 月份」用 year（西元）
   */
  function calendar(lines, name, year) {
    const ls = (lines || []).map((l) => String(l || ''));
    if (!ls.some((l) => /週日|星期日|(^|\s)日\s+一\s+二\s+三\s+四\s+五\s+六/.test(l))) return null;
    let mon = '';
    let months = 0;
    const out = [];
    ls.forEach((l) => {
      let m = /(\d{2,4})\s*年\s*(\d{1,2})\s*月份/.exec(l);
      if (m) { let y = Number(m[1]); if (y < 1911) y += 1911; mon = y + '-' + pad(m[2]); months++; return; }
      m = /(^|\s)(\d{1,2})\s*月份/.exec(l);
      if (m && year) { mon = year + '-' + pad(m[2]); months++; return; }
      if (!mon || /週日|星期日/.test(l)) return;
      const re = /(\d{1,2})\s*([^\d\s]+)/g; // 「1 真全 2 休息日」「1真全 2休息日」
      let c;
      while ((c = re.exec(l))) {
        const d = Number(c[1]);
        if (d >= 1 && d <= 31 && hasRegion(c[2], name)) out.push({ date: mon + '-' + pad(d), text: c[2].trim() });
      }
    });
    return months && out.length ? out : null; // 讀不到本區的格子：不是這種月曆，照舊給 AI
  }

  /** 中文字之間的空白拿掉、部首字換回一般的字（PDF 抽出來的字） */
  function tidy(s) {
    return String(s || '').normalize('NFKC').replace(/\s+/g, ' ').replace(/([㐀-鿿])\s+(?=[㐀-鿿])/g, '$1').trim();
  }

  const api = { NAMES, shortOf, hasRegion, regionCount, pick, calendar, tidy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RegionLines = api;
})(typeof window !== 'undefined' ? window : globalThis);
