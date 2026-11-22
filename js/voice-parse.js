// 🎤 用講的報名（2026/11/22）：把一句話（語音辨識出來的文字）拆成「哪一天、哪個勤務、哪個了愿項目、誰」。
// 不用 AI：用行事曆上的勤務名稱和日期比對，名字最後再到成員名單核對（voice.js）。node 測試也用這支。
(function (root) {
  'use strict';

  const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const WEEK = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

  /** 「十二」「二十三」「三十一」「十」→ 數字 */
  function cnNum(s) {
    if (/^\d+$/.test(s)) return Number(s);
    if (s.indexOf('十') === -1) return s.split('').reduce((n, c) => n * 10 + (CN[c] || 0), 0);
    const [a, b] = s.split('十');
    return (a ? CN[a] : 1) * 10 + (b ? CN[b] : 0);
  }

  /** 日期附近的中文數字換成阿拉伯數字（十二月十三號 → 12月13號）；全形數字換半形 */
  function normalize(text) {
    return String(text || '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[，。！？、,.!?\s]+/g, ' ')
      .replace(/([零〇一二兩三四五六七八九十]{1,3})(?=\s*(月|號|日|点|點))/g, (m, n) => String(cnNum(n)))
      .replace(/(月\s*)([零〇一二兩三四五六七八九十]{1,3})/g, (m, a, n) => a + cnNum(n))
      .trim();
  }

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };

  /** 找日期：回傳 { date, text（原文那一段） }；找不到回傳 null。today＝'YYYY-MM-DD' */
  function findDate(t, today) {
    let m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(號|日)?/) || t.match(/(\d{1,2})\s*[/／.]\s*(\d{1,2})/);
    if (m) {
      const y = Number(today.slice(0, 4));
      let d = `${y}-${pad(m[1])}-${pad(m[2])}`;
      if (d < today && addDays(today, -60) > d) d = `${y + 1}-${pad(m[1])}-${pad(m[2])}`; // 一月講十二月以前的⋯當明年
      return { date: d, text: m[0] };
    }
    m = t.match(/大後天|後天|明天|今天/);
    if (m) return { date: addDays(today, { 今天: 0, 明天: 1, 後天: 2, 大後天: 3 }[m[0]]), text: m[0] };
    m = t.match(/(這個?|本|下個?|下下個?)?\s*(禮拜|星期|週|周)\s*([一二三四五六日天])/);
    if (m) {
      const want = WEEK[m[3]];
      const now = parseIso(today).getDay();
      const nextWeek = /^下下/.test(m[1] || '') ? 2 : /^下/.test(m[1] || '') ? 1 : 0;
      // 週一開始算一週：這週的那天；已經過了就是下週。「下禮拜」＝下週那天
      const mon = addDays(today, -((now + 6) % 7));
      let d = addDays(mon, ((want + 6) % 7) + nextWeek * 7);
      if (!nextWeek && d < today) d = addDays(d, 7);
      return { date: d, text: m[0] };
    }
    m = t.match(/(\d{1,2})\s*(號|日)/); // 只講幾號：這個月，過了就下個月
    if (m) {
      const d0 = parseIso(today);
      let d = iso(new Date(d0.getFullYear(), d0.getMonth(), Number(m[1])));
      if (d < today) d = iso(new Date(d0.getFullYear(), d0.getMonth() + 1, Number(m[1])));
      return { date: d, text: m[0] };
    }
    return null;
  }

  const bigrams = (s) => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
  /** 勤務名稱和這句話有幾個「兩個字」一樣（括號裡的地點也算） */
  function nameScore(name, t) {
    const n = String(name).replace(/[\s()（）：:・]/g, '');
    if (!n) return 0;
    if (t.indexOf(n) !== -1) return n.length * 2; // 整個名稱都講到了
    return bigrams(n).filter((b) => t.indexOf(b) !== -1).length;
  }

  // 不是名字的字（拿掉後剩下的才當名字）
  // 單一個字只拿明顯不是名字的（「和、與、及、跟」可能是名字的一部分，留給 splitNames 判斷）
  const FILLER = /(我想要|我要|我想|想要|幫忙|幫我|報名|參加|一起|還有|以及|然後|我叫做|我叫|我是|名字是|名字叫|請問|謝謝|感恩|那一天|那天|當天|的時候|時候|可以嗎|好嗎|要去|也要|都要|兩個人|三個人|一個人|的|喔|啊|吧|嗎|呢|了)/g;

  /**
   * 解析一句話。duties：getEvents 的 duties（公告型不算）；today：'YYYY-MM-DD'。
   * 回傳 {
   *   date, dateText,
   *   options: [{ duty, date, score }]（最可能的排前面；只有一個＝確定）,
   *   position（了愿項目，講到才有）, nameChunks: [剩下的字串（可能好幾個名字黏在一起）], self（講「我」）
   * }
   */
  function parse(text, duties, today) {
    const t = normalize(text);
    const found = findDate(t, today);
    // 可以報名的那幾天
    const slots = [];
    (duties || []).forEach((d) => {
      if (d.mode === '公告型') return;
      Object.keys(d.days || {}).forEach((date) => { if (date > today) slots.push({ duty: d, date }); });
    });
    let pool = found ? slots.filter((s) => s.date === found.date) : slots;
    pool.forEach((s) => { s.score = nameScore(s.duty.name, t); });
    const top = Math.max(0, ...pool.map((s) => s.score));
    let options;
    if (top > 0) options = pool.filter((s) => s.score >= Math.max(1, top - 1)).sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
    else options = found ? pool.slice() : []; // 只講日期：那天的全部
    // 講的那天沒有這個勤務：改列這個勤務別天的（dateMiss，畫面會說「那天沒有」）
    let dateMiss = false;
    if (found && !options.some((o) => o.score > 0) && nameScore) {
      const all = slots.map((x) => Object.assign({}, x, { score: nameScore(x.duty.name, t) }));
      const top2 = Math.max(0, ...all.map((x) => x.score));
      if (top2 >= 2) { options = all.filter((x) => x.score >= top2 - 1).sort((a2, b2) => b2.score - a2.score || a2.date.localeCompare(b2.date)); dateMiss = true; }
    }
    // 同一個勤務好幾天、沒講日期：最近的那天排前面
    options = options.slice(0, 8);
    const best = options[0];
    // 了愿項目：選定的勤務有好幾項時，看有沒有講到
    let position = null;
    if (best && best.duty.positions && best.duty.positions.length > 1) {
      const hits = best.duty.positions.map((p) => ({ p, s: nameScore(p.name, t) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
      if (hits.length) position = hits[0].p;
    }
    // 名字：拿掉日期、勤務名稱裡講到的字、項目、贅字
    let rest = t;
    if (found) rest = rest.replace(found.text, ' ');
    if (best) {
      const n = best.duty.name.replace(/[\s()（）：:・]/g, '');
      // 句子裡和勤務名稱一樣的連續字（兩個字以上）拿掉
      for (let len = n.length; len >= 2; len--) {
        for (let i = 0; i + len <= n.length; i++) {
          const sub = n.slice(i, i + len);
          if (rest.indexOf(sub) !== -1) rest = rest.split(sub).join(' ');
        }
      }
    }
    if (position) rest = rest.split(position.name).join(' ');
    rest = rest.replace(/\d+\s*(位|個|點|點半)?/g, ' ').replace(/(禮拜|星期|週|周)[一二三四五六日天]?|下個?|這個?|今天|明天|後天|早上|下午|晚上|上午|中午|勤務|活動|班/g, ' ');
    const self = /(^|[^自])我(?!們)/.test(rest.replace(/我要|我想|幫我/g, ''));
    rest = rest.replace(FILLER, ' ').replace(/我們|我|自己/g, ' ');
    const nameChunks = rest.split(/[\s、，,]+/).map((x) => x.replace(/[^一-鿿·‧]/g, '')).filter((x) => x.length >= 2);
    return { text: t, date: found ? found.date : '', dateText: found ? found.text : '', dateMiss, options, position, nameChunks, self };
  }

  /**
   * 黏在一起的名字拆開（語音辨識常常不加標點：「蔡岩蘊陳美鑾」）：每段 2～4 個字，isName(段) 是 Promise<boolean>（到成員名單核對）。
   * 優先拆成名單上有的名字；拆不出來就照原樣回傳。
   */
  async function splitNames(chunk, isName) {
    if (chunk.length <= 4 && !(await isName(chunk) === false && /^..[和跟與及]..$/.test(chunk))) return [chunk];
    const memo = new Map();
    const ok = async (s) => { if (!memo.has(s)) memo.set(s, await isName(s)); return memo.get(s); };
    const best = new Map(); // 位置 → 從這裡到結尾最好的拆法 { names, hits }
    async function go(i) {
      if (i === chunk.length) return { names: [], hits: 0 };
      if (best.has(i)) return best.get(i);
      let pick = null;
      // 名字中間的「和、跟、與、及」可以跳過（蔡岩蘊和陳美鑾）
      if (i > 0 && '和跟與及'.indexOf(chunk[i]) !== -1) {
        const skip = await go(i + 1);
        if (skip && (!pick || skip.hits > pick.hits)) pick = { names: skip.names, hits: skip.hits + 0.5 };
      }
      for (const len of [3, 2, 4]) {
        if (i + len > chunk.length) continue;
        const piece = chunk.slice(i, i + len);
        const hit = await ok(piece);
        const tail = await go(i + len);
        if (!tail) continue;
        const cand = { names: [piece].concat(tail.names), hits: tail.hits + (hit ? 1 : 0) };
        if (!pick || cand.hits > pick.hits) pick = cand;
      }
      best.set(i, pick);
      return pick;
    }
    const r = await go(0);
    return r && r.hits ? r.names : [chunk];
  }

  const api = { normalize, findDate, parse, splitNames, nameScore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoiceParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
