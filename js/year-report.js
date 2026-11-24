// 📄 一鍵年度報表（2026/11/24）：後台「統計」按「📄 年度報表」，把一年的出勤整理成一頁（可以列印、存成 PDF、複製文字），開會時用。
//   總覽（場次、出勤人次、參與人數、道親佔比，和去年比）、各類別、每個月、人次最多的活動、感謝名單。
//   build() 是純函式（Node 測試用 module.exports），open() 畫畫面（瀏覽器用 window.YearReport）。
//   今年還沒過完：去年也只算到同一天，比較才公平。
(function (root) {
  'use strict';

  const CATS = ['勤務', '道務', '教育'];
  const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');

  /**
   * events：統計的出勤（adminStats 的 events，全部類別）；year：西元年；today：今天。
   * 回傳 { year, roc, until（今年還沒過完時＝today，不然 ''）, total, last, cats, months, top, thanks }
   */
  function build(events, year, today, C) {
    const p = { unit: 'year', year, n: 0 };
    const partial = today.slice(0, 4) === String(year) ? today : '';
    const lastUntil = partial ? `${year - 1}${today.slice(4)}` : undefined;
    const total = C.summarize(events, p);
    const last = C.summarize(events, C.lastYear(p), lastUntil);
    const inCat = (c) => events.filter((e) => (e.category || '勤務') === c);
    const cats = CATS.map((c) => Object.assign({ name: c, last: C.summarize(inCat(c), C.lastYear(p), lastUntil) }, C.summarize(inCat(c), p))).filter((c) => c.events || c.last.events);
    const months = Array.from({ length: 12 }, (_, i) => Object.assign({ n: i + 1, future: !!partial && `${year}-${String(i + 1).padStart(2, '0')}` > today.slice(0, 7) },
      C.summarize(events, { unit: 'month', year, n: i + 1 })));
    const top = C.byCategory(events, p).slice(0, 10);
    const thanks = C.ranking(events, p, 'all').slice(0, 15);
    return { year, roc: year - 1911, until: partial, total, last, cats, months, top, thanks };
  }

  /**
   * 🎴 個人年度感謝卡（2026/11/24）：一個人這一年的出勤。今年還沒過完時，去年也只算到同一天。
   * 回傳 { name, year, roc, until, count（次）, days（天）, last（去年次數）, cats: [{ name, count }], top: [{ name, count }]（最常參加的 5 個）, first, latest: { date, name } }
   */
  function person(events, name, year, today) {
    const partial = today.slice(0, 4) === String(year) ? today : '';
    const has = (e) => e.dao.indexOf(name) !== -1 || e.tan.indexOf(name) !== -1 || (e.unknown || []).indexOf(name) !== -1;
    const inYear = (y, until) => events.filter((e) => e.date.slice(0, 4) === String(y) && (!until || e.date <= until) && has(e)).sort((a, b) => a.date.localeCompare(b.date));
    const mine = inYear(year, partial);
    const count = (list, key) => {
      const m = new Map();
      list.forEach((e) => { const k = key(e); m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].map(([k, n]) => ({ name: k, count: n })).sort((a, b) => b.count - a.count);
    };
    const catName = (c) => (c === '勤務' ? '總務・勤務' : c);
    return {
      name, year, roc: year - 1911, until: partial,
      count: mine.length,
      days: new Set(mine.map((e) => e.date)).size,
      last: inYear(year - 1, partial ? `${year - 1}${today.slice(4)}` : '').length,
      cats: count(mine, (e) => catName(e.category || '勤務')),
      top: count(mine, (e) => e.series || e.name).slice(0, 5),
      first: mine.length ? { date: mine[0].date, name: mine[0].name } : null,
      latest: mine.length ? { date: mine[mine.length - 1].date, name: mine[mine.length - 1].name } : null
    };
  }

  /** 卡片上的幾行字 */
  function cardLines(p) {
    const md = (x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
    return {
      head: `${p.roc} 年，您參加了 ${p.count} 次、共 ${p.days} 天`,
      vs: p.last ? (p.count > p.last ? `比去年多了 ${p.count - p.last} 次 🎉` : p.count === p.last ? '和去年一樣用心 🙏' : `去年 ${p.last} 次`) : '',
      cats: p.cats.map((c) => `${c.name} ${c.count} 次`).join('、'),
      top: p.top.map((x) => `${x.name}（${x.count} 次）`),
      first: p.first ? `今年第一次：${md(p.first.date)} ${p.first.name}` : '',
      latest: p.count > 1 ? `最近一次：${md(p.latest.date)} ${p.latest.name}` : ''
    };
  }

  /** 和去年比：+12%、-5%、（去年沒有）'' */
  function diff(now, before) {
    if (!before) return '';
    const d = Math.round(((now - before) / before) * 100);
    return d === 0 ? '和去年一樣' : (d > 0 ? '比去年多 ' : '比去年少 ') + Math.abs(d) + '%';
  }

  /** 複製用的文字 */
  function text(r, name) {
    const t = r.total, l = r.last;
    return [
      `📄【${name} ${r.roc} 年度報表】${r.until ? `（統計到 ${Number(r.until.slice(5, 7))}/${Number(r.until.slice(8, 10))}）` : ''}`,
      `・場次 ${t.events} 場${l.events ? `（去年 ${l.events}）` : ''}`,
      `・出勤 ${t.total} 人次${l.total ? `（去年 ${l.total}，${diff(t.total, l.total)}）` : ''}`,
      `・參與 ${t.people} 位家人${l.people ? `（去年 ${l.people}）` : ''}`,
      `・道親佔比 ${pct(t.ratio)}${l.total ? `（去年 ${pct(l.ratio)}）` : ''}`,
      r.cats.length > 1 ? '\n各類別：\n' + r.cats.map((c) => `・${c.name}：${c.events} 場、${c.total} 人次、道親 ${pct(c.ratio)}`).join('\n') : '',
      r.top.length ? '\n人次最多的活動：\n' + r.top.map((x, i) => `${i + 1}. ${x.name}：${x.events} 場、${x.total} 人次`).join('\n') : '',
      r.thanks.length ? '\n🙏 感謝名單：' + r.thanks.map((x) => `${x.name}（${x.count}）`).join('、') : ''
    ].filter(Boolean).join('\n');
  }

  // =====================================================================
  // 畫面
  // =====================================================================
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function html(r, name) {
    const t = r.total, l = r.last;
    const tile = (label, v, lv, unit) => `<div class="yr-tile"><span class="yr-tile-label">${label}</span><b>${esc(v)}</b><small>${unit || ''}</small>${lv !== '' && lv !== undefined ? `<span class="yr-tile-vs">去年 ${esc(lv)}</span>` : ''}</div>`;
    const maxM = Math.max(1, ...r.months.map((m) => m.total));
    return `
      <div class="yr-head">
        <h2>${esc(name)} ${r.roc} 年度報表</h2>
        <p class="muted">${r.until ? `統計到 ${Number(r.until.slice(5, 7))} 月 ${Number(r.until.slice(8, 10))} 日（今年還沒過完，去年也只算到同一天）` : `${r.roc} 年 1～12 月`}・只算出席、非陪同；人次＝每場每人算一次</p>
      </div>
      <div class="yr-tiles">
        ${tile('場次', t.events, l.events || '', '場')}
        ${tile('出勤人次', t.total, l.total || '', '人次')}
        ${tile('參與的家人', t.people, l.people || '', '位')}
        ${tile('道親佔比', pct(t.ratio), l.total ? pct(l.ratio) : '', '')}
      </div>
      ${l.total ? `<p class="yr-sum">出勤人次${esc(diff(t.total, l.total))}${t.people && l.people ? `，參與的家人${esc(diff(t.people, l.people))}` : ''}。</p>` : ''}

      ${r.cats.length ? `<h3 class="yr-h">各類別</h3>
      <table class="yr-table"><thead><tr><th>類別</th><th>場次</th><th>人次</th><th>人數</th><th>道親佔比</th><th>去年人次</th></tr></thead>
        <tbody>${r.cats.map((c) => `<tr><th>${esc(c.name)}</th><td>${c.events}</td><td>${c.total}</td><td>${c.people}</td><td>${pct(c.ratio)}</td><td>${c.last.total || '—'}</td></tr>`).join('')}</tbody></table>` : ''}

      <h3 class="yr-h">每個月</h3>
      <table class="yr-table yr-months"><thead><tr><th>月</th><th>場次</th><th>人次</th><th class="yr-bar-th"></th><th>道親佔比</th></tr></thead>
        <tbody>${r.months.map((m) => m.future ? `<tr class="is-future"><th>${m.n} 月</th><td colspan="4">—</td></tr>` : `<tr><th>${m.n} 月</th><td>${m.events}</td><td>${m.total}</td><td class="yr-bar"><span style="width:${Math.round((m.total / maxM) * 100)}%"></span></td><td>${pct(m.ratio)}</td></tr>`).join('')}</tbody></table>

      ${r.top.length ? `<h3 class="yr-h">人次最多的活動</h3>
      <table class="yr-table"><thead><tr><th>#</th><th>活動</th><th>場次</th><th>人次</th><th>道親佔比</th></tr></thead>
        <tbody>${r.top.map((x, i) => `<tr><td>${i + 1}</td><th>${esc(x.name)}</th><td>${x.events}</td><td>${x.total}</td><td>${pct(x.total ? x.dao / x.total : null)}</td></tr>`).join('')}</tbody></table>` : ''}

      ${r.thanks.length ? `<h3 class="yr-h">🙏 感謝名單<small>出勤最多的 ${r.thanks.length} 位</small></h3>
      <ol class="yr-thanks">${r.thanks.map((x) => `<li><button type="button" class="yr-card-btn" data-yr-card="${esc(x.name)}" title="做感謝卡">${esc(x.name)}</button><small>${x.count} 次</small></li>`).join('')}</ol>
      <p class="hint no-print">點名字可以做「🎴 個人感謝卡」（存圖片傳給他）；不在名單上的人在下面打名字。</p>` : ''}
      <div class="yr-card-row no-print"><input class="input" data-yr-card-name placeholder="打名字做 🎴 個人感謝卡" autocomplete="off"><button type="button" class="btn" data-yr-card-go>🎴 做感謝卡</button></div>`;
  }

  // ---------- 🎴 個人年度感謝卡（畫成圖，存圖片／傳 LINE；樣子和了愿感謝狀一樣） ----------
  const CARD = { paper: '#fbf5e9', gold: '#b8862b', red: '#a8322d', ink: '#2b2118', muted: '#7a6a5a', head: '#23476b' };
  const SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  const SERIF = '"Noto Serif TC", "Songti TC", "PMingLiU", "MingLiU", serif';
  function fitFont(ctx, text, width, size, weight, family) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > width && s > 14);
  }
  function drawCard(p, site, arts) {
    const L = cardLines(p);
    const W = 1080, PAD = 90, ART_H = 240;
    const imgs = arts || [];
    const top = imgs.length ? ART_H + 40 : 0;
    const body = 560 + (L.vs ? 52 : 0) + (L.cats ? 52 : 0) + (L.top.length ? 48 * (L.top.length + 1) : 0) + 56 * [L.first, L.latest].filter(Boolean).length;
    const H = top + body + 180;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = CARD.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = CARD.gold;
    ctx.lineWidth = 8;
    ctx.strokeRect(22, 22, W - 44, H - 44);
    ctx.lineWidth = 2;
    ctx.strokeRect(38, 38, W - 76, H - 76);
    if (imgs.length) {
      const sizes = imgs.map((img) => ({ img, w: img.naturalWidth * ART_H / img.naturalHeight }));
      const total = sizes.reduce((n, s) => n + s.w, 0) + 20 * (sizes.length - 1);
      const k = Math.min(1, (W - PAD * 2) / total);
      let ax = (W - total * k) / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      sizes.forEach((s) => { const h = ART_H * k; ctx.drawImage(s.img, ax, 60 + (ART_H - h), s.w * k, h); ax += (s.w + 20) * k; });
      ctx.restore();
      ctx.translate(0, top);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = CARD.red;
    ctx.font = `900 84px ${SERIF}`;
    ctx.fillText('感　謝　卡', W / 2, 160);
    ctx.fillStyle = CARD.head;
    fitFont(ctx, p.name, W - PAD * 2, 64, 800, SANS);
    ctx.fillText(p.name, W / 2, 260);
    ctx.fillStyle = CARD.ink;
    fitFont(ctx, L.head, W - PAD * 2, 38, 700, SANS);
    ctx.fillText(L.head, W / 2, 340);
    let y = 340;
    if (L.vs) { y += 52; ctx.fillStyle = CARD.red; fitFont(ctx, L.vs, W - PAD * 2, 30, 600, SANS); ctx.fillText(L.vs, W / 2, y); }
    if (L.cats) { y += 52; ctx.fillStyle = CARD.muted; fitFont(ctx, L.cats, W - PAD * 2, 28, 500, SANS); ctx.fillText(L.cats, W / 2, y); }
    ctx.textAlign = 'left';
    y += 40;
    if (L.top.length) {
      y += 48;
      ctx.fillStyle = CARD.head;
      ctx.font = `700 32px ${SANS}`;
      ctx.fillText('最常參加的活動', PAD, y);
      L.top.forEach((t, i) => { y += 48; ctx.fillStyle = CARD.ink; fitFont(ctx, `${i + 1}. ${t}`, W - PAD * 2 - 30, 30, 400, SANS); ctx.fillText(`${i + 1}. ${t}`, PAD + 20, y); });
    }
    [L.first, L.latest].filter(Boolean).forEach((t) => { y += 56; ctx.fillStyle = CARD.muted; fitFont(ctx, t, W - PAD * 2, 26, 500, SANS); ctx.fillText(t, PAD, y); });
    y += 100;
    ctx.textAlign = 'center';
    ctx.fillStyle = CARD.ink;
    fitFont(ctx, '感謝您這一年的發心護持，辛苦了，感恩！', W - PAD * 2, 36, 700, SERIF);
    ctx.fillText('感謝您這一年的發心護持，辛苦了，感恩！', W / 2, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = CARD.muted;
    ctx.font = `500 26px ${SANS}`;
    const sign = (site || '') + (p.until ? `（統計到 ${Number(p.until.slice(5, 7))}/${Number(p.until.slice(8, 10))}）` : '');
    ctx.fillText(sign, W - PAD, H - top - 70);
    return cv;
  }

  /** 做一張個人感謝卡：預覽＋傳到 LINE（手機分享／電腦複製圖片） */
  async function openCard(events, who, year, today, site) {
    const p = person(events, who, year, today);
    if (!p.count) {
      const m0 = Modal.open(`<h2 class="modal-title">🎴 個人感謝卡</h2><p>${esc(who)} 在 ${p.roc} 年沒有出勤紀錄（名字要和統計上的一樣；同名不同佛堂的寫成「名字（佛堂）」）。</p><div class="modal-actions"><button type="button" class="btn btn-block" data-close>關閉</button></div>`);
      m0.el.querySelector('[data-close]').addEventListener('click', () => m0.close());
      return;
    }
    Busy.show('產生感謝卡中⋯');
    const arts = root.ThanksImage && ThanksImage.loadArts ? await ThanksImage.loadArts() : [];
    Busy.hide();
    const cv = drawCard(p, site, arts);
    const m = Modal.open(`
      <h2 class="modal-title">🎴 ${esc(p.name)} 的感謝卡</h2>
      <img class="image-full thanks-preview" src="${cv.toDataURL('image/png')}" alt="${esc(p.name)} 的感謝卡">
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-card-share>📤 傳到 LINE（手機分享／電腦複製圖片）</button>
        <button type="button" class="btn btn-block" data-close>關閉</button>
      </div>`);
    m.el.classList.add('modal-wide');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const btn = m.el.querySelector('[data-card-share]');
    btn.addEventListener('click', async () => {
      const back = btn.textContent;
      btn.disabled = true;
      try {
        const r = await GridImage.shareCanvas(cv, `${p.name}感謝卡.png`, `${p.name} 感謝卡`);
        btn.textContent = { share: '已開啟分享 ✓', copy: '已複製圖片 ✓，到 LINE 貼上', download: '已下載圖片 ✓', cancel: back }[r];
      } catch (e) { btn.textContent = '失敗了，請再試一次'; }
      btn.disabled = false;
      setTimeout(() => { btn.textContent = back; }, 3500);
    });
  }

  /** 打開報表（蓋在畫面上；列印時只印報表）。groups＝統計的活動歸類（改過名字的算成同一個） */
  function open(events, year, today, name, groups) {
    const C = root.StatsCalc;
    if (groups && Object.keys(groups).length) events = events.map((e) => (groups[e.series] ? Object.assign({}, e, { series: groups[e.series] }) : e));
    const pick = (y) => {
      const r = build(events, y, today, C);
      const years = [...new Set(events.map((e) => Number(e.date.slice(0, 4))))].concat([Number(today.slice(0, 4))]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a);
      el.innerHTML = `
        <div class="yr-bar-top no-print">
          <select class="input" data-yr-year aria-label="年度">${years.map((v) => `<option value="${v}"${v === y ? ' selected' : ''}>${v - 1911} 年</option>`).join('')}</select>
          <button type="button" class="btn btn-primary" data-yr-print>🖨 列印／存成 PDF</button>
          <button type="button" class="btn" data-yr-copy>📋 複製文字</button>
          <button type="button" class="btn" data-yr-close>關閉</button>
        </div>
        <article class="yr-page">${r.total.events || r.last.events ? html(r, name) : `<p class="panel-empty">${y - 1911} 年沒有出勤紀錄</p>`}</article>`;
      el.querySelector('[data-yr-year]').addEventListener('change', (ev) => pick(Number(ev.target.value)));
      el.querySelector('[data-yr-print]').addEventListener('click', () => window.print());
      el.querySelector('[data-yr-close]').addEventListener('click', close);
      el.querySelectorAll('[data-yr-card]').forEach((b) => b.addEventListener('click', () => openCard(events, b.dataset.yrCard, y, today, name)));
      const cn = el.querySelector('[data-yr-card-name]');
      if (cn) {
        if (root.MemberSuggest) MemberSuggest.attach(cn);
        el.querySelector('[data-yr-card-go]').addEventListener('click', () => { if (cn.value.trim()) openCard(events, cn.value.trim(), y, today, name); });
      }
      const cp = el.querySelector('[data-yr-copy]');
      cp.addEventListener('click', async () => { cp.textContent = (await Share.copyText(text(r, name))) ? '已複製 ✓' : '複製失敗，請再按一次'; });
      el.scrollTop = 0;
    };
    const el = document.createElement('div');
    el.className = 'yr-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '年度報表');
    document.body.appendChild(el);
    document.body.classList.add('yr-open');
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    function close() { el.remove(); document.body.classList.remove('yr-open'); document.removeEventListener('keydown', onKey); }
    document.addEventListener('keydown', onKey);
    pick(year);
  }

  const api = { build, text, diff, open, person, cardLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YearReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
