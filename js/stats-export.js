// 統計匯出 Excel（後台「統計」的「⬇ 匯出 Excel」）：下載目前畫面上的類別與期間（.xlsx）。
// 用 SheetJS（cdnjs），按下按鈕才載入。名單只有姓名、身分、次數，不含電話。
(function () {
  'use strict';

  const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  let loading = null;

  function lib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = LIB;
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { loading = null; reject(new Error('Excel 元件載入失敗，請確認網路後再試一次')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  /** 工作表名稱：最多 31 字、不能有 []:*?/\ ，同名加編號 */
  function sheetName(wb, name) {
    let base = String(name).replace(/[[\]:*?/\\]/g, '・').slice(0, 28) || '工作表';
    let n = base;
    let i = 2;
    while (wb.SheetNames.indexOf(n) !== -1) n = base + '（' + (i++) + '）';
    return n;
  }

  function addSheet(X, wb, name, rows, widths) {
    const ws = X.utils.aoa_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, sheetName(wb, name));
  }

  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const safeFile = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '');

  /** 總務・勤務：摘要、出勤排行、每人各月、勤務明細 */
  async function general(ev, p, label) {
    const X = await lib();
    const C = window.StatsCalc;
    const s = C.summarize(ev, p);
    const wb = X.utils.book_new();
    addSheet(X, wb, '摘要', [
      [window.SITE.name + '　統計', label],
      ['期間', C.label(p)],
      ['出勤人次', s.total],
      ['道親佔比', s.ratio === null || s.ratio === undefined ? '' : Math.round(s.ratio * 1000) / 10 + '%'],
      ['道親人次', s.dao], ['壇辦人次', s.tan], ['未填身分人次', s.unknown || 0],
      ['場次', s.events], ['參與人數（不重複）', s.people],
      [], ['說明', '只算出席、非陪同的人；人次＝每場每人算一次；只算今天以前。']
    ], [18, 40]);
    const rank = C.ranking(ev, p, 'all');
    addSheet(X, wb, '出勤排行', [['名次', '姓名', '身分', '出勤次數'], ...rank.map((r, i) => [i + 1, r.name, r.identity || '', r.count])], [6, 14, 8, 10]);
    const details = C.eventsIn(ev, p);
    // 每人各月：期間跨好幾個月時才有意義
    const months = [...new Set(details.map((e) => e.date.slice(0, 7)))].sort();
    if (months.length > 1) {
      const per = new Map();
      details.forEach((e) => [...e.tan, ...e.dao, ...e.unknown].forEach((n) => {
        if (!per.has(n)) per.set(n, {});
        const m = per.get(n);
        m[e.date.slice(0, 7)] = (m[e.date.slice(0, 7)] || 0) + 1;
      }));
      const names = rank.map((r) => r.name).filter((n) => per.has(n));
      addSheet(X, wb, '每人各月', [['姓名', ...months.map((m) => Number(m.slice(5)) + '月'), '合計'],
        ...names.map((n) => { const m = per.get(n); const row = months.map((k) => m[k] || ''); return [n, ...row, row.reduce((a, b) => a + (b || 0), 0)]; })],
        [14, ...months.map(() => 6), 6]);
    }
    addSheet(X, wb, '勤務明細', [['日期', '名稱', '出席人數', '壇辦', '道親', '未填身分', '陪同'],
      ...details.map((e) => [e.date, e.name, e.tan.length + e.dao.length + e.unknown.length, e.tan.join('、'), e.dao.join('、'), e.unknown.join('、'), e.accompany.join('、')])],
      [11, 22, 8, 30, 30, 16, 16]);
    X.writeFile(wb, safeFile(`統計_${label}_${C.label(p)}`) + '.xlsx');
  }

  /** 道務、教育：總覽、每個課程的出缺勤表、負責人員 */
  async function edu(courses, teachers, L, cat, p) {
    const X = await lib();
    const C = window.StatsCalc;
    const wb = X.utils.book_new();
    const pct = (v) => (v === null ? '' : Math.round(v * 100) + '%');
    addSheet(X, wb, L.item + '總覽', [
      [`${window.SITE.name}　${cat}統計`, C.label(p)],
      [L.item, L.unit + '數', L.person + '人數', '平均每' + L.unit, '出席率', L.staff],
      ...courses.map((c) => [c.name, c.sessions.length, c.students.length, c.avg, pct(c.rate), c.teachers.join('、')])
    ], [22, 8, 10, 10, 8, 30]);
    courses.forEach((c) => {
      const head = ['姓名', ...c.sessions.map((s) => md(s.date)), '出席'];
      const rows = c.students.map((n) => [n, ...c.sessions.map((s) => c.grid[n][s.key] || ''), `${c.perStudent[n]}/${c.sessions.length}`]);
      const foot = ['每' + L.unit + '出席', ...c.sessions.map((s) => c.perSession[s.key]), ''];
      addSheet(X, wb, c.name, [[`${c.name}　出缺勤（✓出席 ✗未到）`], head, ...rows, foot], [14, ...c.sessions.map(() => 6), 8]);
    });
    if (teachers.length) {
      addSheet(X, wb, L.staff, [[L.staff, '共幾' + L.unit, '角色', L.item],
        ...teachers.map((t) => [t.name, t.total, Object.keys(t.byRole).map((k) => `${k} ${t.byRole[k]}`).join('・'), t.courses.map((c) => `${c.name} ${c.count}`).join('、')])],
        [14, 8, 24, 40]);
    }
    X.writeFile(wb, safeFile(`統計_${cat}_${C.label(p)}`) + '.xlsx');
  }

  window.StatsExport = { general, edu };
})();
