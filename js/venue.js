// 借區中心場地（#/venue?date=…）：選日期 → 看早上／下午／晚上的狀態 → 勾時段、填資料送出申請（管理者同意後才算借到）。
// 下方「查我的申請」輸入姓名看審核結果。電話只送到伺服器給管理者看，不會公開，也不存在這台裝置。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const NAME_KEY = 'duty-calendar:venue-name';
  let root = null;
  let token = 0;
  let state = { date: '', data: null, picked: new Set(), flash: '' };

  const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
  const saveName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 無痕模式 */ } };

  function show(date) {
    root = document.getElementById('view-venue');
    token += 1;
    const tomorrow = Fmt.addDays(Fmt.toDateStr(new Date()), 1);
    state = { date: date && date >= tomorrow ? date : tomorrow, data: null, picked: new Set(), flash: '' };
    root.innerHTML = `
      <h1 class="page-title">🏠 借區中心場地</h1>
      <p class="hint">選日期、勾要借的時段，填好資料送出申請。<strong>管理者同意後才算借到</strong>，會用您留的電話聯絡您。</p>
      <div data-flash></div>
      <section class="venue-step">
        <h2 class="venue-h"><span class="step">1</span>選日期</h2>
        <input class="input venue-date" type="date" min="${tomorrow}" value="${state.date}" aria-label="日期" data-date>
        <div data-slots><p class="muted">載入中⋯</p></div>
      </section>
      <section class="venue-step">
        <h2 class="venue-h"><span class="step">2</span>填資料</h2>
        <form class="venue-form" novalidate>
          <label class="form-row"><span>姓名</span><input class="input" name="name" autocomplete="off" value="${esc(savedName())}" placeholder="打一兩個字，下面會出現成員名單"></label>
          <div class="suggestions" data-sug-name aria-live="polite"></div>
          <label class="form-row"><span>聯絡電話（只有管理者看得到）</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="例：0912-345678"></label>
          <label class="form-row"><span>用途</span><input class="input" name="purpose" maxlength="60" placeholder="例：讀書會、家族聚會、練唱"></label>
          <label class="form-row"><span>人數（大約）</span><input class="input" name="people" inputmode="numeric" placeholder="例：15"></label>
          <div class="form-error" data-error hidden></div>
          <button type="submit" class="btn btn-primary btn-block" data-submit>送出申請</button>
        </form>
      </section>
      <section class="venue-step">
        <h2 class="venue-h">查我的申請</h2>
        <form class="mine-form" data-mine novalidate>
          <div class="mine-row">
            <input class="input" name="mname" autocomplete="off" placeholder="輸入申請時的姓名" value="${esc(savedName())}">
            <button type="submit" class="btn">查詢</button>
          </div>
          <div class="suggestions" data-sug-mine aria-live="polite"></div>
          <p class="hint">打一個字就會提示成員名單上的名字，點一下就查。</p>
        </form>
        <div data-mine-result aria-live="polite"></div>
      </section>
      <a class="btn btn-block back-bottom" href="#/">‹ 回行事曆</a>`;
    root.querySelector('[data-date]').addEventListener('change', (ev) => {
      if (!ev.target.value) return;
      state.date = ev.target.value;
      state.picked = new Set();
      history.replaceState(null, '', `#/venue?date=${state.date}`);
      loadSlots();
    });
    root.querySelector('.venue-form').addEventListener('submit', submit);
    root.querySelector('[data-mine]').addEventListener('submit', (ev) => { ev.preventDefault(); clearSug(root.querySelector('[data-sug-mine]')); mine(ev.target.elements.mname.value); });
    // 姓名欄：跟報名一樣提示成員名單
    const nameInput = root.querySelector('.venue-form').elements.name;
    suggest(nameInput, root.querySelector('[data-sug-name]'), () => {});
    const mineInput = root.querySelector('[data-mine]').elements.mname;
    suggest(mineInput, root.querySelector('[data-sug-mine]'), (n) => mine(n));
    loadSlots();
  }

  // ---- 成員名單提示（同 mine.js）：打字後列出名字含這幾個字的成員，點了帶入 ----
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

  async function loadSlots() {
    const t = token;
    const box = root.querySelector('[data-slots]');
    box.innerHTML = '<p class="muted">載入中⋯</p>';
    try {
      const data = await Api.getVenue(state.date, state.date);
      if (t !== token) return;
      state.data = data;
      drawSlots();
    } catch (err) {
      if (t !== token) return;
      box.innerHTML = `<p class="muted">${esc(err.message || '讀取失敗，請稍後再試')}</p>`;
    }
  }

  function drawSlots() {
    const box = root.querySelector('[data-slots]');
    const slots = state.data.days[state.date] || [];
    box.innerHTML = `
      <p class="venue-day">${esc(Fmt.rocDate(state.date))}</p>
      <ul class="venue-slots">${slots.map((s) => {
        const taken = s.status === '已借出';
        const on = state.picked.has(s.slot);
        return `
        <li>
          <label class="venue-slot is-${taken ? 'taken' : s.status === '審核中' ? 'pending' : 'free'}${on ? ' is-on' : ''}">
            <input type="checkbox" data-slot="${esc(s.slot)}"${on ? ' checked' : ''}${taken ? ' disabled' : ''}>
            <span class="vs-main"><strong>${esc(s.slot)}</strong><small>${esc(s.from)}～${esc(s.to)}</small></span>
            <span class="vs-state">${taken ? `已借出<small>${esc(s.purpose)}（${esc(s.name)}）</small>` : s.status === '審核中' ? '有人申請中<small>還是可以申請，由管理者決定</small>' : '可以借'}</span>
            ${s.activities.length ? `<span class="vs-act">⚠️ 這個時段區中心有：${s.activities.map(esc).join('、')}</span>` : ''}
          </label>
        </li>`;
      }).join('')}</ul>
      <p class="hint">可以勾好幾個時段。已借出的不能勾。</p>`;
    box.querySelectorAll('[data-slot]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) state.picked.add(c.dataset.slot); else state.picked.delete(c.dataset.slot);
      drawSlots();
    }));
  }

  async function submit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const box = f.querySelector('[data-error]');
    const btn = f.querySelector('[data-submit]');
    const body = {
      date: state.date,
      slots: [...state.picked],
      name: f.elements.name.value.trim(),
      phone: f.elements.phone.value.trim(),
      purpose: f.elements.purpose.value.trim(),
      people: f.elements.people.value.trim()
    };
    box.hidden = true;
    if (!body.slots.length) { box.textContent = '請在上面勾要借的時段'; box.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = '送出中⋯';
    try {
      const res = await Api.requestVenue(body);
      saveName(body.name);
      f.elements.phone.value = '';
      f.elements.purpose.value = '';
      f.elements.people.value = '';
      state.picked = new Set();
      root.querySelector('[data-flash]').innerHTML = `<div class="notice notice-success notice-big" role="status">
        <p><strong>🙏 已收到您的申請</strong></p>
        <p>${esc(Fmt.rocDate(res.date))} ${res.slots.map(esc).join('、')}，管理者同意後會打電話聯絡您。也可以在下面「查我的申請」看結果。</p></div>`;
      root.querySelector('[data-flash]').scrollIntoView({ behavior: 'smooth', block: 'center' });
      loadSlots();
      mine(body.name);
    } catch (err) {
      box.innerHTML = `<strong>${esc(err.message || '送出失敗，請稍後再試')}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
      box.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '送出申請';
    }
  }

  async function mine(name) {
    const out = root.querySelector('[data-mine-result]');
    name = String(name || '').replace(/[\s　]+/g, '');
    if (!name) { out.innerHTML = ''; return; }
    if (name.length < 2) { out.innerHTML = '<p class="muted">請輸入完整的名字（至少 2 個字），或從提示點名字</p>'; return; }
    out.innerHTML = '<p class="muted">查詢中⋯</p>';
    try {
      const res = await Api.myVenue(name);
      out.innerHTML = res.requests.length ? `<ul class="venue-mine">${res.requests.map((r) => `
        <li class="is-${r.status === '已同意' ? 'ok' : r.status === '待審核' ? 'wait' : 'no'}">
          <span><strong>${esc(Fmt.shortDate(r.date))} ${esc(r.slot)}</strong>　${esc(r.purpose)}</span>
          <span class="vm-status">${r.status === '待審核' ? '⏳ 審核中' : r.status === '已同意' ? '✅ 已借到' : r.status === '不同意' ? '❌ 沒有借到' : '已取消'}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>
        </li>`).join('')}</ul>` : '<p class="muted">查不到今天以後的申請（姓名要和申請時一樣）。</p>';
    } catch (err) {
      out.innerHTML = `<p class="muted">${esc(err.message || '查詢失敗')}</p>`;
    }
  }

  window.VenuePage = { show };
})();
