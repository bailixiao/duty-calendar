// 管理後台：批次匯入（#/admin/import）。從 Excel／Google 試算表複製多列貼上 → 檢查並預覽 → 全部正確才能匯入。
// 解析規則見 import-parse.js。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const EXAMPLE = [
    ImportParse.COLUMNS.join('\t'),
    ['115/12/5', '宏宗打蠟', '08:00-12:00', '宏宗', '打掃組 第1組', '打蠟、搬桌椅 2-4', '', '', '自行穿著', ''].join('\t'),
    ['115/12/12-115/12/19', '12人小組輪值', '14:00-14:00', '彌勒山', '', '烹飪 4、清潔 2-4、早上維安 2、晚上維安 2', '', '', '', '週日 14:00 交接'].join('\t')
  ].join('\n');

  let draft = ''; // 換頁回來時保留貼上的內容

  function show(body, guard) {
    body.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    AdminPage.swr('dutyList', () => Api.admin('adminDutyList', {}, true), (data) => render(body, guard, data.groups), body);
  }

  function render(body, guard, groups) {
    body.innerHTML = `
      <a class="back-link" href="#/admin/duties">‹ 勤務管理</a>
      <h2 class="detail-title">批次匯入</h2>
      <div class="form-block import-help">
        <p>從 Excel 或 Google 試算表選取多列、複製，貼到下面。<strong>每一列一筆勤務</strong>，欄位順序：</p>
        <p class="import-cols">${ImportParse.COLUMNS.map((c, i) => `<span class="tag">${i + 1}. ${esc(c)}</span>`).join(' ')}</p>
        <ul class="import-rules">
          <li>日期：<code>115/12/5</code>；多天：<code>115/11/8-115/11/15</code></li>
          <li>時段：<code>08:00-12:00</code>，可空白</li>
          <li>負責組：<code>打掃組 第1組</code>，可空白</li>
          <li>了愿項目用「、」分隔：<code>烹飪 4</code>＝最少最多都是 4 人；<code>清潔 2-4</code>＝最少 2、最多 4；<code>志工 2+</code>＝最少 2、不限；只寫名稱＝不限</li>
          <li>模式空白＝報名型（公告型可不寫了愿項目）；性質空白＝勤務；服裝、說明可空白</li>
          <li>第一列是欄位名稱時會自動略過</li>
        </ul>
        <button type="button" class="btn btn-small" data-example>複製範本（貼到試算表再修改）</button>
        <span class="muted" data-copied></span>
      </div>
      <textarea class="input textarea import-text" rows="8" data-text placeholder="在這裡貼上⋯">${esc(draft)}</textarea>
      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-block" data-check>檢查並預覽</button>
      </div>
      <div data-result></div>`;

    const text = body.querySelector('[data-text]');
    text.addEventListener('input', () => { draft = text.value; body.querySelector('[data-result]').innerHTML = ''; });
    body.querySelector('[data-check]').addEventListener('click', () => check());
    body.querySelector('[data-example]').addEventListener('click', async () => {
      const note = body.querySelector('[data-copied]');
      try {
        await navigator.clipboard.writeText(EXAMPLE);
        note.textContent = '已複製';
      } catch (e) {
        text.value = EXAMPLE;
        draft = EXAMPLE;
        note.textContent = '無法自動複製，範本已放進下面的框框';
      }
    });

    function check(serverErrors) {
      const rows = ImportParse.parse(text.value, groups);
      (serverErrors || []).forEach((e) => { if (rows[e.index]) rows[e.index].errors.push(e.message); });
      const bad = rows.filter((r) => r.errors.length);
      const box = body.querySelector('[data-result]');
      if (!rows.length) {
        box.innerHTML = '<div class="notice notice-error"><p>沒有可匯入的資料，請先貼上</p></div>';
        return;
      }
      box.innerHTML = `
        ${bad.length
          ? `<div class="notice notice-error" role="alert"><p><strong>${bad.length} 列有錯，請在試算表改好後重新貼上</strong></p></div>`
          : `<div class="notice notice-success" role="status"><p><strong>${rows.length} 筆都沒問題</strong></p></div>`}
        <ol class="import-rows">
          ${rows.map((r) => `
            <li class="import-row${r.errors.length ? ' is-bad' : ''}">
              <span class="import-line">第 ${r.line} 列</span>
              ${r.duty ? `
                <span class="import-main"><strong>${esc(r.duty.name)}</strong>
                  <span class="muted">${esc([r.duty.start === r.duty.end ? Fmt.rocDate(r.duty.start) : `${Fmt.rocDate(r.duty.start)} – ${Fmt.shortDate(r.duty.end)}`,
                    r.duty.startTime ? Fmt.timeRange(r.duty) : '', r.duty.location, r.duty.group, r.duty.mode === '公告型' ? '公告型' : ''].filter(Boolean).join('・'))}</span>
                  ${r.duty.positions.length ? `<span class="import-pos">${r.duty.positions.map((p) => esc(p.name + limitText(p))).join('、')}</span>` : ''}
                </span>` : `<span class="import-main">${esc(r.cells.filter(Boolean).join(' ｜ '))}</span>`}
              ${r.errors.length ? `<span class="import-errors">${r.errors.map(esc).join('<br>')}</span>` : ''}
            </li>`).join('')}
        </ol>
        ${bad.length ? '' : `<button type="button" class="btn btn-primary btn-block" data-import>匯入 ${rows.length} 筆勤務</button>`}`;
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const go = box.querySelector('[data-import]');
      if (go) go.addEventListener('click', () => submit(rows));
    }

    async function submit(rows) {
      const ok = await Confirm.open({
        title: `確定匯入 ${rows.length} 筆勤務嗎？`,
        rows: [['第一筆', `${rows[0].duty.name}・${Fmt.rocDate(rows[0].duty.start)}`], ['最後一筆', `${rows[rows.length - 1].duty.name}・${Fmt.rocDate(rows[rows.length - 1].duty.start)}`]],
        note: '匯入後如有錯誤，可到勤務管理逐筆修改或刪除。',
        confirmText: '確定匯入'
      });
      if (!ok) return;
      Busy.show(`匯入 ${rows.length} 筆勤務中⋯`, '請不要關閉畫面');
      try {
        const res = await DutyAdminPage.createDuties(rows.map((r) => r.duty));
        if (!res) { Busy.hide(); return; }
        Busy.hide();
        AdminPage.clearMemo();
        if (window.CalendarPage) CalendarPage.refresh();
        draft = '';
        DutyAdminPage.setFlash(AdminPage.notice('success', `已匯入 ${res.ids.length} 筆勤務`, ''));
        location.hash = '#/admin/duties';
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        if (err.code === 'VALIDATION' && err.details) check(err.details);
        else body.querySelector('[data-result]').insertAdjacentHTML('afterbegin', `<div class="notice notice-error" role="alert"><p>${esc(err.message || '匯入失敗')}</p></div>`);
      }
    }
  }

  function limitText(p) {
    if (!p.min && !p.max) return '（不限）';
    if (p.min && p.max) return p.min === p.max ? ` ${p.max}` : ` ${p.min}-${p.max}`;
    return p.max ? ` 最多${p.max}` : ` ${p.min}+`;
  }

  window.ImportPage = { show };
})();
