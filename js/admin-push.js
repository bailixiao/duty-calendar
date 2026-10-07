// 管理後台：推播（#/admin/push）。總管理者、勤務、道務、教育帳號。
// 選活動（類別帳號只看到自己類別）自動帶出標題、內容，或自己寫公告；現在推播或排定好幾個時間（伺服器每 5 分鐘檢查）。
// 送給所有開啟「手機提醒」的手機，點通知打開該活動的報名頁（公告打開行事曆）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const form = { id: '', key: '', title: '', body: '', mode: 'now', times: [] }; // 正在填的內容（切分頁回來還在）

  function show(body, guard) {
    AdminPage.swr('push', () => Api.admin('adminPushList', {}, true), (data, stale) => render(body, guard, data, stale), body);
  }

  const keyOf = (d) => d.id + '|' + d.date;

  /** 選了活動時自動帶出的標題、內容 */
  function autoText(d) {
    const time = Fmt.cardTime(d, d.date);
    const lines = [`📅 ${Fmt.shortDate(d.date)}${time ? ' ' + time : ''}`];
    if (d.location) lines.push(`📍 ${d.location}`);
    if (d.mode !== '公告型') lines.push(`🙋 ${Share.needText(d, d.day)}`);
    lines.push(d.mode === '公告型' ? '感恩大家 🙏' : '歡迎家人們踴躍成全，點我看詳情 🙏');
    return { title: `📣 ${d.name}`, body: lines.join('\n') };
  }

  /** 快速排時間：前三天、前一天晚上 8 點，當天早上 7 點（已經過去的不列） */
  function quickTimes(d, now) {
    return [[-3, '20:00', '前三天晚上 8 點'], [-1, '20:00', '前一天晚上 8 點'], [0, '07:00', '當天早上 7 點']]
      .map(([n, t, label]) => ({ at: `${Fmt.addDays(d.date, n)}T${t}`, label }))
      .filter((x) => x.at.replace('T', ' ') > now.slice(0, 16));
  }

  function statusText(p) {
    if (p.status === '排定') return `⏰ 排定 ${p.at}`;
    if (p.status === '已送出') return `✅ ${p.sentAt.slice(0, 16)} 送出（${p.devices || 0} 支手機）`;
    return `⚠️ 沒有送出${p.note ? '：' + p.note : ''}`;
  }

  function render(body, guard, data, stale) {
    const duty = data.duties.find((d) => keyOf(d) === form.key) || null;
    const planned = data.plans.filter((p) => p.status === '排定').sort((a, b) => a.at.localeCompare(b.at));
    const done = data.plans.filter((p) => p.status !== '排定').slice(0, 30);
    const minAt = data.now.slice(0, 16).replace(' ', 'T');
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      <p class="hint">推播會送給所有開啟「🔔 手機提醒」的手機（目前 <strong>${data.devices}</strong> 支），點通知會打開活動的報名頁。</p>
      ${autoHtml(data.auto)}
      ${Api.adminWho().role === '總管理者' ? '<div class="venue-watch" data-sys></div>' : ''}
      <form class="push-form" data-push-form novalidate>
        <h2 class="admin-sub">${form.id ? '修改排定的推播' : '新增推播'}</h2>
        <label class="form-row"><span>要推播的活動</span>
          <select class="input" name="duty">
            <option value="">不選活動（自己寫公告）</option>
            ${data.duties.map((d) => `<option value="${esc(keyOf(d))}"${keyOf(d) === form.key ? ' selected' : ''}>${esc(Fmt.shortDate(d.date) + '　' + d.name)}</option>`).join('')}
          </select>
        </label>
        <label class="form-row"><span>標題</span><input class="input" name="title" maxlength="60" value="${esc(form.title)}" placeholder="例：📣 定靜班事前工作"></label>
        <label class="form-row"><span>內容</span><textarea class="input" name="body" rows="4" maxlength="300" placeholder="${esc(window.SITE.examples.pushBody)}">${esc(form.body)}</textarea></label>
        <fieldset class="push-when">
          <legend>什麼時候送</legend>
          ${form.id ? '' : `<label class="check"><input type="radio" name="mode" value="now"${form.mode === 'now' ? ' checked' : ''}> 現在推播</label>`}
          <label class="check"><input type="radio" name="mode" value="later"${form.mode === 'later' || form.id ? ' checked' : ''}> 排定時間（可以排好幾個）</label>
          <div class="push-times" data-times${form.mode === 'later' || form.id ? '' : ' hidden'}>
            ${(form.times.length ? form.times : ['']).map((t, i) => `<div class="push-time-row">
              <input class="input" type="datetime-local" min="${minAt}" value="${esc(t)}" data-time="${i}">
              ${!form.id && form.times.length > 1 ? `<button type="button" class="link-btn" data-time-del="${i}">移除</button>` : ''}
            </div>`).join('')}
            ${form.id ? '' : '<button type="button" class="link-btn" data-time-add>＋ 再加一個時間</button>'}
            ${duty && !form.id ? `<div class="push-quick">${quickTimes(duty, data.now).map((q) => `<button type="button" class="chip" data-quick="${q.at}">${esc(q.label)}</button>`).join('')}</div>` : ''}
            <p class="hint">排定的時間到了會自動送出（最多晚 5 分鐘）。活動刪除或日期過了就不會送。</p>
          </div>
        </fieldset>
        <div class="push-preview" aria-label="手機上看到的樣子">
          <span class="push-preview-app">🙏 ${esc(window.SITE.name)}</span>
          <strong data-pv-title>${esc(form.title || '（標題）')}</strong>
          <span data-pv-body>${esc(form.body || '（內容）').replace(/\n/g, '<br>')}</span>
        </div>
        <div class="form-error" data-err hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary btn-block">${form.id ? '儲存修改' : '確定推播'}</button>
          ${form.id || form.key || form.title || form.body ? '<button type="button" class="btn btn-block" data-reset>清除重填</button>' : ''}
        </div>
      </form>

      <h2 class="admin-sub">排定中 <span class="badge badge-ok">${planned.length} 則</span></h2>
      ${planned.length ? `<ul class="push-plans">${planned.map((p) => planHtml(p, true)).join('')}</ul>` : '<p class="muted">還沒有排定的推播。</p>'}
      <h2 class="admin-sub">已送出</h2>
      ${done.length ? `<ul class="push-plans">${done.map((p) => planHtml(p, false)).join('')}</ul>` : '<p class="muted">還沒有送過。</p>'}`;

    bindAuto(body, guard, data);
    const sys = body.querySelector('[data-sys]');
    if (sys) drawSystemWatch(sys, guard);
    const f = body.querySelector("[data-push-form]");
    const keep = () => {
      form.title = f.elements.title.value;
      form.body = f.elements.body.value;
      const m = f.querySelector('[name=mode]:checked');
      form.mode = m ? m.value : 'later';
      form.times = [...f.querySelectorAll('[data-time]')].map((x) => x.value);
    };
    const preview = () => {
      keep();
      body.querySelector('[data-pv-title]').textContent = form.title || '（標題）';
      body.querySelector('[data-pv-body]').innerHTML = esc(form.body || '（內容）').replace(/\n/g, '<br>');
    };
    const redraw = () => { keep(); render(body, guard, data, false); };
    f.elements.title.addEventListener('input', preview);
    f.elements.body.addEventListener('input', preview);
    f.elements.duty.addEventListener('change', () => {
      keep();
      form.key = f.elements.duty.value;
      const d = data.duties.find((x) => keyOf(x) === form.key);
      if (d) Object.assign(form, autoText(d));
      render(body, guard, data, false);
    });
    f.querySelectorAll('[name=mode]').forEach((r) => r.addEventListener('change', redraw));
    const add = f.querySelector('[data-time-add]');
    if (add) add.addEventListener('click', () => { keep(); form.times.push(''); render(body, guard, data, false); });
    f.querySelectorAll('[data-time-del]').forEach((b) => b.addEventListener('click', () => { keep(); form.times.splice(Number(b.dataset.timeDel), 1); render(body, guard, data, false); }));
    f.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
      keep();
      form.times = form.times.filter(Boolean);
      if (form.times.indexOf(b.dataset.quick) === -1) form.times.push(b.dataset.quick);
      form.times.sort();
      render(body, guard, data, false);
    }));
    const reset = f.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', () => { Object.assign(form, { id: '', key: '', title: '', body: '', mode: 'now', times: [] }); render(body, guard, data, false); });

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      keep();
      const err = f.querySelector('[data-err]');
      err.hidden = true;
      const d = data.duties.find((x) => keyOf(x) === form.key);
      const times = form.times.filter(Boolean);
      const now = form.mode === 'now' && !form.id;
      if (!now && !times.length) { err.textContent = '請選推播的日期和時間'; err.hidden = false; return; }
      const ok = await Confirm.open({
        title: now ? `確定現在推播給 ${data.devices} 支手機嗎？` : form.id ? '確定儲存修改嗎？' : `確定排定 ${times.length} 個時間嗎？`,
        rows: [['標題', form.title], ['內容', form.body], ...(now ? [] : times.map((t, i) => [`時間 ${i + 1}`, t.replace('T', ' ')]))],
        confirmText: now ? '確定推播' : '確定'
      });
      if (!ok) return;
      Busy.show(now ? '推播中⋯' : '儲存中⋯');
      try {
        let res = null;
        const base = { id: form.id || '', dutyId: d ? d.id : '', date: d ? d.date : '', title: form.title, body: form.body };
        if (now) res = await Api.admin('adminPushSave', { plan: Object.assign(base, { now: true }) });
        else {
          for (const t of times) res = await Api.admin('adminPushSave', { plan: Object.assign({}, base, { at: t }) });
        }
        Busy.hide();
        Object.assign(form, { id: '', key: '', title: '', body: '', mode: 'now', times: [] });
        AdminPage.clearMemo();
        data = res;
        render(body, guard, res, false);
        body.insertAdjacentHTML('afterbegin', `<div class="notice notice-success" role="status"><p><strong>${now ? '已推播出去了 📣' : '已排定 ⏰'}</strong></p></div>`);
      } catch (e) {
        Busy.hide();
        if (guard(e)) return;
        err.innerHTML = `<strong>${esc(e.message || '沒有成功')}</strong>${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        err.hidden = false;
      }
    });

    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const p = data.plans.find((x) => x.id === b.dataset.edit);
      if (!p) return;
      Object.assign(form, { id: p.id, key: p.dutyId ? p.dutyId + '|' + p.date : '', title: p.title, body: p.body, mode: 'later', times: [p.at.replace(' ', 'T')] });
      render(body, guard, data, false);
      body.querySelector("[data-push-form]").scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await Confirm.open({ title: '確定刪除這則排定的推播嗎？', rows: [], confirmText: '刪除', danger: true }))) return;
      Busy.show('刪除中⋯');
      try {
        const res = await Api.admin('adminPushDelete', { id: b.dataset.del });
        Busy.hide();
        if (form.id === b.dataset.del) Object.assign(form, { id: '', key: '', title: '', body: '', mode: 'now', times: [] });
        AdminPage.clearMemo();
        data = res;
        render(body, guard, res, false);
      } catch (e) {
        Busy.hide();
        if (guard(e)) return;
        alert(e.message || '刪除失敗');
      }
    }));
  }

  function planHtml(p, editable) {
    return `
      <li class="push-plan is-${p.status === '排定' ? 'wait' : p.status === '已送出' ? 'ok' : 'no'}">
        <div class="push-plan-head"><strong>${esc(p.title)}</strong><span class="muted">${esc(p.category === "全部" ? "公告" : Fmt.catLabel(p.category))}｜${esc(p.by)}</span></div>
        <p class="push-plan-body">${esc(p.body).replace(/\n/g, '<br>')}</p>
        <p class="push-plan-status">${esc(statusText(p))}${p.status === '已送出' ? `<span class="push-stat">📱 收到 ${p.received}・👆 點開 ${p.clicks}</span>` : ''}</p>
        ${editable ? `<div class="push-plan-actions"><button type="button" class="btn btn-small" data-edit="${esc(p.id)}">修改</button><button type="button" class="btn btn-small btn-quiet-danger" data-del="${esc(p.id)}">刪除</button></div>` : ''}
      </li>`;
  }

  // ---------- 缺人自動推播（總管理者、勤務帳號） ----------

  const AUTO_DAYS = [[0, '當天'], [1, '前 1 天'], [2, '前 2 天'], [3, '前 3 天'], [5, '前 5 天'], [7, '前 7 天']];
  const canAuto = () => ['總管理者', '勤務'].indexOf(Api.adminWho().role) !== -1;

  function autoHtml(a) {
    if (!a || !canAuto()) return '';
    return `<form class="push-form push-auto" data-auto novalidate>
      <h2 class="admin-sub">🙋 缺人自動推播 <span class="badge ${a.on ? 'badge-ok' : 'badge-full'}">${a.on ? '開啟中' : '關閉'}</span></h2>
      <p class="hint">開啟後，每天到設定的時間，系統會找「勤務前幾天」還缺人的${esc(Fmt.catLabel('勤務'))}，自動推播給大家（道務、教育不算）。沒有缺人就不送。</p>
      <label class="check"><input type="checkbox" name="on"${a.on ? ' checked' : ''}> 開啟缺人自動推播</label>
      <div class="push-auto-days"><span class="field-label">勤務前幾天推播（可以多選）</span>
        ${AUTO_DAYS.map(([n, label]) => `<label class="check"><input type="checkbox" name="day" value="${n}"${a.days.indexOf(n) !== -1 ? ' checked' : ''}> ${label}</label>`).join('')}
      </div>
      <label class="form-row push-auto-time"><span>每天幾點送</span><input class="input" type="time" name="time" value="${esc(a.time)}"></label>
      <p class="hint">例如勾「前 3 天」「前 1 天」、時間 19:00：每天晚上 7 點，推播 3 天後和明天還缺人的勤務。每天晚上 8 點的手機提醒照常。${a.last ? `（上次檢查：${esc(a.last)}）` : ''}</p>
      <div class="form-error" data-auto-err hidden></div>
      <button type="submit" class="btn btn-primary">儲存設定</button>
    </form>`;
  }

  function bindAuto(body, guard) {
    const f = body.querySelector('[data-auto]');
    if (!f) return;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = f.querySelector('[data-auto-err]');
      err.hidden = true;
      const auto = { on: f.elements.on.checked, days: [...f.querySelectorAll('[name=day]:checked')].map((c) => Number(c.value)), time: f.elements.time.value };
      Busy.show('儲存中⋯');
      try {
        const res = await Api.admin('adminAutoPushSave', { auto });
        Busy.hide();
        AdminPage.clearMemo();
        render(body, guard, res, false);
        body.insertAdjacentHTML('afterbegin', `<div class="notice notice-success" role="status"><p><strong>${auto.on ? '已開啟缺人自動推播 🙋' : '已關閉缺人自動推播'}</strong></p></div>`);
      } catch (e) {
        Busy.hide();
        if (guard(e)) return;
        err.textContent = e.message || '沒有存起來';
        err.hidden = false;
      }
    });
  }

  // ---------- 系統通知（總管理者）：試算表同步停了會通知 ----------

  async function drawSystemWatch(box, guard) {
    const st = window.PushPage ? PushPage.canNotify() : 'unsupported';
    if (st !== 'ok') { box.innerHTML = '<p class="hint">⚙️ 系統通知：這支手機還不能收通知（iPhone 要先加到主畫面；或通知被封鎖）。</p>'; return; }
    const paint = (on) => {
      box.classList.toggle('is-on', !!on);
      box.innerHTML = on
        ? '<p class="venue-watch-on">⚙️ 這支手機會收到系統通知（試算表同步停了會通知您） <button type="button" class="link-btn" data-off>關閉</button></p>'
        : '<p>⚙️ 系統通知：Google 試算表超過 45 分鐘沒有同步時通知您。</p><button type="button" class="btn" data-on>開啟系統通知</button>';
      const on2 = box.querySelector('[data-on]');
      const off = box.querySelector('[data-off]');
      if (on2) on2.addEventListener('click', () => set(true));
      if (off) off.addEventListener('click', () => set(false));
    };
    const set = async (value) => {
      try {
        const endpoint = await PushPage.ensureSub();
        paint((await Api.admin('adminSystemWatch', { endpoint, on: value })).on);
        try { if (value) localStorage.removeItem('duty-calendar:system-watch-off'); else localStorage.setItem('duty-calendar:system-watch-off', '1'); } catch (e) { /* 無痕模式 */ }
      } catch (e) {
        if (guard(e)) return;
        box.insertAdjacentHTML('beforeend', `<p class="form-error">${esc(e.message || '設定失敗')}</p>`);
      }
    };
    const sub = await PushPage.currentSub();
    if (!sub) { paint(false); return; }
    try { paint((await Api.admin('adminSystemWatch', { endpoint: sub.endpoint }, true)).on); } catch (e) { paint(false); }
  }

  window.PushAdminPage = { show };
})();
