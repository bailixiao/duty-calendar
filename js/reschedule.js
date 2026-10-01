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

  window.Reschedule = { open };
})();
