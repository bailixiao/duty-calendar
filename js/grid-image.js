// 職司表存成一張圖片（傳 LINE 用）：一欄一天、一列一個了愿項目的名字，畫在 canvas 上。
// 手機：直接開分享（可以選 LINE）；電腦：複製圖片到剪貼簿，不行就下載。
(function () {
  'use strict';

  const C = { ink: '#2b2118', muted: '#7a6a5a', line: '#d9cbb8', head: '#23476b', headInk: '#fff', band0: '#fffdf8', band1: '#f6efe3', star: '#c0392b', paper: '#fbf7f0' };
  const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  const COL = 108;
  const POS = 96;
  const NUM = 30;
  const ROW = 38;
  const HEAD = 52;
  const PAD = 24;

  /** 每個項目畫幾列：有填「最多」就畫那麼多（空格寫「—」，看得出還缺），不然照報名最多的那天 */
  function layout(d) {
    const g = RosterGrid.build(d);
    g.groups.forEach((grp) => {
      const max = grp.position.max;
      if (max !== null && max !== undefined && max > 0) grp.rows = Math.max(grp.rows, max);
    });
    return g;
  }

  /** 把字縮到放得下 */
  function fit(ctx, text, width, size, weight) {
    let s = size;
    ctx.font = `${weight || 400} ${s}px ${FONT}`;
    while (s > 10 && ctx.measureText(text).width > width) {
      s -= 1;
      ctx.font = `${weight || 400} ${s}px ${FONT}`;
    }
  }

  function draw(d) {
    const g = layout(d);
    const rows = g.groups.reduce((n, grp) => n + grp.rows, 0);
    const tableW = POS + NUM + COL * g.dates.length;
    const W = tableW + PAD * 2;
    const top = PAD + 74;
    const H = top + HEAD + ROW + rows * ROW + 44;
    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = W * scale;
    cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    // 標題、日期地點
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    fit(ctx, d.name, tableW, 26, 700);
    ctx.fillText(d.name, PAD, PAD + 16);
    ctx.fillStyle = C.muted;
    ctx.font = `400 15px ${FONT}`;
    const sub = [`${Fmt.shortDate(d.start)}～${Fmt.shortDate(d.end || d.start)}`, d.location ? `📍 ${d.location}` : ''].filter(Boolean).join('　');
    ctx.fillText(sub, PAD, PAD + 50);
    const x0 = PAD;
    const colX = (i) => x0 + POS + NUM + COL * i;
    // 表頭：日期
    ctx.fillStyle = C.head;
    ctx.fillRect(x0, top, tableW, HEAD);
    ctx.fillStyle = C.headInk;
    ctx.textAlign = 'center';
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText('日期', x0 + (POS + NUM) / 2, top + HEAD / 2);
    g.dates.forEach((x, i) => {
      const md = Fmt.shortDate(x.date).replace(/（.）$/, '');
      ctx.font = `700 16px ${FONT}`;
      ctx.fillText(md, colX(i) + COL / 2, top + 18);
      ctx.font = `400 13px ${FONT}`;
      ctx.fillText(`(${Fmt.weekday(x.date)})`, colX(i) + COL / 2, top + 37);
    });
    // 人數
    let y = top + HEAD;
    ctx.fillStyle = C.band1;
    ctx.fillRect(x0, y, tableW, ROW);
    ctx.fillStyle = C.ink;
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText('人數', x0 + (POS + NUM) / 2, y + ROW / 2);
    ctx.font = `400 14px ${FONT}`;
    g.dates.forEach((x, i) => ctx.fillText(`${x.total} 人`, colX(i) + COL / 2, y + ROW / 2));
    y += ROW;
    // 每個了愿項目
    g.groups.forEach((grp, gi) => {
      const h = grp.rows * ROW;
      ctx.fillStyle = gi % 2 ? C.band1 : C.band0;
      ctx.fillRect(x0, y, tableW, h);
      ctx.fillStyle = C.ink;
      fit(ctx, grp.position.name, POS - 10, 15, 700);
      ctx.fillText(grp.position.name, x0 + POS / 2, y + h / 2);
      for (let r = 0; r < grp.rows; r++) {
        const cy = y + r * ROW + ROW / 2;
        ctx.fillStyle = C.muted;
        ctx.font = `400 12px ${FONT}`;
        ctx.fillText(String(r + 1), x0 + POS + NUM / 2, cy);
        g.dates.forEach((x, i) => {
          const s = grp.cells[x.date][r];
          if (!s) {
            ctx.fillStyle = C.line;
            ctx.font = `400 14px ${FONT}`;
            ctx.fillText('—', colX(i) + COL / 2, cy);
            return;
          }
          const label = (s.leader ? '★' : '') + s.name + (s.accompany ? '(陪同)' : '');
          ctx.fillStyle = s.leader ? C.star : C.ink;
          fit(ctx, label, COL - 10, 15, s.leader ? 700 : 400);
          ctx.fillText(label, colX(i) + COL / 2, cy);
        });
        if (r) { // 同一個項目裡的細線
          ctx.strokeStyle = C.line;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(x0 + POS, y + r * ROW);
          ctx.lineTo(x0 + tableW, y + r * ROW);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      y += h;
      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + tableW, y);
      ctx.stroke();
    });
    // 直線、外框
    ctx.strokeStyle = C.line;
    [POS, POS + NUM].concat(g.dates.map((_, i) => POS + NUM + COL * i)).forEach((dx) => {
      ctx.beginPath();
      ctx.moveTo(x0 + dx, top + HEAD);
      ctx.lineTo(x0 + dx, y);
      ctx.stroke();
    });
    ctx.strokeRect(x0, top, tableW, y - top);
    // 腳註
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.font = `400 13px ${FONT}`;
    const now = new Date();
    ctx.fillText(`★ 組長　截至 ${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}　${window.SITE ? window.SITE.org : ''}`, PAD, y + 24);
    return cv;
  }

  /** 產生圖片並分享（手機）／複製（電腦）／下載；回傳做了什麼：'share' | 'copy' | 'download' | 'cancel' */
  async function share(d) {
    const cv = draw(d);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    const name = `${d.name}職司表.png`.replace(/[\\/:*?"<>|]/g, '');
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try {
        await navigator.share({ files: [file], title: d.name });
        return 'share';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
      }
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copy';
    } catch (e) { /* 不支援就下載 */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'download';
  }

  /** 按鈕共用：按下產生圖片，按鈕上寫結果 */
  async function onButton(btn, getDuty) {
    const back = btn.textContent;
    btn.disabled = true;
    btn.textContent = '產生圖片中⋯';
    try {
      const r = await share(await getDuty());
      btn.textContent = { share: '已開啟分享 ✓', copy: '已複製圖片 ✓，到 LINE 貼上', download: '已下載圖片 ✓', cancel: back }[r];
    } catch (e) {
      btn.textContent = '產生失敗，請再試';
    }
    btn.disabled = false;
    setTimeout(() => { btn.textContent = back; }, 3500);
  }

  window.GridImage = { draw, share, onButton };
})();
