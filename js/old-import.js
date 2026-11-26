// 管理後台：📂 從檔案帶入舊資料（#/admin/oldimport，2026/11/26）。規格見 docs/spec.md「從檔案帶入舊資料」。
//   選檔案 → Excel／Word 的表格直接讀（OldParse，不經過 AI）→ 讀不懂的、PDF、照片才給 AI（adminOldImportAi，預設 Gemini Pro）
//   → 依月份核對、修改 → 每 60 場送一次 adminImportAttendance（已經有的勤務補名單、沒有的新增；名單上已經有的人跳過）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const CATS = [['勤務', '總務・勤務'], ['道務', '道務'], ['教育', '教育']];
  const BATCH = 60; // adminImportAttendance 一次最多 60 場
  const key = (v) => String(v || '').replace(/[\s　]+/g, '');
  const rocMonth = (ym) => `${Number(ym.slice(0, 4)) - 1911} 年 ${Number(ym.slice(5, 7))} 月（${ym.slice(0, 4)}）`;

  /** 「測試甲、測試乙（宏宗）」→ [{ name, temple }]（括號裡是佛堂，同名同姓時用） */
  function parsePeople(text) {
    return String(text || '').split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^(.+?)[（(]([^）)]+)[）)]$/.exec(x);
      return m ? { name: key(m[1]), temple: m[2].trim() } : { name: key(x), temple: '' };
    }).filter((p) => p.name);
  }
  const peopleText = (list) => list.map((p) => p.name + (p.temple ? '（' + p.temple + '）' : '')).join('、');

  async function show(body, guard) {
    const who = Api.adminWho();
    if (who.role === '唯讀') { body.innerHTML = '<p class="panel-empty">唯讀帳號不能帶入資料</p>'; return; }
    const fixedCat = ['勤務', '道務', '教育'].indexOf(who.role) !== -1 ? who.role : '';
    body.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let duties, members;
    try {
      [duties, members] = await Promise.all([Api.admin('adminDutyList', {}, true), Api.admin('adminMembers', {}, true)]);
    } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${esc(e.message || '讀不到資料')}</p>`; return; }

    // 成員名字（含別名）→ 有幾位（同名不同佛堂）
    const known = new Map();
    (members.members || []).forEach((m) => [m.name].concat(m.aliases || []).forEach((n) => {
      const k = key(n); if (!k) return;
      if (!known.has(k)) known.set(k, []);
      if (n === m.name) known.get(k).push(m.temple || '');
    }));

    let sessions = []; // { pick, name, category, nature, date, end, startTime, endTime, location, people: [{name, identity, temple}], uncertain, source, byTable }
    let onlyWarn = false;
    let files = [];
    body.innerHTML = `
      <a class="back-link" href="#/admin/duties">‹ 勤務管理</a>
      <h2 class="detail-title">📂 從檔案帶入舊資料</h2>
      <div class="form-block import-help">
        <p>把以前的勤務、活動和<strong>當天有誰參加</strong>一次帶進來（例如這三年的紀錄），統計、人力負荷、感謝卡就會有以前的資料。</p>
        <ul class="import-rules">
          <li>可以選 Excel、Word、PDF、照片，可以一次選好幾個。</li>
          <li><strong>Excel、Word 的表格會直接讀，不經過 AI</strong>（最準）：表格要有「日期」和「名稱（活動項目）」那一欄，參加的人在「姓名／人員／壇辦／道親」欄。</li>
          <li>讀不懂的表格、PDF、照片才交給 Google 的 AI 讀，<strong>名字會交給 AI 判讀</strong>；AI 可能看錯，帶入前請一定要核對。</li>
          <li>帶入前可以一場一場改；已經有的勤務只補名單，已經在名單上的人不會重複。帶入後在操作紀錄可以還原。</li>
        </ul>
        <label class="btn btn-block">📂 選檔案（可以好幾個）<input type="file" accept=".xlsx,.xls,.csv,.ods,.docx,.doc,.pdf,image/*" multiple hidden data-files></label>
        <p class="muted" data-picked></p>
        <div class="form-grid-2">
          <label class="form-row"><span>年份（表上只寫月/日時用，可空白）</span><input class="input" data-year inputmode="numeric" placeholder="例：2024 或 113"></label>
          <label class="form-row"><span>判讀方式（給 AI 的部分）</span><select class="input" data-careful><option value="1">Gemini Pro（準，預設）</option><option value="">⚡ 快速（Gemini Flash，比較快）</option></select></label>
          ${fixedCat ? '' : `<label class="form-row"><span>表上沒寫類別的算</span><select class="input" data-defcat>${CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`}
          <label class="form-row"><span>給 AI 的補充說明（可空白）</span><input class="input" data-hint placeholder="例：日期是民國年；只要出勤的人"></label>
        </div>
        <button type="button" class="btn btn-primary btn-block" data-read disabled>先選檔案，才能開始讀</button>
      </div>
      <div data-progress></div>
      <div data-list></div>
      <div data-result></div>`;
    const $ = (s) => body.querySelector(s);
    const prog = $('[data-progress]');
    const fin = $('[data-files]');
    fin.addEventListener('change', () => {
      files = [...fin.files];
      $('[data-picked]').textContent = files.length ? '已選：' + files.map((f) => f.name).join('、') : '';
      const rb = $('[data-read]'); rb.disabled = !files.length; rb.textContent = files.length ? '🔍 開始讀' : '先選檔案，才能開始讀';
    });
    const yearVal = () => { let y = Number(String($('[data-year]').value).replace(/\D/g, '')) || 0; if (y && y < 1911) y += 1911; return y >= 1990 && y <= 2100 ? y : 0; };
    const defCat = () => fixedCat || ($('[data-defcat]') ? $('[data-defcat]').value : '勤務');

    $('[data-read]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const careful = !!$('[data-careful]').value;
      const size = careful ? { text: 2500, images: 1 } : { text: 8000, images: 3 }; // Pro 一批大約一頁（讀密的表才不會等太久）
      const errs = [];
      const found = [];
      const toAi = []; // { label, text?, images? }
      let tables = 0;
      prog.innerHTML = '<p class="muted">讀檔案中⋯</p>';
      for (const f of files) {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        try {
          if (['xlsx', 'xls', 'xlsm', 'csv', 'ods', 'docx'].indexOf(ext) !== -1) {
            const srcs = await MemberFile.readFile(f);
            srcs.forEach((src) => {
              const r = OldParse.parseTable(src.rows, { year: yearVal() || OldParse.yearOf(f.name), label: src.label });
              if (r.header && r.sessions.length) { tables++; r.sessions.forEach((s) => found.push(s)); r.problems.forEach((p) => errs.push(p)); return; }
              // 讀不懂的表格：文字給 AI
              const text = '【' + src.label + '】\n' + src.rows.map((row) => (row || []).map((x) => (x instanceof Date ? Fmt.toDateStr(x) : String(x == null ? '' : x))).filter(Boolean).join('\t')).filter(Boolean).join('\n');
              for (let i = 0; i < text.length; i += size.text) toAi.push({ label: src.label + (text.length > size.text ? ` 第 ${i / size.text + 1} 段` : ''), text: text.slice(i, i + size.text) });
            });
          } else {
            (await MemberFile.chunksOf(f, '', (p, n) => { prog.innerHTML = `<p class="muted">讀檔案中⋯（${esc(f.name)} 第 ${p}／${n} 頁）</p>`; }, size)).forEach((c) => toAi.push(c));
          }
        } catch (e) { errs.push(e.message || String(e)); }
      }
      let downgraded = false;
      for (let i = 0; i < toAi.length; i++) {
        const c = toAi[i];
        const t0 = Date.now();
        const paint = () => { prog.innerHTML = `<p class="muted">AI 讀檔中⋯（${i + 1}／${toAi.length}：${esc(c.label)}）已經 ${Math.round((Date.now() - t0) / 1000)} 秒，每一批大約 ${careful ? '30～120' : '10～60'} 秒</p><progress max="${toAi.length}" value="${i}"></progress>`; };
        paint();
        const tick = setInterval(paint, 1000);
        try {
          const r = await Api.admin('adminOldImportAi', { text: c.text || '', images: c.images || [], hint: $('[data-hint]').value, part: c.label, year: yearVal() || '', careful });
          if (r.downgraded) downgraded = true;
          r.sessions.forEach((s) => found.push(Object.assign({}, s, { source: c.label, byTable: false })));
        } catch (e) {
          if (e.code === 'UNAUTHORIZED') { clearInterval(tick); guard(e); return; }
          // 等太久：拆成兩半再讀（文字切一半、圖分開），還是太久才算失敗
          const half = MemberFile.splitChunk(c);
          if (e.code === 'NETWORK' && half) { toAi.splice(i + 1, 0, ...half); continue; }
          errs.push(`${c.label}：${e.code === 'NETWORK' ? '等太久沒有回應（可以改用「⚡ 快速」，或用「只讀第幾頁」分開讀）' : e.message}`);
          if (e.code === 'AI_LIMIT' || e.code === 'CONFIG') { clearInterval(tick); break; }
        } finally { clearInterval(tick); }
      }
      btn.disabled = false;
      sessions = OldParse.mergeSame(found.map((s) => Object.assign({}, s, { category: fixedCat || s.category || defCat() })))
        .map((s) => Object.assign(s, { people: (s.people || []).map((p) => ({ name: key(p.name), identity: p.identity || '', temple: '' })) }))
        .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.name.localeCompare(b.name));
      sessions.forEach((s) => { s.pick = !!(s.date && s.name); });
      prog.innerHTML = (downgraded ? '<p class="notice">Gemini Pro 現在不能用（太忙或額度用完），有幾批改用快速的 Flash，請多核對。</p>' : '') +
        (errs.length ? `<div class="notice notice-error"><p>${errs.slice(0, 30).map(esc).join('<br>')}${errs.length > 30 ? '<br>⋯還有 ' + (errs.length - 30) + ' 個' : ''}</p></div>` : '') +
        `<p>讀到 <strong>${sessions.length}</strong> 場${tables ? `（${tables} 個表格直接讀）` : ''}${toAi.length ? `，${toAi.length} 批給 AI 讀` : ''}。${sessions.length ? '請依月份打開核對，不要的取消勾選。' : ''}</p>`;
      draw();
    });

    // ---------- 核對 ----------
    function matchDuty(s) {
      return (duties.duties || []).find((d) => key(d.name) === key(s.name) && d.start <= s.date && s.date <= (d.end || d.start) && (d.category || '勤務') === s.category) || null;
    }
    function check(s) {
      const fresh = s.people.filter((p) => !known.has(p.name));
      const same = s.people.filter((p) => !p.temple && (known.get(p.name) || []).length > 1);
      const dup = matchDuty(s);
      const warn = !s.byTable || (s.uncertain || []).length || !s.people.length || fresh.length || same.length || !s.date || !s.name;
      return { fresh, same, dup, warn };
    }
    function sessionHtml(s, i) {
      const c = check(s);
      return `<div class="oi-item${s.pick ? '' : ' is-off'}${c.warn ? ' is-warn' : ''}" data-i="${i}">
        <label class="oi-pick"><input type="checkbox" data-f="pick"${s.pick ? ' checked' : ''}> 帶入</label>
        <div class="oi-grid">
          <input class="input" type="date" data-f="date" value="${esc(s.date)}" aria-label="日期">
          <input class="input" data-f="name" value="${esc(s.name)}" placeholder="名稱" aria-label="名稱">
          ${fixedCat ? '' : `<select class="input" data-f="category" aria-label="類別">${CATS.map(([v, l]) => `<option value="${v}"${v === s.category ? ' selected' : ''}>${l}</option>`).join('')}</select>`}
          <input class="input" type="time" data-f="startTime" value="${esc(s.startTime)}" aria-label="開始時間">
          <input class="input" type="time" data-f="endTime" value="${esc(s.endTime)}" aria-label="結束時間">
          <input class="input" data-f="location" value="${esc(s.location)}" placeholder="地點" aria-label="地點">
        </div>
        <label class="form-row"><span>參加的人（${s.people.length} 位，用「、」分開；同名同姓寫成 名字（佛堂））</span>
          <textarea class="input" rows="2" data-f="people">${esc(peopleText(s.people))}</textarea></label>
        <p class="oi-tags">
          ${c.dup ? '<span class="tag">已經有這個勤務，只補名單</span>' : '<span class="tag tag-new">會新增</span>'}
          ${s.byTable ? '<span class="tag">直接讀表格</span>' : '<span class="tag tag-warn">AI 讀的，請核對</span>'}
          ${c.fresh.length ? `<span class="tag tag-warn">${c.fresh.length} 個名字不在成員名單（會加到「待確認」）：${esc(c.fresh.slice(0, 5).map((p) => p.name).join('、'))}${c.fresh.length > 5 ? '⋯' : ''}</span>` : ''}
          ${c.same.map((p) => `<span class="tag tag-warn">「${esc(p.name)}」名單上有 ${known.get(p.name).length} 位（${esc(known.get(p.name).join('、'))}），請寫成 ${esc(p.name)}（佛堂）</span>`).join('')}
          ${!s.people.length ? '<span class="tag tag-warn">沒有人</span>' : ''}
          ${(s.uncertain || []).map((u) => `<span class="tag tag-warn">⚠️ ${esc(u)}</span>`).join('')}
          <span class="muted">來源：${esc(s.source || '')}</span>
        </p>
      </div>`;
    }

    function months() {
      const map = new Map();
      sessions.forEach((s, i) => {
        if (onlyWarn && !check(s).warn) return;
        const ym = s.date ? s.date.slice(0, 7) : '沒有日期';
        if (!map.has(ym)) map.set(ym, []);
        map.get(ym).push(i);
      });
      return map;
    }

    function draw() {
      const box = $('[data-list]');
      if (!sessions.length) { box.innerHTML = ''; return; }
      const picked = sessions.filter((s) => s.pick && s.date && s.name);
      const warnN = sessions.filter((s) => check(s).warn).length;
      const open = new Set([...box.querySelectorAll('details[open]')].map((d) => d.dataset.ym));
      box.innerHTML = `
        <div class="oi-bar">
          <label><input type="checkbox" data-only${onlyWarn ? ' checked' : ''}> 只看要注意的（${warnN} 場）</label>
          <button type="button" class="link-btn" data-all="1">全選</button>
          <button type="button" class="link-btn" data-all="0">全不選</button>
        </div>
        ${[...months()].map(([ym, idx]) => {
          const ss = idx.map((i) => sessions[i]);
          const w = ss.filter((s) => check(s).warn).length;
          return `<details class="oi-month" data-ym="${esc(ym)}"${open.has(ym) ? ' open' : ''}>
            <summary><strong>${esc(ym === '沒有日期' ? ym : rocMonth(ym))}</strong>：${ss.length} 場、${ss.reduce((n, s) => n + s.people.length, 0)} 人次${w ? `<span class="tag tag-warn">要注意 ${w}</span>` : ''}</summary>
            <div class="oi-body" data-body>${open.has(ym) ? idx.map((i) => sessionHtml(sessions[i], i)).join('') : ''}</div>
          </details>`;
        }).join('')}
        <div class="sticky-actions">
          <button type="button" class="btn btn-primary btn-block" data-go${picked.length ? '' : ' disabled'}>✅ 帶入勾選的 ${picked.length} 場（${picked.reduce((n, s) => n + s.people.length, 0)} 人次）</button>
        </div>`;
      box.querySelector('[data-only]').addEventListener('change', (e) => { onlyWarn = e.target.checked; draw(); });
      box.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => { const on = b.dataset.all === '1'; sessions.forEach((s) => { if (!onlyWarn || check(s).warn) s.pick = on && !!(s.date && s.name); }); draw(); }));
      box.querySelectorAll('details.oi-month').forEach((d) => d.addEventListener('toggle', () => {
        const b = d.querySelector('[data-body]');
        if (d.open && !b.innerHTML) b.innerHTML = [...months().get(d.dataset.ym) || []].map((i) => sessionHtml(sessions[i], i)).join('');
      }));
      box.onchange = onEdit; // box 每次重畫都還是同一個，用 onchange 才不會疊好幾個
      box.querySelector('[data-go]').addEventListener('click', go);
    }

    function onEdit(e) {
      const el = e.target.closest('[data-f]');
      const item = e.target.closest('[data-i]');
      if (!el || !item) return;
      const s = sessions[Number(item.dataset.i)];
      const f = el.dataset.f;
      if (f === 'pick') s.pick = el.checked;
      else if (f === 'people') {
        const old = new Map(s.people.map((p) => [p.name, p.identity]));
        s.people = parsePeople(el.value).map((p) => Object.assign(p, { identity: old.get(p.name) || '' }));
      } else s[f] = f === 'name' ? el.value.trim() : el.value;
      if (f === 'date' && !s.date) s.pick = false;
      const y = scrollY;
      const html = sessionHtml(s, Number(item.dataset.i));
      item.outerHTML = html;
      scrollTo(0, y);
      const goBtn = $('[data-go]');
      const picked = sessions.filter((x) => x.pick && x.date && x.name);
      goBtn.disabled = !picked.length;
      goBtn.textContent = `✅ 帶入勾選的 ${picked.length} 場（${picked.reduce((n, x) => n + x.people.length, 0)} 人次）`;
    }

    async function go() {
      const picked = sessions.filter((s) => s.pick && s.date && s.name);
      if (!picked.length) return;
      const ok = await Confirm.open({
        title: `要帶入 ${picked.length} 場嗎？`,
        rows: [['新增的勤務', picked.filter((s) => !matchDuty(s)).length + ' 場'], ['只補名單', picked.filter((s) => matchDuty(s)).length + ' 場'], ['參加的人', picked.reduce((n, s) => n + s.people.length, 0) + ' 人次']],
        note: '名單上已經有的人會跳過；不在成員名單的名字會加到成員的「待確認」。帶入後在操作紀錄可以還原。',
        confirmText: '確定帶入', cancelText: '再看一下'
      });
      if (!ok) return;
      const res = $('[data-result]');
      res.innerHTML = '';
      let done = 0, added = 0, skipped = 0, created = 0;
      for (let i = 0; i < picked.length; i += BATCH) {
        const part = picked.slice(i, i + BATCH);
        Busy.show(`帶入中⋯（${i + 1}～${Math.min(i + BATCH, picked.length)}／${picked.length} 場）`, '請不要關閉畫面');
        try {
          const r = await Api.admin('adminImportAttendance', { sessions: part.map((s) => {
            const d = matchDuty(s);
            return Object.assign(d ? { dutyId: d.id } : { create: { name: s.name, category: s.category, nature: s.nature || '', startTime: s.startTime, endTime: s.endTime, location: s.location, end: s.end || '' } },
              { date: s.date, entries: s.people.map((p) => ({ name: p.name, identity: p.identity || '', temple: p.temple || '', note: '' })) });
          }) });
          r.results.forEach((x) => { added += x.added; skipped += x.skipped.length; });
          created += part.filter((s) => !matchDuty(s)).length;
          part.forEach((s) => { s.pick = false; s.done = true; });
          done += part.length;
        } catch (e) {
          Busy.hide();
          if (guard(e)) return;
          res.innerHTML = `<div class="notice notice-error"><p><strong>第 ${i + 1}～${Math.min(i + BATCH, picked.length)} 場沒有帶入：${esc(e.message || '失敗')}</strong></p>${(e.details || []).map((x) => `<p>${esc(x.message)}</p>`).join('')}<p>前面 ${done} 場已經帶入了。改好後再按一次，已經帶入的人會跳過。</p></div>`;
          AdminPage.clearMemo();
          return;
        }
      }
      Busy.hide();
      AdminPage.clearMemo();
      try { duties = await Api.admin('adminDutyList', {}, true); } catch (e) { /* 下次再更新 */ }
      sessions = sessions.filter((s) => !s.done);
      draw();
      $('[data-result]').innerHTML = AdminPage.notice('success', `✅ 帶入完成：${done} 場`, `新增勤務約 ${created} 場，加了 ${added} 人次${skipped ? `，已經在名單上的 ${skipped} 人次跳過` : ''}。到「統計」就看得到。`);
      $('[data-result]').scrollIntoView({ block: 'center' });
    }
  }

  window.OldImportPage = { show, parsePeople };
})();
