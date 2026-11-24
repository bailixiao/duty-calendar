// 🔍 找可能重複的成員（2026/11/24）：成員名單裡寫法很像的兩位，可能是同一人（重複了，出勤次數被拆開算）。
//   純函式（Node 測試用 module.exports；瀏覽器 window.MemberDups）。合併用原本的「👥 這個人和另一位是同一人」（adminMergeMembers）。
//   同名但不同佛堂的是刻意分開的不同人，不列。
(function (root) {
  'use strict';

  const VARIANTS = [['藴', '蘊'], ['台', '臺'], ['峯', '峰'], ['綉', '繡'], ['群', '羣'], ['凃', '涂'], ['ㄧ', '一'], ['姍', '珊'], ['裡', '裏'], ['恒', '恆'], ['眞', '真'], ['衞', '衛'], ['銹', '鏽'], ['妳', '你']];
  const clean = (s) => String(s || '').replace(/[\s　·．.・]/g, '');
  const variantKey = (s) => VARIANTS.reduce((t, [a, b]) => t.split(a).join(b), clean(s));
  const sameTemple = (a, b) => !a.temple || !b.temple || a.temple === b.temple;
  const han = (s) => /^[㐀-鿿]+$/.test(s);

  /** 為什麼像：''＝不像 */
  function whyLike(a, b) {
    const x = clean(a.name), y = clean(b.name);
    if (!x || !y) return '';
    if (x === y) return a.name !== b.name ? '多了空白或符號' : (sameTemple(a, b) ? '名字一樣' : '');
    if (!sameTemple(a, b)) return '';
    if (variantKey(x) === variantKey(y)) return '異體字（例：台／臺）';
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    if (han(s) && han(l) && s.length >= 2 && s.length < l.length && l.length <= 4 && l.slice(-s.length) === s) return '一個有寫姓、一個沒寫';
    if (han(x) && han(y) && x.length === y.length && x.length >= 3 && x[0] === y[0]) {
      let diff = 0;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
      if (diff === 1) return '只差一個字（可能打錯字，也可能是不同人）';
    }
    return '';
  }

  /**
   * members：成員名單（adminMembers 的 members：{ row, name, temple, identity, aliases, pending, active }）
   * ignore：Set（「不是同一人」記過的 pairKey）。回傳 [{ a, b, why, key }]，越確定的排前面。
   */
  function find(members, ignore) {
    const list = members.filter((m) => m && m.name && !m.pending);
    const rank = (w) => (w.indexOf('只差一個字') === 0 ? 2 : w === '一個有寫姓、一個沒寫' ? 1 : 0);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const why = whyLike(a, b);
        if (!why) continue;
        const key = pairKey(a, b);
        if (ignore && ignore.has(key)) continue;
        out.push({ a, b, why, key });
      }
    }
    return out.sort((p, q) => rank(p.why) - rank(q.why) || (p.a.active === q.a.active ? 0 : p.a.active ? -1 : 1));
  }

  function pairKey(a, b) {
    return [`${a.name}|${a.temple || ''}`, `${b.name}|${b.temple || ''}`].sort().join('＋');
  }

  const api = { find, whyLike, pairKey, variantKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemberDups = api;
})(typeof window !== 'undefined' ? window : globalThis);
