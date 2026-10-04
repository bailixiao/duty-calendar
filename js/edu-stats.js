// 教育的統計：以「課程」為單位（同名的多筆＝同一個課程，每個日期一堂）。
// 各課程學生量、各課程出缺勤表、各課程負責師資。純函式，不碰畫面；瀏覽器用 window.EduStats，Node 測試用 module.exports。
// 輸入：adminStats 的 eduSessions（每一堂，沒人報名的也有）與 events（每一場的出勤名單）。
// 學生＝報名的人（不含陪同）；出席＝報名預設出席，管理者改「未到」才算缺席。
(function () {
  'use strict';

  const strokeCompare = new Intl.Collator('zh-Hant-TW-u-co-stroke').compare;
  const splitTeachers = (t) => String(t || '').split(/[、，,\s]+/).filter(Boolean);

  /**
   * inPeriod(date) → 是否在期間內。回傳
   *   courses: [{ name, sessions: [{ date, dutyId, teachers: [] }], students: [名字], grid: { 名字: { 'dutyId|date': '✓'|'✗' } },
   *               present, absent, avg, rate, teachers: [], perStudent: { 名字: 出席堂數 }, perSession: { key: 出席人數 } }]
   *   teachers: [{ name, total, courses: [{ name, count }] }]
   */
  function summarize(eduSessions, events, inPeriod) {
    const byKey = {};
    (events || []).forEach((e) => {
      if ((e.category || '勤務') === '教育') byKey[e.dutyId + '|' + e.date] = e;
    });
    const map = new Map();
    const course = (series, name) => {
      if (!map.has(series)) map.set(series, { name, sessions: [], keys: new Set() });
      return map.get(series);
    };
    (eduSessions || []).filter((s) => inPeriod(s.date)).forEach((s) => {
      const c = course(s.series || s.name, s.name);
      const key = s.dutyId + '|' + s.date;
      if (c.keys.has(key)) return;
      c.keys.add(key);
      c.sessions.push({ key, date: s.date, dutyId: s.dutyId, teachers: splitTeachers(s.teachers) });
    });
    // 堂次清單沒有、但有出勤資料的（例如舊資料性質不是課程）：只收教育的「課程」
    Object.values(byKey).filter((e) => e.nature === '課程' && inPeriod(e.date)).forEach((e) => {
      const c = course(e.series || e.name, e.name);
      const key = e.dutyId + '|' + e.date;
      if (c.keys.has(key)) return;
      c.keys.add(key);
      c.sessions.push({ key, date: e.date, dutyId: e.dutyId, teachers: splitTeachers(e.teachers) });
    });

    const courses = [...map.values()].map((c) => {
      c.sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const grid = {};
      const perSession = {};
      let present = 0;
      let absent = 0;
      c.sessions.forEach((s) => {
        const e = byKey[s.key];
        const here = e ? [...e.tan, ...e.dao, ...e.unknown] : [];
        const away = e ? (e.absentNames || []).filter((n) => here.indexOf(n) === -1) : [];
        here.forEach((n) => { (grid[n] = grid[n] || {})[s.key] = '✓'; });
        away.forEach((n) => { (grid[n] = grid[n] || {})[s.key] = '✗'; });
        perSession[s.key] = here.length;
        present += here.length;
        absent += away.length;
      });
      const students = Object.keys(grid).sort(strokeCompare);
      const perStudent = {};
      students.forEach((n) => { perStudent[n] = Object.values(grid[n]).filter((v) => v === '✓').length; });
      const teachers = [...new Set(c.sessions.flatMap((s) => s.teachers))];
      return {
        name: c.name, sessions: c.sessions, students, grid, present, absent, perStudent, perSession, teachers,
        avg: c.sessions.length ? Math.round((present / c.sessions.length) * 10) / 10 : 0,
        rate: present + absent ? present / (present + absent) : null
      };
    }).sort((a, b) => b.students.length - a.students.length || strokeCompare(a.name, b.name));

    const tmap = new Map();
    courses.forEach((c) => c.sessions.forEach((s) => s.teachers.forEach((t) => {
      if (!tmap.has(t)) tmap.set(t, new Map());
      const m = tmap.get(t);
      m.set(c.name, (m.get(c.name) || 0) + 1);
    })));
    const teachers = [...tmap.entries()].map(([name, m]) => ({
      name,
      total: [...m.values()].reduce((a, b) => a + b, 0),
      courses: [...m.entries()].map(([n, count]) => ({ name: n, count }))
    })).sort((a, b) => b.total - a.total || strokeCompare(a.name, b.name));

    return { courses, teachers };
  }

  /**
   * 學生出席排行：[{ name, count（出席堂數）, absent（未到）, byCourse: [{ name, count }] }]
   * only：只算這個課程（課程名稱）；空白＝全部課程。出席多的在前，同次數未到少的在前，再依筆劃。
   */
  function ranking(courses, only) {
    const map = new Map();
    courses.filter((c) => !only || c.name === only).forEach((c) => {
      c.students.forEach((n) => {
        const here = Object.values(c.grid[n]).filter((v) => v === '✓').length;
        const away = Object.values(c.grid[n]).filter((v) => v === '✗').length;
        if (!map.has(n)) map.set(n, { name: n, count: 0, absent: 0, byCourse: [] });
        const r = map.get(n);
        r.count += here;
        r.absent += away;
        if (here) r.byCourse.push({ name: c.name, count: here });
      });
    });
    return [...map.values()].sort((a, b) => b.count - a.count || a.absent - b.absent || strokeCompare(a.name, b.name));
  }

  /** 出缺勤表轉成 Tab 分隔的文字（貼到試算表或 LINE） */
  function gridText(c) {
    const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    const head = ['姓名', ...c.sessions.map((s) => md(s.date)), '出席'].join('\t');
    const rows = c.students.map((n) => [n, ...c.sessions.map((s) => c.grid[n][s.key] || ''), `${c.perStudent[n]}/${c.sessions.length}`].join('\t'));
    const foot = ['每堂出席', ...c.sessions.map((s) => c.perSession[s.key]), ''].join('\t');
    return [`【${c.name}】出缺勤表（✓出席 ✗未到）`, head, ...rows, foot].join('\n');
  }

  const api = { summarize, gridText, splitTeachers, ranking };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.EduStats = api;
})();
