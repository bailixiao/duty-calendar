// 改期畫面：選同名勤務的其他日期（含多天勤務的其他天）與了愿項目 → 確認視窗 → 送出。
// 名額、同日重複、是否已過由伺服器最終判斷；不符合時原報名保持不動。
(function () {
  'use strict';

  const esc = Fmt.esc;

  /**
   * signup: { id, date, positionId, name, accompany }；duty: 目前勤務（getDuty 的資料）
   * onDone(result)：result = { res, positionId, positionName, date } 或 { verified: freshDuty }（連線中斷但查證已改期）
   * opts.submit：改用其他 API 送出（管理後台用管理者改期，不受當天限制）
   */
  function open(signup, duty, onDone, opts) {
    const send = (opts && opts.submit) || Api.reschedule;
    const fromPosition = duty.positions.find((p) => p.id === signup.positionId);
    const state = { siblings: null, dutyId: null, date: null, positionId: null };
    const m = Modal.open(`
      <h2 class="modal-title">改期</h2>
      <p class="modal-sub">${esc(signup.name)}${signup.accompany ? '（陪同）' : ''}・原本 ${Fmt.shortDate(signup.date)} ${esc(fromPosition ? fromPosition.name : '')}</p>
      <div data-body><p class="muted">載入可以改的日期⋯</p></div>`);
    const body = m.el.querySelector('[data-body]');

    Api.getSiblings(duty.id).then((data) => {
      state.siblings = data.duties;
      render();
    }).catch((err) => {
      body.innerHTML = `<div class="form-error">${esc(err.message || '無法載入')}</div>
        <div class="modal-actions"><button type="button" class="btn btn-block" data-close>返回</button></div>`;
      body.querySelector('[data-close]').addEventListener('click', m.close);
    });

    function targetDuty() {
      return state.siblings.find((d) => d.id === state.dutyId);
    }

    function count(d, date, positionId) {
      const day = d.days[date];
      return (day && day.counts[positionId]) || 0;
    }

    function isFull(d, date, p) {
      if (signup.accompany || p.max === null) return false; // 陪同不佔名額
      const self = d.id === duty.id && date === signup.date && p.id === signup.positionId ? 1 : 0;
      return count(d, date, p.id) - self >= p.max;
    }

    function isCurrent(d, date, positionId) {
      return d.id === duty.id && date === signup.date && positionId === signup.positionId;
    }

    function render() {
      const options = [];
      state.siblings.forEach((d) => Object.keys(d.days).sort().forEach((date) => options.push({ d, date })));
      if (!options.length) {
        body.innerHTML = `<p>沒有其他可以改的日期。</p>
          <div class="modal-actions"><button type="button" class="btn btn-block" data-close>返回</button></div>`;
        body.querySelector('[data-close]').addEventListener('click', m.close);
        return;
      }

      const target = state.dutyId ? targetDuty() : null;
      // 預設了愿項目：目標勤務裡與原本同名的
      if (target && !state.positionId && fromPosition) {
        const same = target.positions.find((p) => p.name === fromPosition.name);
        if (same) state.positionId = same.id;
      }
      const position = target && target.positions.find((p) => p.id === state.positionId);

      body.innerHTML = `
        <fieldset class="field">
          <legend><span class="step">1</span>改到哪一天</legend>
          <div class="choices choices-dates">
            ${options.map(({ d, date }) => {
              const checked = d.id === state.dutyId && date === state.date;
              const samePos = position && d.id === state.dutyId ? position : d.positions.find((p) => fromPosition && p.name === fromPosition.name);
              const allFull = d.positions.length > 0 && d.positions.every((p) => isFull(d, date, p));
              const samePosFull = samePos && isFull(d, date, samePos);
              const current = d.id === duty.id && date === signup.date && d.positions.length === 1;
              const disabled = current || allFull;
              const sub = current ? '目前' : allFull ? '額滿' : samePosFull ? `${samePos.name}額滿`
                : samePos && samePos.max !== null ? `${count(d, date, samePos.id)}／${samePos.max}` : '';
              return `<label class="choice choice-date${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}">
                <input type="radio" name="target-date" value="${esc(d.id)}|${date}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                <span class="choice-main">${Fmt.shortDate(date)}</span>
                ${sub ? `<span class="choice-sub">${sub}</span>` : ''}
              </label>`;
            }).join('')}
          </div>
        </fieldset>
        ${target && target.positions.length > 1 ? `
        <fieldset class="field">
          <legend><span class="step">2</span>了愿項目</legend>
          <div class="choices">
            ${target.positions.map((p) => {
              const full = isFull(target, state.date, p);
              const current = isCurrent(target, state.date, p.id);
              const disabled = full || current;
              const checked = p.id === state.positionId && !disabled;
              const sub = current ? '目前' : full ? '額滿' : p.max !== null ? `已報 ${count(target, state.date, p.id)}／${p.max}` : `已報 ${count(target, state.date, p.id)} 人`;
              return `<label class="choice${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}">
                <input type="radio" name="target-position" value="${esc(p.id)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                <span class="choice-main">${esc(p.name)}</span>
                <span class="choice-sub">${sub}</span>
              </label>`;
            }).join('')}
          </div>
        </fieldset>` : ''}
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary btn-block" data-submit>確認改期</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>`;

      body.querySelectorAll('input[name="target-date"]').forEach((input) => input.addEventListener('change', () => {
        const [dutyId, date] = input.value.split('|');
        const changedDuty = dutyId !== state.dutyId;
        state.dutyId = dutyId;
        state.date = date;
        if (changedDuty) state.positionId = null;
        const t = targetDuty();
        if (t.positions.length === 1) state.positionId = t.positions[0].id;
        render();
      }));
      body.querySelectorAll('input[name="target-position"]').forEach((input) => input.addEventListener('change', () => {
        state.positionId = input.value;
        render();
      }));
      body.querySelector('[data-close]').addEventListener('click', m.close);
      body.querySelector('[data-submit]').addEventListener('click', submit);
    }

    function showError(html) {
      const box = body.querySelector('[data-error]');
      box.innerHTML = html;
      box.hidden = false;
    }

    async function submit() {
      const target = state.dutyId && targetDuty();
      const position = target && target.positions.find((p) => p.id === state.positionId);
      if (!target || !state.date) return showError('請選擇要改到哪一天');
      if (!position) return showError('請選擇了愿項目');
      if (isCurrent(target, state.date, position.id)) return showError('日期和了愿項目都沒有變更');

      const ok = await Confirm.open({
        title: '確定要改期嗎？',
        rows: [
          ['姓名', signup.name + (signup.accompany ? '（陪同）' : '')],
          ['勤務', duty.name],
          ['原本', `${Fmt.rocDate(signup.date)} ${fromPosition ? fromPosition.name : ''}`],
          ['改成', `${Fmt.rocDate(state.date)} ${position.name}`]
        ],
        confirmText: '確定改期',
        cancelText: '再想想'
      });
      if (!ok) return;

      m.el.setAttribute('data-locked', '');
      Busy.show('改期中，請稍候⋯', '請不要關閉畫面');
      const payload = { signupId: signup.id, dutyId: target.id, date: state.date, positionId: position.id };
      try {
        const res = await Api.retryBusy(() => send(payload),
          () => Busy.show('使用的人較多，正在排隊⋯', '系統會自動重試，請不要關閉畫面'));
        Busy.hide();
        m.close();
        onDone({ res, positionId: position.id, positionName: position.name, date: state.date });
      } catch (err) {
        if (err.code === 'NETWORK') {
          Busy.show('正在確認改期結果⋯', '請不要關閉畫面');
          try {
            const fresh = await Api.getDuty(duty.id);
            Busy.hide();
            if (!fresh.signups.some((s) => s.id === signup.id)) {
              m.close();
              onDone({ verified: fresh, positionName: position.name, date: state.date });
              return;
            }
            m.el.removeAttribute('data-locked');
            showError('<strong>改期沒有成功</strong>，請再按一次「確認改期」。');
          } catch (e) {
            Busy.hide();
            m.el.removeAttribute('data-locked');
            showError('網路不穩，無法確定是否改期成功。請關閉後重新整理名單確認。');
          }
          return;
        }
        Busy.hide();
        m.el.removeAttribute('data-locked');
        if (err.code === 'VALIDATION' && err.details.length) {
          showError(`<strong>${esc(err.message)}</strong><br>${err.details.map((d) => esc(d.message)).join('<br>')}`);
        } else {
          showError(esc(err.message || '改期失敗，請稍後再試'));
        }
      }
    }
  }

  /**
   * 換了愿項目（2026/11/21）：同一個勤務、同一天，只換項目（活動也可以）。原本那筆直接改，佛堂、註記都保留。
   * signup: { id, date, positionId, name, accompany }；duty: getDuty／adminDuty 的資料（要有 positions、days）
   * onDone({ res, positionName })；opts.submit：管理後台改用 adminChangePosition
   */
  function changePosition(signup, duty, onDone, opts) {
    const send = (opts && opts.submit) || Api.changePosition;
    const from = duty.positions.find((p) => p.id === signup.positionId);
    const day = (duty.days && duty.days[signup.date]) || { counts: {} };
    const count = (p) => (day.counts && day.counts[p.id]) || 0;
    const full = (p) => !signup.accompany && p.max !== null && p.max !== undefined && count(p) >= p.max;
    let picked = null;
    const m = Modal.open(`
      <h2 class="modal-title">換了愿項目</h2>
      <p class="modal-sub">${esc(signup.name)}${signup.accompany ? '（陪同）' : ''}・${Fmt.shortDate(signup.date)}・原本 ${esc(from ? from.name : '')}</p>
      <div data-body></div>`);
    const body = m.el.querySelector('[data-body]');
    function render() {
      body.innerHTML = `
        <fieldset class="field">
          <legend>換成哪一個</legend>
          <div class="choices">
            ${duty.positions.map((p) => {
              const current = p.id === signup.positionId;
              const disabled = current || full(p);
              const checked = p.id === picked;
              const sub = current ? '目前' : full(p) ? '額滿' : p.max !== null && p.max !== undefined ? `已報 ${count(p)}／${p.max}` : `已報 ${count(p)} 人`;
              return `<label class="choice${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}">
                <input type="radio" name="to-position" value="${esc(p.id)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                <span class="choice-main">${esc(p.name)}</span>
                <span class="choice-sub">${sub}</span>
              </label>`;
            }).join('')}
          </div>
        </fieldset>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary btn-block" data-submit>確認換項目</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>`;
      body.querySelectorAll('input[name="to-position"]').forEach((i) => i.addEventListener('change', () => { picked = i.value; render(); }));
      body.querySelector('[data-close]').addEventListener('click', m.close);
      body.querySelector('[data-submit]').addEventListener('click', submit);
    }
    function showError(html) {
      const box = body.querySelector('[data-error]');
      box.innerHTML = html;
      box.hidden = false;
    }
    async function submit() {
      const to = duty.positions.find((p) => p.id === picked);
      if (!to) return showError('請選擇要換成哪一個了愿項目');
      m.el.setAttribute('data-locked', '');
      Busy.show('換項目中，請稍候⋯', '請不要關閉畫面');
      try {
        const res = await Api.retryBusy(() => send({ signupId: signup.id, positionId: to.id }),
          () => Busy.show('使用的人較多，正在排隊⋯', '系統會自動重試，請不要關閉畫面'));
        Busy.hide();
        m.close();
        onDone({ res, positionName: to.name, fromName: from ? from.name : '' });
      } catch (err) {
        Busy.hide();
        m.el.removeAttribute('data-locked');
        if (err.code === 'VALIDATION' && err.details && err.details.length) {
          showError(`<strong>${esc(err.message)}</strong><br>${err.details.map((d) => esc(d.message)).join('<br>')}`);
        } else {
          showError(esc(err.code === 'NETWORK' ? '網路不穩，不確定有沒有換成，請關閉後重新整理確認' : (err.message || '沒有換成，請稍後再試')));
        }
      }
    }
    render();
  }

  /**
   * 調整項目（2026/11/21）：可兼任的勤務，那天報的項目打勾調整（加報、拿掉、換），一次送出。
   * signup: { id（那天任何一筆）, date, name, accompany, positionIds: [目前報的] }；duty: getDuty／adminDuty 的資料
   * onDone({ res, positions: [名稱] })；opts.submit：管理後台改用 adminAdjustPositions
   */
  function adjustPositions(signup, duty, onDone, opts) {
    const send = (opts && opts.submit) || Api.adjustPositions;
    const have = signup.positionIds || [];
    const day = (duty.days && duty.days[signup.date]) || { counts: {} };
    const count = (p) => (day.counts && day.counts[p.id]) || 0;
    const limited = (p) => p.max !== null && p.max !== undefined;
    const full = (p) => !signup.accompany && limited(p) && have.indexOf(p.id) === -1 && count(p) >= p.max;
    const picked = new Set(have);
    const nameOf = (id) => { const p = duty.positions.find((x) => x.id === id); return p ? p.name : ''; };
    const m = Modal.open(`
      <h2 class="modal-title">調整項目</h2>
      <p class="modal-sub">${esc(signup.name)}${signup.accompany ? '（陪同）' : ''}・${Fmt.shortDate(signup.date)}・${esc(duty.name)}</p>
      <div data-body></div>`);
    const body = m.el.querySelector('[data-body]');
    function render() {
      body.innerHTML = `
        <fieldset class="field">
          <legend>要報哪些項目（可以勾好幾個）</legend>
          <div class="choices">
            ${duty.positions.map((p) => {
              const on = picked.has(p.id);
              const disabled = full(p);
              const sub = disabled ? '額滿' : `${have.indexOf(p.id) !== -1 ? '目前有報・' : ''}已報 ${count(p)}${limited(p) ? '／' + p.max : ' 人'}`;
              return `<label class="choice${on ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}">
                <input type="checkbox" name="adj-position" value="${esc(p.id)}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                <span class="choice-main">${on ? '☑' : '☐'} ${esc(p.name)}</span>
                <span class="choice-sub">${sub}</span>
              </label>`;
            }).join('')}
          </div>
        </fieldset>
        <p class="hint">想加報就勾、不去了就取消勾；全部不勾＝取消這天的報名。</p>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary btn-block" data-submit>確認調整</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>`;
      body.querySelectorAll('input[name="adj-position"]').forEach((i) => i.addEventListener('change', () => {
        if (i.checked) picked.add(i.value); else picked.delete(i.value);
        render();
      }));
      body.querySelector('[data-close]').addEventListener('click', m.close);
      body.querySelector('[data-submit]').addEventListener('click', submit);
    }
    function showError(html) {
      const box = body.querySelector('[data-error]');
      box.innerHTML = html;
      box.hidden = false;
    }
    async function submit() {
      const ids = duty.positions.map((p) => p.id).filter((id) => picked.has(id));
      const adds = ids.filter((id) => have.indexOf(id) === -1);
      const removes = have.filter((id) => ids.indexOf(id) === -1);
      if (!adds.length && !removes.length) return showError('項目沒有變更');
      const rows = [['姓名', signup.name + (signup.accompany ? '（陪同）' : '')], ['日期', Fmt.rocDate(signup.date)]];
      if (adds.length) rows.push(['加報', adds.map(nameOf).join('、')]);
      if (removes.length) rows.push(['拿掉', removes.map(nameOf).join('、')]);
      rows.push(['調整後', ids.length ? ids.map(nameOf).join('、') : '（全部取消，這天沒有報名）']);
      const ok = await Confirm.open({
        title: ids.length ? '確定要這樣調整嗎？' : '確定要取消這天的報名嗎？',
        rows,
        confirmText: ids.length ? '確定調整' : '確定取消報名',
        cancelText: '再想想',
        danger: !ids.length
      });
      if (!ok) return;
      m.el.setAttribute('data-locked', '');
      Busy.show('調整中，請稍候⋯', '請不要關閉畫面');
      try {
        const res = await Api.retryBusy(() => send({ signupId: signup.id, positionIds: ids }),
          () => Busy.show('使用的人較多，正在排隊⋯', '系統會自動重試，請不要關閉畫面'));
        Busy.hide();
        m.close();
        onDone({ res, positions: ids.map(nameOf) });
      } catch (err) {
        Busy.hide();
        m.el.removeAttribute('data-locked');
        if (err.code === 'VALIDATION' && err.details && err.details.length) {
          showError(`<strong>${esc(err.message)}</strong><br>${err.details.map((d) => esc(d.message)).join('<br>')}`);
        } else {
          showError(esc(err.code === 'NETWORK' ? '網路不穩，不確定有沒有調整成功，請關閉後重新整理確認' : (err.message || '沒有調整成功，請稍後再試')));
        }
      }
    }
    render();
  }

  window.Reschedule = { open, changePosition, adjustPositions };
})();
