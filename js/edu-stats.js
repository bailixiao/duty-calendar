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
   *               present, absent, expected（應到人次；教育＝學生從第一次來起每堂都算）, avg, rate, teachers: [], perStudent: { 名字: 出席堂數 }, perSession: { key: 出席人數 } }]
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
      // 應到（2026/11/27）：教育的課，班上的學生（這段期間來過的）從第一次來那堂起，每堂都算應到；沒來就算缺席。
      // 匯入的出席表只記有來的人，原本只用「改未到」的人算，出席率會一直是 100%。道務（法會、會議）照舊：出席÷（出席＋未到）。
      let expected = 0;
      // 那一堂完全沒有出席紀錄的不算（多半是還沒登記，不是全班都沒來）
      students.forEach((n) => { const first = c.sessions.findIndex((x) => grid[n][x.key]); if (first !== -1) expected += c.sessions.slice(first).filter((x) => perSession[x.key] > 0).length; });
      const teachers = [...new Set(c.sessions.flatMap((s) => s.teachers))];
      return {
        name: c.name, nature: c.nature, sessions: c.sessions, students, grid, present, absent, perStudent, perSession, teachers,
        avg: c.sessions.length ? Math.round((present / c.sessions.length) * 10) / 10 : 0,
        expected: category === '教育' ? expected : present + absent,
        rate: category === '教育' ? (expected ? present / expected : null) : present + absent ? present / (present + absent) : null
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

  /**
   * 各年齡層適合的班（2026/11/23）：依成員的出生年（學齡用 Family.schoolStage）分到讀經班、青少年班、高大班、青年班。
   * 讀經班＝幼兒園～國小 4 年級；青少年班＝國小 5 年級～國中；高大班＝高中、大學；青年班＝大學畢業～35 歲。
   */
  const AGE_CLASSES = [
    { name: '讀經班', range: '幼兒園～國小 4 年級', test: (st) => !!st && (st.stage === '幼兒園' || (st.stage === '國小' && st.grade <= 4)) },
    { name: '青少年班', range: '國小 5 年級～國中', test: (st) => !!st && ((st.stage === '國小' && st.grade >= 5) || st.stage === '國中') },
    { name: '高大班', range: '高中、大學', test: (st) => !!st && (st.stage === '高中' || st.stage === '大學') },
    { name: '青年班', range: '大學畢業～35 歲', test: (st, age) => !st && age !== '' && age >= 18 && age <= 35 }
  ];
  /**
   * members：成員名單（adminMembers；只算啟用中、不是待確認的）；courses：summarize 的課程（這段期間有來上課的人）；
   * stageOf(birthYear, today)：學齡。回傳
   *   classes: [{ name, range, people: [{ name, temple, label, attended }], attended: 這段期間來上這一班的人數, outside: [來上課但不在這個年齡的名字] }]
   *   preschool / older / unknown: [{ name, temple, label }]（學齡前、36 歲以上、還沒填生日）
   */
  function ageClasses(members, courses, today, stageOf) {
    const y = Number(String(today).slice(0, 4));
    const list = (members || []).filter((m) => m.active !== false && !m.pending && m.name);
    const byName = new Map();
    list.forEach((m) => { byName.set(m.name, m); (m.aliases || []).forEach((a) => { if (!byName.has(a)) byName.set(a, m); }); });
    const info = (m) => {
      const st = m.birthYear ? stageOf(m.birthYear, today) : null;
      const age = m.birthYear ? y - Number(m.birthYear) : '';
      return { m, st, age, label: st ? st.label : age !== '' ? age + ' 歲' : '' };
    };
    const all = list.map(info);
    const sortP = (a, b) => (a.age === '' ? 999 : a.age) - (b.age === '' ? 999 : b.age) || strokeCompare(a.m.name, b.m.name);
    const out = { classes: [], preschool: [], older: [], unknown: [] };
    const placed = new Set();
    AGE_CLASSES.forEach((k) => {
      const came = new Set();
      (courses || []).filter((c) => c.name.indexOf(k.name) !== -1).forEach((c) => c.students.forEach((n) => { const m = byName.get(n); came.add(m ? m.name : n); }));
      const fit = all.filter((p) => k.test(p.st, p.age)).sort(sortP);
      fit.forEach((p) => placed.add(p.m));
      out.classes.push({
        name: k.name, range: k.range,
        people: fit.map((p) => ({ name: p.m.name, temple: p.m.temple || '', label: p.label, attended: came.has(p.m.name) })),
        attended: came.size,
        outside: [...came].filter((n) => !fit.some((p) => p.m.name === n))
      });
    });
    all.filter((p) => !placed.has(p.m)).sort(sortP).forEach((p) => {
      const row = { name: p.m.name, temple: p.m.temple || '', label: p.label };
      if (p.age === '') out.unknown.push(row);
      else if (p.st && p.st.stage === '學齡前') out.preschool.push(row);
      else out.older.push(row);
    });
    return out;
  }

  /**
   * 一段期間的合計（2026/11/27，比上一期、去年同期用）：picked＝只看這幾個課程（空＝全部）。
   * 回傳 { courses, sessions, students, present, absent, expected, rate, hasData }；
   * rate：教育＝出席÷應到，道務＝出席÷（出席＋未到）。hasData＝這段期間有任何一堂。
   */
  function totals(eduSessions, events, inPeriod, category, picked) {
    category = category || '教育';
    const all = summarize(eduSessions, events, inPeriod, category).courses;
    const cs = picked && picked.length ? all.filter((c) => picked.indexOf(c.name) !== -1) : all;
    const present = cs.reduce((n, c) => n + c.present, 0);
    const absent = cs.reduce((n, c) => n + c.absent, 0);
    const expected = cs.reduce((n, c) => n + (c.expected || 0), 0);
    const sessions = cs.reduce((n, c) => n + c.sessions.length, 0);
    return {
      courses: cs.length, sessions, students: new Set(cs.flatMap((c) => c.students)).size, present, absent, expected,
      rate: category === '教育' ? (expected ? present / expected : null) : present + absent ? present / (present + absent) : null,
      hasData: sessions > 0
    };
  }

  const api = { summarize, totals, gridText, splitTeachers, ranking, teachersOf, ageClasses, AGE_CLASSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.EduStats = api;
})();
