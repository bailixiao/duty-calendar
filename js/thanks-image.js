// 了愿感謝狀（2026/11/15）：依職司表名單，全部了愿的人畫成一張圖（姓名、職司、日期、天數），後台按一下存圖片傳 LINE。
// 只算有效報名；後台改成「未到」的不列入。陪同的人職司後面寫（陪同）。
(function () {
  'use strict';

  const W = 1080;
  const PAD = 70;
  const ROW = 56;
  const C = { paper: '#fbf5e9', gold: '#b8862b', red: '#a8322d', ink: '#2b2118', muted: '#7a6a5a', head: '#23476b', band: '#f3e9d6', line: '#e2d3b8' };
  const SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  const SERIF = '"Noto Serif TC", "Songti TC", "PMingLiU", "MingLiU", serif';
  const COLS = [ // 姓名、職司、日期、天數（加起來＝W - PAD*2）
    { key: 'name', title: '姓名', w: 200 },
    { key: 'pos', title: '職司', w: 230 },
    { key: 'dates', title: '日期', w: 410 },
    { key: 'days', title: '天數', w: 100 }
  ];

  const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);

  /** 連續的日期合成一段：11/8–11/10、11/12 */
  function dateRanges(dates) {
    const list = [...dates].sort();
    const out = [];
    let from = null;
    let prev = null;
    list.forEach((d) => {
      if (prev && dayNum(d) - dayNum(prev) === 1) { prev = d; return; }
      if (from) out.push(from === prev ? md(from) : `${md(from)}–${md(prev)}`);
      from = d;
      prev = d;
    });
    if (from) out.push(from === prev ? md(from) : `${md(from)}–${md(prev)}`);
    return out.join('、');
  }

  /** 名單整理成一人一列 */
  function rows(d) {
    const order = {};
    (d.positions || []).forEach((p, i) => { order[p.id] = i; });
    const posName = {};
    (d.positions || []).forEach((p) => { posName[p.id] = p.name; });
    const people = new Map();
    (d.signups || []).forEach((s) => {
      if (s.attend === '未到' || !s.name) return;
      const name = String(s.name).replace(/[\s　]+/g, '');
      if (!people.has(name)) people.set(name, { name, dates: new Set(), pos: new Map(), shifts: 0 });
      const p = people.get(name);
      p.dates.add(s.date);
      p.shifts += 1;
      const label = (posName[s.positionId] || '了愿') + (s.accompany ? '（陪同）' : '');
      const k = s.positionId + (s.accompany ? '|a' : '');
      const cur = p.pos.get(k) || { label, order: (order[s.positionId] === undefined ? 99 : order[s.positionId]) + (s.accompany ? 0.5 : 0), n: 0 };
      cur.n += 1;
      p.pos.set(k, cur);
    });
    const list = [...people.values()].map((p) => {
      const pos = [...p.pos.values()].sort((a, b) => a.order - b.order);
      const main = [...pos].sort((a, b) => b.n - a.n || a.order - b.order)[0];
      const dates = [...p.dates].sort();
      return { name: p.name, pos: pos.map((x) => x.label).join('、'), dates: dateRanges(dates), days: p.dates.size, shifts: p.shifts, main: main.order, first: dates[0] };
    });
    list.sort((a, b) => a.main - b.main || b.days - a.days || a.first.localeCompare(b.first) || a.name.localeCompare(b.name, 'zh-Hant'));
    return list;
  }

  /** 把字縮到放得下 */
  function fit(ctx, text, width, size, weight, family) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (s > 14 && ctx.measureText(text).width > width) {
      s -= 1;
      ctx.font = `${weight} ${s}px ${family}`;
    }
  }

  /** 中文一個字一個字斷行 */
  function wrap(ctx, text, width) {
    const lines = [];
    let line = '';
    [...text].forEach((ch) => {
      const punct = '，。、！？；：」）'.indexOf(ch) !== -1; // 標點不放在行首
      if (!punct && ctx.measureText(line + ch).width > width && line) { lines.push(line); line = ch; } else line += ch;
    });
    if (line) lines.push(line);
    return lines;
  }

  function draw(d) {
    const list = rows(d);
    const org = (window.SITE && window.SITE.org) || '教全區';
    const intro = `感謝以下家人發心了愿，承擔「${d.name}」的職司，用心護持道場。辛苦了，感恩！`;
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `400 30px ${SANS}`;
    const introLines = wrap(probe, intro, W - PAD * 2);
    const tableTop = 400 + introLines.length * 46;
    const H = tableTop + ROW * (list.length + 1) + 280;

    const cv = document.createElement('canvas');
    const scale = 1;
    cv.width = W * scale;
    cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);

    // 紙、雙框
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 8;
    ctx.strokeRect(22, 22, W - 44, H - 44);
    ctx.lineWidth = 2;
    ctx.strokeRect(38, 38, W - 76, H - 76);

    // 標題
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.red;
    ctx.font = `900 92px ${SERIF}`;
    ctx.fillText('感　謝　狀', W / 2, 170);
    ctx.fillStyle = C.head;
    fit(ctx, d.name, W - PAD * 2, 40, 800, SANS);
    ctx.fillText(d.name, W / 2, 245);
    ctx.fillStyle = C.muted;
    const when = d.start === d.end ? Fmt.rocDate(d.start) : `${Fmt.rocDate(d.start)}～${Fmt.shortDate(d.end)}`;
    const sub = when + (d.location ? `　${d.location}` : '');
    fit(ctx, sub, W - PAD * 2, 26, 500, SANS);
    ctx.fillText(sub, W / 2, 295);

    // 感謝的話
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    ctx.font = `400 30px ${SANS}`;
    introLines.forEach((l, i) => ctx.fillText(l, PAD, 370 + i * 46));

    // 表格
    const x0 = PAD;
    const tw = W - PAD * 2;
    let y = tableTop;
    ctx.fillStyle = C.head;
    ctx.fillRect(x0, y, tw, ROW);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    let x = x0;
    COLS.forEach((c) => {
      ctx.font = `700 26px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(c.title, x + c.w / 2, y + ROW / 2);
      x += c.w;
    });
    y += ROW;
    list.forEach((r, i) => {
      if (i % 2) { ctx.fillStyle = C.band; ctx.fillRect(x0, y, tw, ROW); }
      x = x0;
      COLS.forEach((c) => {
        const text = c.key === 'days' ? `${r.days} 天` : String(r[c.key]);
        ctx.fillStyle = c.key === 'name' ? C.ink : c.key === 'days' ? C.red : C.ink;
        fit(ctx, text, c.w - 20, c.key === 'name' ? 28 : 25, c.key === 'name' || c.key === 'days' ? 700 : 400, SANS);
        ctx.textAlign = c.key === 'dates' || c.key === 'pos' ? 'left' : 'center';
        ctx.fillText(text, c.key === 'dates' || c.key === 'pos' ? x + 12 : x + c.w / 2, y + ROW / 2 + 1);
        x += c.w;
      });
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y + ROW);
      ctx.lineTo(x0 + tw, y + ROW);
      ctx.stroke();
      y += ROW;
    });
    ctx.strokeStyle = C.head;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, tableTop, tw, ROW * (list.length + 1));

    // 合計
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.fillStyle = C.muted;
    ctx.font = `500 24px ${SANS}`;
    const shifts = list.reduce((n, r) => n + r.shifts, 0);
    ctx.fillText(`共 ${list.length} 位家人・${shifts} 人次`, W - PAD, y + 44);

    // 署名、日期
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    ctx.fillStyle = C.ink;
    ctx.font = `900 44px ${SERIF}`;
    ctx.fillText(`${org}　敬謝`, W - PAD, y + 134);
    ctx.fillStyle = C.muted;
    ctx.font = `500 24px ${SANS}`;
    ctx.fillText(`中華民國 ${Number(today.slice(0, 4)) - 1911} 年 ${Number(today.slice(5, 7))} 月 ${Number(today.slice(8, 10))} 日`, W - PAD, y + 180);
    return cv;
  }

  /** 後台按鈕：先看預覽，再按「傳到 LINE」（手機分享、電腦複製圖片） */
  function open(d) {
    const list = rows(d);
    if (!list.length) {
      const m = Modal.open(`<h2 class="modal-title">🏅 了愿感謝狀</h2><p>這個勤務還沒有了愿的人。</p><div class="modal-actions"><button type="button" class="btn btn-block" data-close>關閉</button></div>`);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      return;
    }
    const cv = draw(d);
    const m = Modal.open(`
      <h2 class="modal-title">🏅 了愿感謝狀</h2>
      <p class="hint">${list.length} 位家人。只列有效報名，後台改成「未到」的不列入；名單有變再按一次就會重畫。</p>
      <img class="image-full thanks-preview" src="${cv.toDataURL('image/png')}" alt="了愿感謝狀">
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-thanks-share>📤 傳到 LINE（手機分享／電腦複製圖片）</button>
        <button type="button" class="btn btn-block" data-close>關閉</button>
      </div>`);
    m.el.classList.add('modal-wide');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const btn = m.el.querySelector('[data-thanks-share]');
    btn.addEventListener('click', async () => {
      const back = btn.textContent;
      btn.disabled = true;
      try {
        const r = await GridImage.shareCanvas(cv, `${d.name}感謝狀.png`, `${d.name} 感謝狀`);
        btn.textContent = { share: '已開啟分享 ✓', copy: '已複製圖片 ✓，到 LINE 貼上', download: '已下載圖片 ✓', cancel: back }[r];
      } catch (e) {
        btn.textContent = '失敗了，請再試一次';
      }
      btn.disabled = false;
      setTimeout(() => { btn.textContent = back; }, 3500);
    });
  }

  window.ThanksImage = { rows, draw, open, dateRanges };
})();
