// 教育的統計：以「課程」為單位（同名的多筆＝同一個課程，每個日期一堂）。
// 各課程學生量、各課程出缺勤表、各課程負責師資。純函式，不碰畫面；瀏覽器用 window.EduStats，Node 測試用 module.exports。
// 輸入：adminStats 的 eduSessions（每一堂，沒人報名的也有）與 events（每一場的出勤名單）。
// 學生＝報名的人（不含陪同）；出席＝報名預設出席，管理者改「未到」才算缺席。
(function () {
  'use strict';

  const strokeCompare = new Intl.Collator('zh-Hant-TW-u-co-stroke').compare;
  const splitTeachers = (t) => String(t || '').split(/[、，,\s]+/).filter(Boolean);
  // 每個類別算哪些性質、負責人員有哪些角色
  const NATURES = { 教育: ['課程'], 道務: ['課程', '法會', '會議'] };
  const ROLES = { 教育: [['teachers', '師資']], 道務: [['lecturers', '講師'], ['leaders', '帶班'], ['assistants', '助理帶班']] };
  const rolesOf = (s, category) => {
    const out = {};
    (ROLES[category] || ROLES['教育']).forEach(([k, label]) => { out[label] = splitTeachers(s[k]); });
    return out;
  };

  /**
   * inPeriod(date) → 是否在期間內。回傳
   *   courses: [{ name, sessions: [{ date, dutyId, teachers: [] }], students: [名字], grid: { 名字: { 'dutyId|date': '✓'|'✗' } },
   *               present, absent, avg, rate, teachers: [], perStudent: { 名字: 出席堂數 }, perSession: { key: 出席人數 } }]
   *   teachers: [{ name, total, courses: [{ name, count }] }]
   */
  function summarize(eduSessions, events, inPeriod, category) {
    category = category || '教育';
    const byKey = {};
    (events || []).forEach((e) => {
      if ((e.category || '勤務') === category) byKey[e.dutyId + '|' + e.date] = e;
    });
    const map = new Map();
    const course = (series, name) => {
      if (!map.has(series)) map.set(series, { name, nature: '', sessions: [], keys: new Set() });
      return map.get(series);
    };
    (eduSessions || []).filter((s) => (s.category || '教育') === category && inPeriod(s.date)).forEach((s) => {
      const c = course(s.series || s.name, s.name);
      if (!c.nature) c.nature = s.nature || '';
      const key = s.dutyId + '|' + s.date;
      if (c.keys.has(key)) return;
      c.keys.add(key);
      const roles = rolesOf(s, category);
      c.sessions.push({ key, date: s.date, dutyId: s.dutyId, roles, teachers: [...new Set([].concat(...Object.values(roles)))] });
    });
    // 堂次清單沒有、但有出勤資料的（例如舊資料性質不是課程）：只收教育的「課程」
    Object.values(byKey).filter((e) => NATURES[category].indexOf(e.nature) !== -1 && inPeriod(e.date)).forEach((e) => {
      const c = course(e.series || e.name, e.name);
      if (!c.nature) c.nature = e.nature || '';
      const key = e.dutyId + '|' + e.date;
      if (c.keys.has(key)) return;
      c.keys.add(key);
      const roles = rolesOf(e, category);
      c.sessions.push({ key, date: e.date, dutyId: e.dutyId, roles, teachers: [...new Set([].concat(...Object.values(roles)))] });
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
        name: c.name, nature: c.nature, sessions: c.sessions, students, grid, present, absent, perStudent, perSession, teachers,
        avg: c.sessions.length ? Math.round((present / c.sessions.length) * 10) / 10 : 0,
        rate: present + absent ? present / (present + absent) : null
      };
    }).sort((a, b) => b.students.length - a.students.length || strokeCompare(a.name, b.name));

    return { courses, teachers: teachersOf(courses) };
  }

  /**
   * 負責人員（只算給的這些課程）：[{ name, total（參與的堂數）, byRole: { 角色: 次數 }, courses: [{ name, count }] }]
   * 教育只有「師資」；道務分講師、帶班、助理帶班（看得出誰在學習帶班）。
   */
  function teachersOf(courses) {
    const map = new Map();
    courses.forEach((c) => c.sessions.forEach((s) => {
      const roles = s.roles || { 師資: s.teachers };
      const seen = new Set();
      Object.keys(roles).forEach((role) => roles[role].forEach((t) => {
        if (!map.has(t)) map.set(t, { name: t, total: 0, byRole: {}, cm: new Map() });
        const r = map.get(t);
        r.byRole[role] = (r.byRole[role] || 0) + 1;
        if (!seen.has(t)) { seen.add(t); r.total++; r.cm.set(c.name, (r.cm.get(c.name) || 0) + 1); }
      }));
    }));
    return [...map.values()].map((r) => ({ name: r.name, total: r.total, byRole: r.byRole, courses: [...r.cm.entries()].map(([n, count]) => ({ name: n, count })) }))
      .sort((a, b) => b.total - a.total || strokeCompare(a.name, b.name));
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

  const api = { summarize, gridText, splitTeachers, ranking, teachersOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.EduStats = api;
})();
