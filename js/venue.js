// 借區中心場地（#/venue?date=…）：選日期（單日或多個日期）→ 勾早上／下午／晚上 → 填資料送出申請（管理者同意後才算借到）。
// 多個日期：固定的日子（每週、每兩週⋯、每月第幾個星期幾、每月幾號）或一天一天加；每一天借同樣的時段。
// 填過的資料（姓名、電話、用途、人數）記在這台裝置，下次選名字就自動帶入。電話只送到伺服器給管理者看，不會公開。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const NAME_KEY = 'duty-calendar:venue-name';
  const PROFILE_KEY = 'duty-calendar:venue-profiles'; // { 姓名: { phone, purpose, people, note } }
  const SLOT_NAMES = ['早上', '下午', '晚上'];
  let root = null;
  let token = 0;
  let state = null;

  const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
  const saveName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 無痕模式 */ } };
  const profiles = () => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const saveProfile = (name, p) => {
    try {
      const all = profiles();
      all[name] = p;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
    } catch (e) { /* 無痕模式 */ }
  };

  function show(date) {
    root = document.getElementById('view-venue');
    token += 1;
    const tomorrow = Fmt.addDays(Fmt.toDateStr(new Date()), 1);
    const last = Fmt.addDays(tomorrow, 179);
    state = {
      tomorrow, last,
      mode: 'single', date: date && date >= tomorrow ? date : tomorrow,
      dates: new Set(), slots: new Set(),
      rule: { from: '', to: '', weekdays: [], freq: 'w1', dom: '' },
      status: {} // 日期 → [{ slot, status, name, purpose, activities }]
    };
    const me = savedName();
    const mine = profiles()[me] || {};
    root.innerHTML = `
      <h1 class="page-title">🏠 借${esc(window.SITE.venue)}場地</h1>
      <a class="help-inline" href="#/help?c=借場地">❓ 第一次借？看圖文教學</a>
      <button type="button" class="link-btn help-inline" data-go-repair>🔧 回報需要修繕</button>
      <p class="venue-intro">📅 選日期、⏰ 勾時段、✍️ 填好資料，就能送出申請囉！<br>✅ <strong>管理者同意後才算借到</strong>，同意後就會出現在行事曆上 🗓️<br>再請您到下面「🔍 查我的申請」看申請狀態，感謝慈悲 🙏😊</p>
      <div data-flash></div>
      <section class="venue-step">
        <h2 class="venue-h"><span class="step">1</span>選日期</h2>
        <div class="seg venue-mode">
          <label class="seg-item"><input type="radio" name="vmode" value="single" checked><span>單日</span></label>
          <label class="seg-item"><input type="radio" name="vmode" value="multi"><span>多個日期</span></label>
        </div>
        <div data-pick></div>
      </section>
      <section class="venue-step">
        <h2 class="venue-h"><span class="step">2</span>填資料</h2>
        <form class="venue-form" novalidate>
          <label class="form-row"><span>姓名</span><input class="input" name="name" autocomplete="off" value="${esc(me)}" placeholder="打一兩個字，下面會出現成員名單"></label>
          <div class="suggestions" data-sug-name aria-live="polite"></div>
          <label class="form-row"><span>聯絡電話（只有管理者看得到）</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(mine.phone || '')}" placeholder="例：0912-345678"></label>
          <label class="form-row"><span>用途</span><input class="input" name="purpose" maxlength="60" value="${esc(mine.purpose || '')}" placeholder="例：讀書會、家族聚會、練唱"></label>
          <label class="form-row"><span>人數（大約）</span><input class="input" name="people" inputmode="numeric" value="${esc(mine.people || '')}" placeholder="例：15"></label>
          <label class="form-row"><span>備註（選填，只有管理者看得到）</span><textarea class="input" name="note" rows="2" maxlength="100" placeholder="例：要用投影機、會提早半小時到布置">${esc(mine.note || '')}</textarea></label>
          <p class="hint" data-remember>${mine.phone ? '✓ 已帶入上次填的資料，可以直接改。' : '送出後會記在這台手機，下次選名字就自動帶入。'}</p>
          <div class="form-error" data-error hidden></div>
          <button type="submit" class="btn btn-primary btn-block" data-submit>送出申請</button>
        </form>
      </section>
      <section class="venue-step">
        <h2 class="venue-h">🔍 查我的申請</h2>
        <form class="mine-form" data-mine novalidate>
          <div class="mine-row">
            <input class="input" name="mname" autocomplete="off" placeholder="輸入申請時的姓名" value="${esc(me)}">
            <button type="submit" class="btn">查詢</button>
          </div>
          <div class="suggestions" data-sug-mine aria-live="polite"></div>
          <p class="hint">打一個字就會提示成員名單上的名字，點一下就查。</p>
        </form>
        <div data-mine-result aria-live="polite"></div>
      </section>
      <section class="venue-step" id="venue-repairs" data-repairs></section>
      <a class="btn btn-block back-bottom" href="#/">‹ 回行事曆</a>`;
    if (window.RepairPage) RepairPage.mount(root.querySelector('[data-repairs]'));
    root.querySelector('[data-go-repair]').addEventListener('click', () => root.querySelector('[data-repairs]').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    root.querySelectorAll('input[name=vmode]').forEach((r) => r.addEventListener('change', () => { state.mode = r.value; drawPick(); }));
    const form = root.querySelector('.venue-form');
    form.addEventListener('submit', submit);
    root.querySelector('[data-mine]').addEventListener('submit', (ev) => { ev.preventDefault(); clearSug(root.querySelector('[data-sug-mine]')); mine2(ev.target.elements.mname.value); });
    // 姓名：提示成員名單；選了（或打完）有記過的名字就帶入電話、用途、人數
    const fill = (n) => {
      const p = profiles()[String(n || '').trim()];
      if (!p) return;
      form.elements.phone.value = p.phone || '';
      form.elements.purpose.value = p.purpose || '';
      form.elements.people.value = p.people || '';
      form.elements.note.value = p.note || '';
      root.querySelector('[data-remember]').textContent = '✓ 已帶入上次填的資料，可以直接改。';
    };
    suggest(form.elements.name, root.querySelector('[data-sug-name]'), fill);
    form.elements.name.addEventListener('change', () => fill(form.elements.name.value));
    const mname = root.querySelector('[data-mine]').elements.mname;
    suggest(mname, root.querySelector('[data-sug-mine]'), (n) => mine2(n));
    mname.addEventListener('input', () => { if (!mname.value.trim()) root.querySelector('[data-mine-result]').innerHTML = ''; }); // 清空就不顯示結果
    drawPick();
  }

  // ---------- 1. 選日期 ----------

  function drawPick() {
    const box = root.querySelector('[data-pick]');
    const r = state.rule;
    const slotChips = `
      <p class="venue-sub">要借的時段${state.mode === 'multi' ? '（每一天都一樣）' : ''}：</p>
      <div class="venue-slot-chips">${SLOT_NAMES.map((s, i) => `<label class="plan-chip${state.slots.has(s) ? ' is-on' : ''}"><input type="checkbox" data-sl="${s}"${state.slots.has(s) ? ' checked' : ''}><span>${s}</span><small>${['08:00～12:00', '13:00～17:00', '18:00～21:00'][i]}</small></label>`).join('')}</div>`;
    if (state.mode === 'single') {
      box.innerHTML = `
        <input class="input venue-date" type="date" min="${state.tomorrow}" max="${state.last}" value="${state.date}" aria-label="日期" data-date>
        <div data-slots><p class="muted">載入中⋯</p></div>`;
      box.querySelector('[data-date]').addEventListener('change', (ev) => {
        if (!ev.target.value) return;
        state.date = ev.target.value;
        history.replaceState(null, '', `#/venue?date=${state.date}`);
        loadStatus([state.date]).then(drawSingle);
      });
      loadStatus([state.date]).then(drawSingle);
      return;
    }
    const list = [...state.dates].sort();
    box.innerHTML = `
      <div class="multi-box">
        <p class="multi-title">方法一：固定的日子</p>
        <div class="form-row form-row-pair">
          <label><span>從</span><input class="input" type="date" min="${state.tomorrow}" max="${state.last}" data-r="from" value="${esc(r.from)}"></label>
          <label><span>到</span><input class="input" type="date" min="${state.tomorrow}" max="${state.last}" data-r="to" value="${esc(r.to)}"></label>
        </div>
        <label class="form-row"><span>頻率</span><select class="input" data-r="freq">${[['w1', '每週'], ['w2', '每兩週'], ['w3', '每三週'], ['w4', '每四週'], ['m1', '每月第一個'], ['m2', '每月第二個'], ['m3', '每月第三個'], ['m4', '每月第四個'], ['mL', '每月最後一個'], ['day', '每月固定幾號']].map(([v, l]) => `<option value="${v}"${r.freq === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${r.freq === 'day' ? `<label class="form-row"><span>每月幾號</span><input class="input" inputmode="numeric" data-r="dom" value="${esc(r.dom)}" placeholder="例：15"></label>
          <label class="form-row"><span>備註（選填，只有管理者看得到）</span><textarea class="input" name="note" rows="2" maxlength="100" placeholder="例：要用投影機、會提早半小時到布置">${esc(mine.note || '')}</textarea></label>`
          : `<div class="multi-weekdays">${DateList.WEEK.map((w, i) => `<label class="check"><input type="checkbox" data-wd="${i}"${r.weekdays.indexOf(i) !== -1 ? ' checked' : ''}> 星期${w}</label>`).join('')}</div>`}
        <button type="button" class="btn btn-block" data-rule-add>加入這些日期</button>
      </div>
      <div class="multi-box">
        <p class="multi-title">方法二：一天一天加（不規則的日子）</p>
        <div class="mine-row">
          <input class="input" type="date" min="${state.tomorrow}" max="${state.last}" data-one aria-label="日期">
          <button type="button" class="btn" data-one-add>加入</button>
        </div>
      </div>
      <div class="form-error" data-pick-err hidden></div>
      ${list.length ? `
        <div class="venue-dates">
          <div class="venue-dates-head"><strong>已選 ${list.length} 天</strong><button type="button" class="link-btn" data-clear>全部清除</button></div>
          <div class="venue-date-chips">${list.map((d) => `<span class="venue-date-chip">${esc(Fmt.shortDate(d))}<button type="button" data-del="${d}" aria-label="拿掉 ${esc(Fmt.shortDate(d))}">×</button></span>`).join('')}</div>
        </div>` : '<p class="muted">還沒選日期。用上面兩種方法加入，可以混著用。</p>'}
      ${slotChips}
      <div data-check></div>`;
    const err = (m) => { const e = box.querySelector('[data-pick-err]'); e.textContent = m; e.hidden = !m; };
    box.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('change', () => { r[x.dataset.r] = x.value; if (x.dataset.r === 'freq') drawPick(); }));
    box.querySelectorAll('[data-wd]').forEach((x) => x.addEventListener('change', () => {
      r.weekdays = [...box.querySelectorAll('[data-wd]:checked')].map((c) => Number(c.dataset.wd));
    }));
    box.querySelector('[data-rule-add]').addEventListener('click', () => {
      if (!r.from || !r.to) return err('請選「從」和「到」');
      if (r.to < r.from) return err('「到」不能早於「從」');
      if (r.freq !== 'day' && !r.weekdays.length) return err('請勾星期幾');
      if (r.freq === 'day' && !(Number(r.dom) >= 1 && Number(r.dom) <= 31)) return err('請填每月幾號（1～31）');
      const add = DateList.weekly(r.from, r.to, r.weekdays, r.freq, Number(r.dom)).filter((d) => d >= state.tomorrow && d <= state.last);
      if (!add.length) return err('這段期間沒有符合的日期');
      add.forEach((d) => state.dates.add(d));
      if (state.dates.size > 60) return err('一次最多申請 60 天，請分兩次');
      drawPick();
    });
    box.querySelector('[data-one-add]').addEventListener('click', () => {
      const v = box.querySelector('[data-one]').value;
      if (!v) return err('請先選日期');
      if (v < state.tomorrow || v > state.last) return err('只能選明天到半年內的日期');
      state.dates.add(v);
      drawPick();
    });
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { state.dates.delete(b.dataset.del); drawPick(); }));
    const clear = box.querySelector('[data-clear]');
    if (clear) clear.addEventListener('click', () => { state.dates.clear(); drawPick(); });
    box.querySelectorAll('[data-sl]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) state.slots.add(c.dataset.sl); else state.slots.delete(c.dataset.sl);
      drawPick();
    }));
    if (list.length && state.slots.size) loadStatus(list).then(drawCheck);
  }

  /** 讀這些日期的狀態（一次最多 62 天的區間，超過就分段讀） */
  async function loadStatus(dates) {
    const t = token;
    const need = dates.filter((d) => !state.status[d]);
    const chunks = [];
    need.sort().forEach((d) => {
      const last = chunks[chunks.length - 1];
      if (last && Fmt.datesBetween(last[0], d).length <= 60) last[1] = d; else chunks.push([d, d]);
    });
    try {
      const res = await Promise.all(chunks.map(([a, b]) => Api.getVenue(a, b)));
      if (t !== token) return false;
      res.forEach((r) => Object.assign(state.status, r.days));
      return true;
    } catch (err) {
      const box = root.querySelector('[data-slots]') || root.querySelector('[data-check]');
      if (box) box.innerHTML = `<p class="muted">${esc(err.message || '讀取失敗，請稍後再試')}</p>`;
      return false;
    }
  }

  function drawSingle(ok) {
    if (!ok || state.mode !== 'single') return;
    const box = root.querySelector('[data-slots]');
    const slots = state.status[state.date] || [];
    box.innerHTML = `
      <p class="venue-day">${esc(Fmt.rocDate(state.date))}</p>
      <ul class="venue-slots">${slots.map((s) => {
        const taken = s.status === '已借出';
        const on = state.slots.has(s.slot) && !taken;
        return `
        <li>
          <label class="venue-slot is-${taken ? 'taken' : s.status === '審核中' ? 'pending' : 'free'}${on ? ' is-on' : ''}">
            <input type="checkbox" data-slot="${esc(s.slot)}"${on ? ' checked' : ''}${taken ? ' disabled' : ''}>
            <span class="vs-main"><strong>${esc(s.slot)}</strong><small>${esc(s.from)}～${esc(s.to)}</small></span>
            <span class="vs-state">${taken ? `已借出<small>${esc(s.purpose)}（${esc(s.name)}）</small>` : s.status === '審核中' ? '有人申請中<small>還是可以申請，由管理者決定</small>' : '可以借'}</span>
            ${s.activities.length ? `<span class="vs-act">⚠️ 這個時段${esc(window.SITE.venue)}有：${s.activities.map(esc).join('、')}</span>` : ''}
          </label>
        </li>`;
      }).join('')}</ul>
      <p class="hint">可以勾好幾個時段。已借出的不能勾。</p>`;
    box.querySelectorAll('[data-slot]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) state.slots.add(c.dataset.slot); else state.slots.delete(c.dataset.slot);
      drawSingle(true);
    }));
  }

  /** 多個日期：每一天、勾的時段的狀態；已借出的那天不會送出 */
  function drawCheck(ok) {
    if (!ok || state.mode !== 'multi') return;
    const box = root.querySelector('[data-check]');
    const list = [...state.dates].sort();
    const rows = list.map((d) => {
      const day = state.status[d] || [];
      const info = [...state.slots].map((s) => day.find((x) => x.slot === s)).filter(Boolean);
      const taken = info.filter((x) => x.status === '已借出');
      const pending = info.filter((x) => x.status === '審核中');
      const acts = [...new Set(info.flatMap((x) => x.activities))];
      return { d, taken, pending, acts };
    });
    const bad = rows.filter((r) => r.taken.length);
    box.innerHTML = `
      <ul class="venue-check">${rows.map((r) => `
        <li class="${r.taken.length ? 'is-taken' : ''}">
          <strong>${esc(Fmt.shortDate(r.d))}</strong>
          <span>${r.taken.length ? `❌ ${r.taken.map((x) => esc(x.slot)).join('、')}已借出（這天不會送出）` : r.pending.length ? `⏳ ${r.pending.map((x) => esc(x.slot)).join('、')}有人申請中` : '✓ 可以借'}${r.acts.length ? `<small>⚠️ 區中心有：${r.acts.map(esc).join('、')}</small>` : ''}</span>
        </li>`).join('')}</ul>
      ${bad.length ? `<p class="hint">已借出的 ${bad.length} 天會自動拿掉，只送出其他 ${rows.length - bad.length} 天。</p>` : ''}`;
  }

  // ---------- 2. 送出 ----------

  async function submit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const box = f.querySelector('[data-error]');
    const btn = f.querySelector('[data-submit]');
    let dates;
    if (state.mode === 'single') dates = [state.date];
    else {
      // 已借出的日子拿掉
      dates = [...state.dates].sort().filter((d) => !(state.status[d] || []).some((x) => state.slots.has(x.slot) && x.status === '已借出'));
    }
    const body = {
      dates,
      slots: [...state.slots],
      name: f.elements.name.value.trim(),
      phone: f.elements.phone.value.trim(),
      purpose: f.elements.purpose.value.trim(),
      people: f.elements.people.value.trim(),
      note: f.elements.note.value.trim()
    };
    box.hidden = true;
    if (!dates.length) { box.textContent = state.mode === 'multi' && state.dates.size ? '選的日子都已經借出了，請換日期或時段' : '請在上面選日期'; box.hidden = false; return; }
    if (!body.slots.length) { box.textContent = '請在上面勾要借的時段'; box.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = '送出中⋯';
    try {
      const res = await Api.requestVenue(body);
      saveName(body.name);
      saveProfile(body.name, { phone: body.phone, purpose: body.purpose, people: body.people, note: body.note });
      const n = res.dates.length;
      root.querySelector('[data-flash]').innerHTML = `<div class="notice notice-success notice-big" role="status">
        <p><strong>🎉 已收到您的申請，感恩您！</strong></p>
        <p>${n > 1 ? `${esc(Fmt.shortDate(res.dates[0]))} 等 ${n} 天` : esc(Fmt.rocDate(res.dates[0]))}　${res.slots.map(esc).join('、')}<br>✅ 管理者同意後就會出現在行事曆上 🗓️，再請您到下面「🔍 查我的申請」看申請狀態，感謝慈悲 🙏😊</p></div>`;
      offerNotify(root.querySelector('[data-flash]'), res.id);
      root.querySelector('[data-flash]').scrollIntoView({ behavior: 'smooth', block: 'center' });
      state.status = {};
      state.dates.clear();
      drawPick();
      mine2(body.name);
    } catch (err) {
      box.innerHTML = `<strong>${esc(err.message || '送出失敗，請稍後再試')}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
      box.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '送出申請';
    }
  }

  // ---------- 成員名單提示（同 mine.js） ----------

  const sugCache = new Map();
  function clearSug(box) { if (box) box.innerHTML = ''; }
  function suggest(input, box, onPick) {
    let timer = null;
    let seq = 0;
    const draw = (list) => {
      const q = input.value.replace(/[\s　]+/g, '');
      const items = list.filter((m) => m.name !== q).slice(0, 8);
      box.innerHTML = items.map((m) => `<button type="button" class="suggestion" data-suggest="${esc(m.name)}">${esc(m.name)}</button>`).join('');
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.replace(/[\s　]+/g, '');
      if (!q) { clearSug(box); return; }
      if (sugCache.has(q)) { draw(sugCache.get(q)); return; }
      timer = setTimeout(async () => {
        const t = ++seq;
        try {
          const res = await Api.searchMembers(q);
          sugCache.set(q, res.members);
          if (t === seq) draw(res.members);
        } catch (e) { /* 提示失敗就算了，照樣可以自己打完整名字 */ }
      }, 250);
    });
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-suggest]');
      if (!b) return;
      input.value = b.dataset.suggest;
      clearSug(box);
      onPick(b.dataset.suggest);
    });
  }

  // ---------- 查我的申請 ----------

  async function mine2(name) {
    const out = root.querySelector('[data-mine-result]');
    name = String(name || '').replace(/[\s　]+/g, '');
    if (!name) { out.innerHTML = ''; return; }
    if (name.length < 2) { out.innerHTML = '<p class="muted">請輸入完整的名字（至少 2 個字），或從提示點名字</p>'; return; }
    const mi = root.querySelector('[data-mine]').elements.mname;
    if (mi.value.replace(/[\s　]+/g, '') !== name) mi.value = name; // 自動查的時候，把名字填進查詢欄
    out.innerHTML = '<p class="muted">查詢中⋯</p>';
    try {
      const res = await Api.myVenue(name);
      drawMine(out, name, res.requests);
    } catch (err) {
      out.innerHTML = `<p class="muted">${esc(err.message || '查詢失敗')}</p>`;
    }
  }

  /** 送出申請後：問要不要收審核結果通知（已經允許過通知的手機直接幫他登記） */
  async function offerNotify(box, groupId) {
    if (!groupId || !window.PushPage) return;
    const st = PushPage.canNotify();
    if (st === 'unsupported' || st === 'denied') return;
    const card = document.createElement('div');
    card.className = 'notice venue-notify';
    box.appendChild(card);
    const watch = async () => Api.venueWatch(await PushPage.ensureSub(), groupId);
    if (st === 'ok' && Notification.permission === 'granted') {
      try {
        await watch();
        card.innerHTML = '<p>🔔 審核結果出來時，會傳通知到這支手機給您 😊</p>';
      } catch (e) { card.remove(); }
      return;
    }
    if (st !== 'ok') {
      card.innerHTML = `<p>🔔 想收到審核結果通知嗎？${st === 'line' ? '在 LINE 裡收不到通知，改用手機的瀏覽器開啟就可以。' : 'iPhone 要先把本網站「加到主畫面」才收得到通知。'}也可以隨時到下面「🔍 查我的申請」看結果。</p>`;
      return;
    }
    card.innerHTML = `<p><strong>🔔 要收到審核結果通知嗎？</strong></p><p>管理者同意或不同意時，會傳通知到這支手機。</p>
      <div class="push-card-actions"><button type="button" class="btn btn-primary" data-yes>好的，通知我</button><button type="button" class="btn" data-no>不用了</button></div>`;
    card.querySelector('[data-no]').addEventListener('click', () => card.remove());
    card.querySelector('[data-yes]').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = '設定中⋯';
      try {
        await watch();
        card.innerHTML = '<p>✅ 好的，審核結果出來時會通知您 😊</p>';
      } catch (e) {
        card.innerHTML = `<p class="form-error">${esc(e.message || '不好意思，沒有設定成功，可以到「查我的申請」看結果 🙏')}</p>`;
      }
    });
  }

  /** 查我的申請的結果：還沒到的（審核中、已借到）可以勾起來「申請取消」（管理者同意才算取消） */
  function drawMine(out, name, list) {
    const can = list.filter((r) => r.canCancel);
    out.innerHTML = `<p class="venue-mine-who"><strong>${esc(name)}</strong> 的申請</p>` + (list.length ? `<ul class="venue-mine">${list.map((r) => `
        <li class="is-${r.status === '已同意' ? 'ok' : r.status === '待審核' ? 'wait' : 'no'}">
          <span>${r.canCancel ? `<label class="check vm-pick"><input type="checkbox" data-cancel-id="${esc(r.id)}"> ` : ''}<strong>${esc(Fmt.shortDate(r.date))} ${esc(r.slot)}</strong>　${esc(r.purpose)}${r.canCancel ? '</label>' : ''}</span>
          <span class="vm-status">${r.cancelPending ? '⏳ 取消審核中' : r.status === '待審核' ? '⏳ 審核中' : r.status === '已同意' ? '✅ 已借到' : r.status === '不同意' ? '❌ 沒有借到' : '已取消'}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>
        </li>`).join('')}</ul>
        ${can.length ? `<div class="vm-cancel">
          <div class="vm-quick"><button type="button" class="link-btn" data-vm-all>全選</button><button type="button" class="link-btn" data-vm-none>都不選</button></div>
          <p class="hint">臨時不借了？勾要取消的日期時段，按下面的按鈕申請取消（要輸入申請時留的電話）。<strong>管理者同意後才算取消</strong>，之前還是幫您留著。當天（含）之後要取消，請聯絡管理者。</p>
          <button type="button" class="btn btn-quiet-danger btn-block" data-cancel-go>申請取消勾選的時段</button>
        </div>` : ''}` : '<p class="muted">查不到今天以後的申請（姓名要和申請時一樣）。</p>');
    const boxes = () => [...out.querySelectorAll('[data-cancel-id]')];
    const all = out.querySelector('[data-vm-all]');
    if (all) all.addEventListener('click', () => boxes().forEach((c) => { c.checked = true; }));
    const none = out.querySelector('[data-vm-none]');
    if (none) none.addEventListener('click', () => boxes().forEach((c) => { c.checked = false; }));
    const go = out.querySelector('[data-cancel-go]');
    if (go) go.addEventListener('click', () => {
      const ids = [...out.querySelectorAll('[data-cancel-id]:checked')].map((c) => c.dataset.cancelId);
      if (!ids.length) { alert('請先勾要取消的日期時段'); return; }
      askPhone(name, ids, out);
    });
  }

  function askPhone(name, ids, out) {
    const known = (profiles()[name] || {}).phone || '';
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">申請取消 ${ids.length} 個時段</h2>
        <p class="modal-note">為了確認是本人，請輸入申請時留的電話。送出後要等管理者同意才會取消。</p>
        <label class="form-row"><span>電話</span><input class="input" name="phone" type="tel" inputmode="tel" value="${esc(known)}" placeholder="例：0912-345678"></label>
        <div class="form-error" data-err hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-danger">送出取消申請</button>
          <button type="button" class="btn btn-block" data-close>先不要</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = f.querySelector('[data-err]');
      box.hidden = true;
      Busy.show('送出中⋯');
      try {
        const res = await Api.cancelVenue({ ids, name, phone: f.elements.phone.value.trim() });
        Busy.hide();
        m.close();
        drawMine(out, name, res.requests);
        out.insertAdjacentHTML('afterbegin', '<div class="notice notice-success" role="status"><p><strong>取消申請送出了</strong> 📮 管理者同意後就會取消，可以再到這裡查看，感恩您告訴我們 🙏</p></div>');
      } catch (err) {
        Busy.hide();
        box.innerHTML = `<strong>${esc(err.message || '沒有送出')}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        box.hidden = false;
      }
    });
  }

  window.VenuePage = { show };
})();
