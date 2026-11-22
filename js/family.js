// 道二代、道三代與學齡（2026/11/22）：成員的「父母」欄 → 第幾代；出生年 → 幼兒園、國小、國中、高中、大學。
// 都是自動算的，不另外存；node 測試也用這支。
(function (root) {
  'use strict';

  const IN_DAO = ['道親', '壇辦', '點傳師']; // 有求道的才算「道」的一代
  const GEN_LABEL = { 2: '道二代', 3: '道三代', 4: '道四代', 5: '道五代' };
  const STAGES = ['學齡前', '幼兒園', '國小', '國中', '高中', '大學'];

  /**
   * 學齡：依出生年和今天（台灣學年 9 月開始）推算。只有出生年，9 月以後出生的可能差一個年級。
   * 回傳 { stage: '國小', grade: 3, label: '國小 3 年級' }；成年（大學畢業後）或沒出生年回傳 null。
   */
  function schoolStage(birthYear, today) {
    const by = Number(birthYear);
    if (!by) return null;
    const d = today || new Date().toISOString().slice(0, 10);
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const acad = m >= 9 ? y : y - 1; // 這個學年是哪一年 9 月開始的
    const g = acad - by - 5; // 國小一年級＝學年開始時滿 6 歲
    if (g <= -4) return { stage: '學齡前', grade: 0, label: '學齡前' };
    if (g <= 0) return { stage: '幼兒園', grade: 0, label: '幼兒園' };
    if (g <= 6) return { stage: '國小', grade: g, label: `國小 ${g} 年級` };
    if (g <= 9) return { stage: '國中', grade: g - 6, label: `國中 ${g - 6} 年級` };
    if (g <= 12) return { stage: '高中', grade: g - 9, label: `高中 ${g - 9} 年級` };
    if (g <= 16) return { stage: '大學', grade: g - 12, label: `大學 ${g - 12} 年級` };
    return null;
  }

  /**
   * 每位成員是第幾代：父母（成員名單上、有求道的）最大的代數＋1；沒有父母在名單上＝第 1 代。
   * members: [{ name, aliases, identity, parents }]。回傳 Map(成員物件 → { gen, label, parents: [成員], children: [成員] })
   */
  function generations(members) {
    const byName = new Map();
    members.forEach((m) => {
      if (!byName.has(m.name)) byName.set(m.name, m);
      (m.aliases || []).forEach((a) => { if (!byName.has(a)) byName.set(a, m); });
    });
    const info = new Map();
    members.forEach((m) => info.set(m, { gen: 0, label: '', parents: [], children: [] }));
    members.forEach((m) => {
      (m.parents || []).forEach((p) => {
        const pm = byName.get(p);
        if (!pm || pm === m) return;
        info.get(m).parents.push(pm);
        info.get(pm).children.push(m);
      });
    });
    const visiting = new Set();
    const genOf = (m) => {
      const x = info.get(m);
      if (x.gen) return x.gen;
      if (visiting.has(m)) return 1; // 父母填成環：當第 1 代，不要當掉
      visiting.add(m);
      const ps = x.parents.filter((p) => IN_DAO.indexOf(p.identity) !== -1);
      x.gen = ps.length ? Math.max(...ps.map(genOf)) + 1 : 1;
      visiting.delete(m);
      return x.gen;
    };
    members.forEach((m) => { const x = info.get(m); genOf(m); x.label = GEN_LABEL[x.gen] || (x.gen > 5 ? `道${x.gen}代` : ''); });
    return info; // 用成員物件查（同名不同佛堂才不會混在一起）
  }

  const api = { schoolStage, generations, STAGES, IN_DAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Family = api;
})(typeof window !== 'undefined' ? window : globalThis);
