// 各佛堂道務目標（道務統計下方）：每個佛堂各項目的「目標」與「目前」，總計與達成率自動算。
// 總管理者、道務帳號可以編輯（新增、刪除佛堂、貼上匯入）；唯讀帳號只能看。佛堂名稱只存在試算表。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

  /**
   * 總計與達成率：渡人合併（group）的佛堂只算一次（數字存在第一個佛堂）。
   * 回傳 { 項目: { target, current, rate } }
   */
  function totals(rows, items) {
    const out = {};
    items.forEach((k) => {
      let t = 0; let c = 0; let hasT = false;
      const seenGroup = new Set();
      rows.forEach((r) => {
        if (k === '渡人' && r.group) {
          if (seenGroup.has(r.group)) return;
          seenGroup.add(r.group);
        }
        const v = r.values[k] || {};
        if (num(v.target) !== null) { t += num(v.target); hasT = true; }
        if (num(v.current) !== null) c += num(v.current);
      });
      out[k] = { target: hasT ? t : null, current: c, rate: hasT && t ? c / t : null };
    });
    return out;
  }

  /** 渡人合併：連在一起、同一個 group 的佛堂，第一列的渡人格子跨幾列 */
  function groupSpans(rows) {
    const span = rows.map(() => 1);
    for (let i = 0; i < rows.length; i++) {
      const g = rows[i].group;
      if (!g || span[i] === 0) continue;
      let j = i + 1;
      while (j < rows.length && rows[j].group === g) { span[j] = 0; j++; }
      span[i] = j - i;
    }
    return span;
  }

  function mount(el, year, opts) {
    const canEdit = !!opts.canEdit;
    let data = null;
    let editing = null; // 編輯中的複本
    let flash = '';

    async function load() {
      el.innerHTML = '<p class="muted">載入各佛堂道務目標中⋯</p>';
      try {
        data = await Api.admin('adminGoals', { year });
        draw();
      } catch (err) {
        if (opts.guard && opts.guard(err)) return;
        el.innerHTML = `<p class="muted">${esc(err.message || '讀取失敗')}</p>`;
      }
    }

    function draw() {
      const rows = editing || data.rows;
      const items = data.items;
      const span = groupSpans(rows);
      const tot = totals(rows, items);
      const pct = (v) => (v === null ? '' : Math.round(v * 100) + '%');
      const roc = year - 1911;
      const cell = (r, k, which, i) => {
        const v = (r.values[k] || {})[which];
        return `<input class="input goal-num" inputmode="numeric" data-r="${i}" data-k="${esc(k)}" data-w="${which}" value="${esc(v || '')}" aria-label="${esc(r.name)} ${esc(k)}${which === 'target' ? '目標' : '目前'}">`;
      };
      // 看的時候：「目前／目標」合成一格，底色看進度（沒開始白、做到一部分淺黃、達成綠 ✓）
      const level = (t, c) => (t === null ? (c ? 'part' : '') : c >= t ? 'done' : c > 0 ? 'part' : 'zero');
      const showCell = (v) => {
        const t = num(v.target);
        const c = num(v.current) || 0;
        if (t === null && !c) return { cls: '', html: '' };
        const lv = level(t, c);
        return { cls: lv ? ` is-${lv}` : '', html: t === null ? String(c) : `${c}<span class="goal-of">／${t}</span>${lv === 'done' ? ' ✓' : ''}` };
      };
      // 最上面：全區進度條（有目標的項目）
      const bars = items.filter((k) => tot[k].target !== null).map((k) => {
        const t = tot[k].target;
        const c = tot[k].current;
        const w = t ? Math.min(100, Math.round((c / t) * 100)) : 0;
        return `
          <li class="goal-bar${c >= t ? ' is-done' : ''}">
            <span class="goal-bar-name">${esc(k)}</span>
            <span class="goal-bar-track" role="img" aria-label="${esc(k)} ${c}／${t}"><span class="goal-bar-fill" style="width:${w}%"></span></span>
            <span class="goal-bar-num"><strong>${c}</strong>／${t}（${pct(t ? c / t : 0)}）</span>
            <span class="goal-bar-left">${c >= t ? '✓ 達成' : `還差 ${t - c}`}</span>
          </li>`;
      }).join('');

      el.innerHTML = `
        <h3 class="admin-sub"><span class="nw">${roc} 年各佛堂道務目標</span></h3>
        ${flash}
        ${!rows.length && !editing ? `<p class="muted">${roc} 年還沒有填目標。${canEdit ? '按「編輯」新增佛堂，或用「貼上匯入」一次填好。' : ''}</p>` : editing ? `
        <div class="goal-wrap">
          <table class="goal-table">
            <thead>
              <tr><th rowspan="2" class="goal-sticky">佛堂</th>${items.map((k) => `<th colspan="2">${esc(k)}</th>`).join('')}<th rowspan="2">立愿</th><th rowspan="2">渡人合併</th><th rowspan="2"></th></tr>
              <tr>${items.map(() => `<th class="goal-sub">目標</th><th class="goal-sub">目前</th>`).join('')}</tr>
            </thead>
            <tbody>${rows.map((r, i) => `
              <tr>
                <th scope="row" class="goal-sticky"><input class="input goal-name" data-r="${i}" data-name value="${esc(r.name)}" placeholder="佛堂名稱"></th>
                ${items.map((k) => {
                  if (k === '渡人' && span[i] === 0) return '<td class="goal-merged" colspan="2">（同上）</td>';
                  return `<td class="goal-t">${cell(r, k, 'target', i)}</td><td class="goal-c">${cell(r, k, 'current', i)}</td>`;
                }).join('')}
                <td class="goal-vow"><input class="input" data-r="${i}" data-vow value="${esc(r.vow)}" placeholder="例：壇主 ○○"></td>
                <td><input class="input goal-group" data-r="${i}" data-group value="${esc(r.group)}" placeholder="可空白"></td>
                <td><button type="button" class="btn btn-small btn-quiet-danger" data-del="${i}">刪除</button></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : `
        ${bars ? `<ul class="goal-bars">${bars}</ul>` : ''}
        <p class="goal-legend"><span class="goal-key is-zero">還沒開始</span><span class="goal-key is-part">做到一部分</span><span class="goal-key is-done">達成 ✓</span><span class="muted">格子裡是「目前／目標」</span></p>
        <div class="goal-wrap">
          <table class="goal-table goal-view">
            <thead>
              <tr><th class="goal-sticky">佛堂</th>${items.map((k) => `<th>${esc(k)}</th>`).join('')}<th>立愿</th></tr>
            </thead>
            <tbody>${rows.map((r, i) => `
              <tr>
                <th scope="row" class="goal-sticky">${esc(r.name)}</th>
                ${items.map((k) => {
                  if (k === '渡人' && span[i] === 0) return '';
                  const rs = k === '渡人' && span[i] > 1 ? ` rowspan="${span[i]}"` : '';
                  const sc = showCell(r.values[k] || {});
                  return `<td${rs} class="goal-cell${sc.cls}">${sc.html}</td>`;
                }).join('')}
                <td class="goal-vow">${esc(r.vow)}</td>
              </tr>`).join('')}</tbody>
            <tfoot>
              <tr><th class="goal-sticky">總計</th>${items.map((k) => {
                const sc = showCell({ target: tot[k].target === null ? '' : tot[k].target, current: tot[k].current });
                return `<td class="goal-cell${sc.cls}">${sc.html}</td>`;
              }).join('')}<td></td></tr>
              <tr><th class="goal-sticky">達成率</th>${items.map((k) => `<td class="${tot[k].rate !== null && tot[k].rate >= 1 ? 'is-done' : ''}">${pct(tot[k].rate)}</td>`).join('')}<td></td></tr>
            </tfoot>
          </table>
        </div>`}
        ${editing ? `
          <div class="admin-actions no-print">
            <button type="button" class="btn" data-add>＋ 新增佛堂</button>
            <button type="button" class="btn" data-import>貼上匯入</button>
          </div>
          <p class="hint">數字可以空白。「渡人合併」：幾個佛堂共用一個渡人目標時填同一個名稱（例：海外），要排在一起，數字填在第一個。</p>
          <div class="form-error" data-err hidden></div>
          <div class="admin-actions">
            <button type="button" class="btn btn-primary" data-save>儲存</button>
            <button type="button" class="btn" data-cancel>取消</button>
          </div>` : canEdit ? `
          <div class="admin-actions no-print">
            <button type="button" class="btn btn-primary" data-edit>✏️ 編輯${rows.length ? '（更新「目前」數字）' : ''}</button>
          </div>` : ''}`;
      bind();
    }

    function bind() {
      const q = (sel) => el.querySelector(sel);
      if (q('[data-edit]')) q('[data-edit]').addEventListener('click', () => { flash = ''; editing = JSON.parse(JSON.stringify(data.rows)); draw(); });
      if (!editing) return;
      el.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('input', () => {
        const r = editing[Number(x.dataset.r)];
        if (x.dataset.k) { r.values[x.dataset.k] = r.values[x.dataset.k] || { target: '', current: '' }; r.values[x.dataset.k][x.dataset.w] = x.value.trim(); }
        else if (x.dataset.name !== undefined) r.name = x.value;
        else if (x.dataset.vow !== undefined) r.vow = x.value;
        else if (x.dataset.group !== undefined) r.group = x.value.trim();
      }));
      el.querySelectorAll('[data-group]').forEach((x) => x.addEventListener('change', () => draw())); // 合併的格子要重畫
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { editing.splice(Number(b.dataset.del), 1); draw(); }));
      q('[data-add]').addEventListener('click', () => {
        editing.push({ name: '', values: {}, vow: '', group: '' });
        draw();
        const names = el.querySelectorAll('[data-name]');
        names[names.length - 1].focus();
      });
      q('[data-import]').addEventListener('click', openImport);
      q('[data-cancel]').addEventListener('click', () => { editing = null; draw(); });
      q('[data-save]').addEventListener('click', save);
    }

    function openImport() {
      const m = Modal.open(`
        <h2 class="modal-title">貼上匯入</h2>
        <p class="modal-note">把整理好的文字（從「[」到「]」）整段貼上，會取代目前編輯中的表格，還沒存檔前都可以取消。</p>
        <textarea class="input textarea" rows="8" data-text></textarea>
        <div class="form-error" data-ierr hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-block btn-primary" data-ok>帶入表格</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>`);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-ok]').addEventListener('click', () => {
        const box = m.el.querySelector('[data-ierr]');
        try {
          const list = JSON.parse(m.el.querySelector('[data-text]').value.trim());
          if (!Array.isArray(list) || list.some((r) => !r || !r.name)) throw new Error();
          editing = list.map((r) => ({ name: String(r.name), vow: String(r.vow || ''), group: String(r.group || ''), values: Object.fromEntries(data.items.map((k) => {
            const v = (r.values && r.values[k]) || {};
            return [k, { target: v.target === undefined ? '' : String(v.target), current: v.current === undefined ? '' : String(v.current) }];
          })) }));
          m.close();
          draw();
        } catch (e) {
          box.textContent = '格式不對，請確認整段都有貼到（從「[」到「]」）';
          box.hidden = false;
        }
      });
    }

    async function save() {
      const box = el.querySelector('[data-err]');
      Busy.show('儲存中⋯');
      try {
        data = await Api.admin('adminSaveGoals', { year, rows: editing });
        Busy.hide();
        editing = null;
        flash = AdminPage.notice('success', '已儲存各佛堂道務目標', '');
        draw();
      } catch (err) {
        Busy.hide();
        if (opts.guard && opts.guard(err)) return;
        box.innerHTML = `<strong>${esc(err.message || '儲存失敗')}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        box.hidden = false;
      }
    }

    load();
  }

  const api = { mount, totals, groupSpans };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.GoalsPage = api;
})();
