// 報名表單：選了愿項目（額滿反灰）→ 選日期（多天勤務）→ 填名字（自動提示、可多人、選道親／壇辦／未求道；壇辦可選了愿／陪同）→ 確認報名。
// 名額與重複的最終判斷在伺服器（LockService 鎖定），這裡只做提示。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const SEARCH_LIMIT = 10; // 與後端 MEMBER_SEARCH_LIMIT 相同；結果少於此數代表已完整
  const IDENTITIES = ['道親', '壇辦', '未求道'];

  function normalize(name) {
    return String(name || '').replace(/^[\s　]+|[\s　]+$/g, '');
  }

  function mount(el, duty, defaultDate, onSuccess) {
    const allDates = Fmt.datesBetween(duty.start, duty.end);
    const openDates = allDates.filter((d) => d > duty.today); // 勤務當天（含）之後不能報名
    const multiDay = allDates.length > 1;
    const state = {
      positionId: duty.positions.length === 1 ? duty.positions[0].id : null,
      dates: new Set([openDates.indexOf(defaultDate) !== -1 ? defaultDate : openDates[0]]),
      entries: [], // { name, identity: '道親'|'壇辦'|'未求道'|'', accompany }
      showMissing: false, // 送出時有人沒選身分，標示出來
      submitting: false
    };
    const searchCache = new Map(); // 查詢字 → 成員陣列
    const knownIdentity = new Map(); // 提示中出現過的成員 → 成員名單上的身分
    let searchToken = 0;
    let searchTimer = null;
    let step = 1;

    el.innerHTML = `
      <h2>我要報名</h2>
      <form class="signup-form" novalidate>
        <fieldset class="field">
          <legend><span class="step">${step++}</span>選了愿項目</legend>
          <div class="choices" data-positions></div>
        </fieldset>
        ${multiDay ? `
        <fieldset class="field">
          <legend><span class="step">${step++}</span>選日期<small>可複選</small></legend>
          <div class="choices choices-dates" data-dates></div>
        </fieldset>` : ''}
        <fieldset class="field">
          <legend><span class="step">${step++}</span>填名字<small>可一次加入多人</small></legend>
          <div class="name-row">
            <input type="text" class="input" data-name-input placeholder="輸入名字" autocomplete="off" enterkeyhint="done" aria-label="名字">
            <button type="button" class="btn" data-add>加入</button>
          </div>
          <div class="suggestions" data-suggestions aria-live="polite"></div>
          <ul class="name-list" data-names></ul>
          <p class="hint">幫長輩或家人報名時，可以連續加入多個名字。每個名字都要選<span class="nw">「道親」</span><span class="nw">「壇辦」</span>或<span class="nw">「未求道」</span>（成員名單上已登記的會自動帶入，不能改）。壇辦可選<span class="nw">「陪同」</span>，陪同不佔名額。</p>
        </fieldset>
        <div class="form-error" data-error role="alert" hidden></div>
        <button type="submit" class="btn btn-primary btn-block" data-submit>確認報名</button>
      </form>`;

    const $ = (sel) => el.querySelector(sel);
    const form = $('form');
    const input = $('[data-name-input]');

    // ---------- 了愿項目 ----------

    function count(date, positionId) {
      const day = duty.days[date];
      return (day && day.counts[positionId]) || 0;
    }

    function isFull(position, date) {
      return position.max !== null && count(date, position.id) >= position.max;
    }

    function renderPositions() {
      const dates = Array.from(state.dates);
      $('[data-positions]').innerHTML = duty.positions.map((p) => {
        const fullAll = dates.length > 0 && dates.every((d) => isFull(p, d));
        const checked = state.positionId === p.id && !fullAll;
        let sub;
        if (fullAll) sub = '額滿';
        else if (dates.length === 1) {
          const c = count(dates[0], p.id);
          sub = p.max !== null ? `已報 ${c}／${p.max}` : `已報 ${c} 人`;
        } else sub = p.max !== null ? `每天 ${p.max} 人` : '不限人數';
        return `
          <label class="choice${fullAll ? ' is-disabled' : ''}${checked ? ' is-checked' : ''}">
            <input type="radio" name="position" value="${esc(p.id)}"${checked ? ' checked' : ''}${fullAll ? ' disabled' : ''}>
            <span class="choice-main">${esc(p.name)}${p.slot && p.name.indexOf(p.slot) === -1 ? `<small>${esc(p.slot)}</small>` : ''}</span>
            <span class="choice-sub">${esc(sub)}</span>
          </label>`;
      }).join('');
      if (state.positionId && !$('[data-positions] input:checked')) state.positionId = null;
    }

    // ---------- 日期（多天勤務） ----------

    function renderDates() {
      if (!multiDay) return;
      const position = duty.positions.find((p) => p.id === state.positionId);
      $('[data-dates]').innerHTML = allDates.map((d) => {
        const past = d <= duty.today;
        const full = position && isFull(position, d);
        const disabled = past || full;
        if (disabled) state.dates.delete(d);
        const checked = state.dates.has(d);
        const sub = past ? (d === duty.today ? '當天' : '已過') : full ? '額滿' : position ? (position.max !== null ? `${count(d, position.id)}／${position.max}` : `已報 ${count(d, position.id)}`) : '';
        return `
          <label class="choice choice-date${disabled ? ' is-disabled' : ''}${checked ? ' is-checked' : ''}">
            <input type="checkbox" value="${d}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
            <span class="choice-main">${Fmt.shortDate(d)}</span>
            ${sub ? `<span class="choice-sub">${sub}</span>` : ''}
          </label>`;
      }).join('');
    }

    // ---------- 名字 ----------

    function renderNames() {
      $('[data-names]').innerHTML = state.entries.map((e, i) => {
        const missing = state.showMissing && !e.identity;
        return `
        <li class="name-item${missing ? ' is-missing' : ''}">
          <div class="name-top">
            <span class="name-text">${esc(e.name)}</span>
            <button type="button" class="btn-remove" data-remove="${i}" aria-label="移除 ${esc(e.name)}">×</button>
          </div>
          <div class="name-options">
            <div class="option-row">
              <span class="option-label">身分</span>
              ${e.locked ? `<span class="identity-fixed"><strong>${esc(e.identity)}</strong><span class="muted">（成員名單登記的，不能改）</span></span>` : `
              <div class="segmented segmented-3" role="radiogroup" aria-label="${esc(e.name)} 的身分">
                ${IDENTITIES.map((id) => `
                  <label class="segment${e.identity === id ? ' is-checked' : ''}">
                    <input type="radio" name="identity-${i}" value="${id}" data-identity="${i}"${e.identity === id ? ' checked' : ''}>${id}
                  </label>`).join('')}
              </div>`}
            </div>
            ${e.identity === '壇辦' ? `<div class="option-row">
              <span class="option-label">方式</span>
              <div class="segmented" role="radiogroup" aria-label="${esc(e.name)} 的參加方式">
                ${[['了愿', false], ['陪同', true]].map(([label, value]) => `
                  <label class="segment${e.accompany === value ? ' is-checked' : ''}">
                    <input type="radio" name="accompany-${i}" value="${value}" data-accompany="${i}"${e.accompany === value ? ' checked' : ''}>${label}
                  </label>`).join('')}
              </div>
            </div>` : ''}
          </div>
          ${missing ? '<p class="name-missing">請選擇道親、壇辦或未求道</p>' : ''}
        </li>`;
      }).join('');
      const n = state.entries.length;
      $('[data-submit]').textContent = state.submitting ? '報名中⋯' : n ? `確認報名（${n} 人）` : '確認報名';
    }

    /**
     * 成員名單上已登記身分的人：身分固定（locked），報名者不能改（統計以成員名單為準）。
     * 從提示點選時直接帶入；手動輸入的名字到成員名單查一次，完全同名且有身分就帶入並固定。
     */
    function addName(raw, identity) {
      const name = normalize(raw);
      if (!name) return false;
      const same = state.entries.find((e) => Fmt.sameName(e.name, name));
      if (same) {
        showError(same.name === name ? `「${name}」已經在名單裡了` : `「${name}」與「${same.name}」視為同一人，已經在名單裡了`);
        return false;
      }
      const known = identity !== undefined ? identity : knownIdentity.get(name);
      const fixed = IDENTITIES.indexOf(known) !== -1 ? known : '';
      const entry = { name, identity: fixed, accompany: false, locked: !!fixed };
      state.entries.push(entry);
      hideError();
      renderNames();
      if (!fixed && known === undefined) lookupIdentity(entry);
      return true;
    }

    /** 手動輸入的名字：查成員名單，完全同名且有身分就帶入並固定 */
    async function lookupIdentity(entry) {
      try {
        const res = await Api.searchMembers(entry.name, duty.groupType, duty.group);
        const m = res.members.find((x) => x.name === entry.name);
        if (!m || IDENTITIES.indexOf(m.identity) === -1 || state.entries.indexOf(entry) === -1) return;
        entry.identity = m.identity;
        entry.locked = true;
        if (entry.identity !== '壇辦') entry.accompany = false;
        renderNames();
      } catch (e) { /* 查不到就讓報名者自己選，伺服器存檔時仍會以成員名單為準 */ }
    }

    function addFromInput() {
      if (addName(input.value)) {
        input.value = '';
        clearSuggestions();
      }
      input.focus();
    }

    // ---------- 名字自動提示（至少一個字才查詢） ----------

    function clearSuggestions() {
      searchToken += 1;
      $('[data-suggestions]').innerHTML = '';
    }

    /** 已查過的字若是這次查詢字的一部分、且結果完整，就直接在本機篩選，不用再等伺服器 */
    function fromCache(q) {
      if (searchCache.has(q)) return searchCache.get(q);
      for (const [p, list] of searchCache) {
        if (list.length < SEARCH_LIMIT && q.indexOf(p) !== -1) return list.filter((m) => m.name.indexOf(q) !== -1);
      }
      return null;
    }

    function renderSuggestions(list) {
      const taken = new Set(state.entries.map((e) => e.name));
      const items = list.filter((m) => !taken.has(m.name));
      items.forEach((m) => knownIdentity.set(m.name, m.identity || ''));
      const inGroup = (m) => duty.groupType && duty.group && m.groups && m.groups[duty.groupType] === duty.group;
      $('[data-suggestions]').innerHTML = items.length
        ? items.map((m) => `<button type="button" class="suggestion" data-suggest="${esc(m.name)}">${esc(m.name)}${inGroup(m) ? '<small>本組</small>' : ''}</button>`).join('')
        : '';
    }

    function onInput() {
      clearTimeout(searchTimer);
      const q = normalize(input.value);
      if (!q) {
        clearSuggestions();
        return;
      }
      const cached = fromCache(q);
      if (cached) {
        renderSuggestions(cached);
        return;
      }
      searchTimer = setTimeout(async () => {
        const t = ++searchToken;
        $('[data-suggestions]').innerHTML = '<span class="muted small">搜尋中⋯</span>';
        try {
          const res = await Api.searchMembers(q, duty.groupType, duty.group);
          searchCache.set(q, res.members);
          if (t === searchToken) renderSuggestions(res.members);
        } catch (e) {
          if (t === searchToken) $('[data-suggestions]').innerHTML = '';
        }
      }, 250);
    }

    // ---------- 錯誤訊息 ----------

    function showError(html) {
      const box = $('[data-error]');
      box.innerHTML = html;
      box.hidden = false;
    }

    function hideError() {
      $('[data-error]').hidden = true;
    }

    function detailText(d) {
      const who = d.name ? esc(d.name) : '';
      const when = d.date ? Fmt.shortDate(d.date) : '';
      const prefix = who && when ? `${who}（${when}）：` : who ? `${who}：` : when ? `${when}：` : '';
      return prefix + esc(d.message);
    }

    // ---------- 送出 ----------

    async function submit(ev) {
      ev.preventDefault();
      if (state.submitting) return;
      if (normalize(input.value)) addFromInput(); // 打了名字但忘了按「加入」

      const problems = [];
      if (!state.positionId) problems.push('請選擇了愿項目');
      if (!state.dates.size) problems.push('請選擇日期');
      if (!state.entries.length) problems.push('請填寫名字，並按「加入」');
      if (state.entries.some((e) => !e.identity)) {
        problems.push('請為每個名字選擇「道親」「壇辦」或「未求道」');
        state.showMissing = true;
        renderNames();
      }
      if (problems.length) {
        showError(problems.map(esc).join('<br>'));
        return;
      }

      hideError();
      state.submitting = true;
      $('[data-submit]').disabled = true;
      form.inert = true;
      renderNames();
      Busy.show('報名中，請稍候⋯', '約需 3–5 秒，請不要關閉畫面');
      const slowTimer = setTimeout(() => Busy.show('報名中，請稍候⋯', '伺服器較慢，仍在處理中，請不要關閉畫面'), 10000);
      const position = duty.positions.find((p) => p.id === state.positionId);
      const payload = {
        dutyId: duty.id,
        positionId: state.positionId,
        dates: Array.from(state.dates).sort(),
        entries: state.entries.map((e) => ({ name: e.name, identity: e.identity, accompany: e.accompany }))
      };
      const result = { dutyId: duty.id, entries: payload.entries, dates: payload.dates, positionId: position.id, positionName: position.name };
      const knownIds = new Set((duty.signups || []).map((s) => s.id)); // 送出前已有的報名，查證時用（名單還沒載入時為空）
      try {
        // 名單已載入時，回應太久就邊等邊查名單：伺服器常常早就寫好了，只是回應卡在 Google 那邊
        const request = signupWithRetry(payload, slowTimer);
        const res = Array.isArray(duty.signups) ? await raceWithVerify(request, payload, knownIds) : await request;
        clearTimeout(slowTimer);
        Busy.hide();
        onSuccess(result, res);
      } catch (err) {
        clearTimeout(slowTimer);
        if (err.code === 'NETWORK') {
          // 沒收到回應不代表沒報到（伺服器可能已寫入），自動重新讀名單查證
          Busy.show('正在確認報名結果⋯', '請不要關閉畫面');
          const verified = await verify(payload, knownIds);
          if (verified) {
            Busy.hide();
            onSuccess(result, verified);
            return;
          }
          fail(verified === false
            ? '<strong>報名沒有成功</strong>（伺服器沒有收到），請再按一次「確認報名」。'
            : '網路不穩，無法確定是否報名成功。請按「回行事曆」後重新點進來，查看名單上有沒有名字，再決定是否重報。');
          return;
        }
        if (err.code === 'VALIDATION' && err.details.length) {
          fail(`<strong>${esc(err.message)}</strong><br>${err.details.map(detailText).join('<br>')}`);
        } else {
          fail(esc(err.message || '報名失敗，請稍後再試'));
        }
      }
    }

    /** 報名；人太多（BUSY）時自動排隊重送 */
    function signupWithRetry(payload, slowTimer) {
      return Api.retryBusy(() => Api.signup(payload), () => {
        clearTimeout(slowTimer);
        Busy.show('報名的人較多，正在排隊⋯', '系統會自動重試，請不要關閉畫面');
      });
    }

    /**
     * 等報名回應的同時，12 秒後開始每隔幾秒重新讀名單；名單上已經有這次報名就直接當作成功，
     * 不用等卡住的回應。名單上還沒有（可能還在排隊）就繼續等。回應本身失敗時照原本流程處理。
     */
    function raceWithVerify(request, payload, knownIds) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
        request.then((v) => done(resolve, v), (e) => done(reject, e));
        (async () => {
          await new Promise((r) => setTimeout(r, 12000));
          while (!settled) {
            const verified = await verify(payload, knownIds);
            if (verified) { done(resolve, verified); return; }
            await new Promise((r) => setTimeout(r, 5000));
          }
        })();
      });
    }

    function fail(html) {
      Busy.hide();
      state.submitting = false;
      $('[data-submit]').disabled = false;
      form.inert = false;
      renderNames();
      showError(html);
    }

    /**
     * 報名回應沒收到時，重新讀名單確認是否已寫入。
     * 回傳：與報名回應相同格式的物件（已寫入）｜false（確定沒寫入）｜null（查證也失敗，無法確定）
     * 報名是整批全有或全無，所以只要每個名字在每個日期都出現新的一筆，就是成功。
     */
    async function verify(payload, knownIds) {
      let fresh;
      try {
        fresh = await Api.getDuty(payload.dutyId);
      } catch (e) {
        return null;
      }
      const added = fresh.signups.filter((s) => !knownIds.has(s.id) && s.positionId === payload.positionId);
      const found = [];
      for (const date of payload.dates) {
        for (const e of payload.entries) {
          const s = added.find((x) => x.date === date && x.name === e.name);
          if (!s) return found.length ? null : false;
          found.push({ id: s.id, date, name: s.name, identity: e.identity, accompany: s.accompany });
        }
      }
      return { created: found, days: fresh.days };
    }

    // ---------- 事件 ----------

    $('[data-positions]').addEventListener('change', (ev) => {
      state.positionId = ev.target.value;
      renderPositions();
      renderDates();
    });

    if (multiDay) {
      $('[data-dates]').addEventListener('change', (ev) => {
        if (ev.target.checked) state.dates.add(ev.target.value);
        else state.dates.delete(ev.target.value);
        renderDates();
        renderPositions();
      });
    }

    $('[data-add]').addEventListener('click', addFromInput);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        addFromInput();
      }
    });

    $('[data-suggestions]').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-suggest]');
      if (!btn) return;
      addName(btn.dataset.suggest, knownIdentity.get(btn.dataset.suggest));
      input.value = '';
      clearSuggestions();
      input.focus();
    });

    $('[data-names]').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-remove]');
      if (!btn) return;
      state.entries.splice(Number(btn.dataset.remove), 1);
      renderNames();
    });

    $('[data-names]').addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.accompany !== undefined) {
        state.entries[Number(t.dataset.accompany)].accompany = t.value === 'true';
        renderNames();
      }
      if (t.dataset.identity !== undefined) {
        const entry = state.entries[Number(t.dataset.identity)];
        entry.identity = t.value;
        if (entry.identity !== '壇辦') entry.accompany = false; // 只有壇辦可以陪同，道親、未求道一律了愿
        renderNames();
        if (!state.entries.some((e) => !e.identity)) hideError();
      }
    });

    form.addEventListener('submit', submit);

    renderPositions();
    renderDates();
    renderPositions(); // 日期可能因額滿被移除，了愿項目狀態再算一次
    renderNames();
  }

  window.SignupForm = { mount };
})();
