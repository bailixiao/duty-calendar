// 管理後台：匯入歷史資料（#/admin/history）。規格第 10 節。
// 選舊的《教全區勤務統計》Excel（可一次選多個）→ 在瀏覽器裡讀取（檔案不會上傳到別處）→
// 各月核對人數、確認疑似同一人的寫法 → 匯入到試算表。解析規則見 history-parse.js。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const CHUNK = 150; // 每次送出的場數，避免單次請求太久

  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SHEETJS;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入 Excel 讀取工具，請檢查網路'));
      document.head.appendChild(s);
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('讀不到檔案'));
      r.readAsArrayBuffer(file);
    });
  }

  function show(body, guard) {
    const today = Fmt.toDateStr(new Date());
    body.innerHTML = `
      <a class="back-link" href="#/admin/stats">‹ 統計</a>
      <h2 class="detail-title">匯入歷史資料</h2>
      <div class="form-block">
        <p>選擇舊的《教全區勤務統計》Excel 檔（每月一個分頁），可以一次選好幾個（例如 2025 和 2026）。</p>
        <ul class="import-rules">
          <li>檔案只在這台電腦的瀏覽器裡讀取，然後寫進你的 Google 試算表，不會傳到其他地方。</li>
          <li>匯入前會先列出各月人數，並和 Excel 的「統計」分頁核對。</li>
          <li>名字寫法不同但可能是同一人的，會請你確認要用哪個寫法。</li>
          <li>備註欄的名字當作「陪同」（不算人數）。</li>
          <li>同名同日的勤務已經存在就會略過，不小心匯入兩次也不會重複；之前匯入過的，會補上這次多讀到的人。</li>
        </ul>
        <input type="file" accept=".xlsx,.xls" multiple data-file class="input file-input">
      </div>
      <div data-result></div>`;

    body.querySelector('[data-file]').addEventListener('change', async (ev) => {
      const files = [...ev.target.files];
      if (!files.length) return;
      const box = body.querySelector('[data-result]');
      box.innerHTML = '<p class="panel-empty">讀取中⋯</p>';
      try {
        await loadSheetJs();
        const books = [];
        for (const f of files) {
          const wb = XLSX.read(await readFile(f), { type: 'array' });
          const sheets = {};
          wb.SheetNames.forEach((n) => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
          const yearHint = Number((f.name.match(/(20\d\d)/) || [])[1]) || 0;
          books.push({ file: f.name, year: yearHint, result: HistoryParse.parseWorkbook(sheets, yearHint) });
        }
        preview(box, guard, books, today);
      } catch (err) {
        box.innerHTML = `<div class="notice notice-error"><p>${esc(err.message || '讀取失敗')}</p></div>`;
      }
    });
  }

  function preview(box, guard, books, today) {
    const curMonth = today.slice(0, 7);
    // 每個月份一列；預設勾選「這個月以前」（這個月起的資料由新系統記錄，避免重複）
    const months = [];
    books.forEach((b) => b.result.months.forEach((m) => {
      if (!m.events.length) return;
      const ym = m.events[0].date.slice(0, 7);
      months.push(Object.assign({ key: `${b.file}|${m.month}`, file: b.file, ym, checked: ym < curMonth }, m));
    }));
    months.sort((a, b) => a.ym.localeCompare(b.ym));
    const merge = new Map(); // 原寫法 → 統一後的寫法

    function selected() {
      return months.filter((m) => m.checked);
    }

    function allNames() {
      return selected().flatMap((m) => m.events.flatMap((e) => e.tan.concat(e.dao, e.extra || [], e.accompany)));
    }

    function render() {
      const groups = HistoryParse.similarGroups(allNames());
      groups.forEach((g) => {
        const names = g.names.map((n) => n.name);
        if (names.some((n) => merge.has(n))) return;
        // 預設照建議：組內只有一個全名（或只差異體字）就統一成那個全名，否則各自保留
        names.forEach((n) => merge.set(n, g.suggest || n));
      });
      const sel = selected();
      const total = sel.reduce((a, m) => ({ events: a.events + m.events.length, tan: a.tan + m.tan, dao: a.dao + m.dao, extra: a.extra + (m.extra || 0) }), { events: 0, tan: 0, dao: 0, extra: 0 });

      box.innerHTML = `
        <section class="stats-section">
          <h3 class="admin-sub">各月核對</h3>
          <p class="hint">「Excel」是原檔「統計」分頁的數字（人數欄是手動填的，可能和名單對不上）；「名單」是實際讀到的名字數，匯入以名單為準。</p>
          <table class="stats-table history-table">
            <thead><tr><th>匯入</th><th>月份</th><th>場次</th><th>壇辦<br><small>名單／Excel</small></th><th>道親<br><small>名單／Excel</small></th><th>備註<br><small>計入</small></th></tr></thead>
            <tbody>${months.map((m, i) => {
              const diff = m.expected && (m.expected.tan !== m.tan || m.expected.dao !== m.dao);
              return `<tr class="${diff ? 'is-diff' : ''}">
                <td><input type="checkbox" data-month="${i}"${m.checked ? ' checked' : ''} aria-label="匯入 ${esc(m.ym)}"></td>
                <th>${Number(m.ym.slice(0, 4)) - 1911} 年 ${Number(m.ym.slice(5, 7))} 月</th>
                <td>${m.events.length}</td>
                <td>${m.tan}${m.expected ? `／${m.expected.tan}` : ''}</td>
                <td>${m.dao}${m.expected ? `／${m.expected.dao}` : ''}</td>
                <td>${m.extra || ''}</td>
              </tr>${m.problems.length ? `<tr><td></td><td colspan="5" class="warn">${m.problems.map(esc).join('<br>')}</td></tr>` : ''}`;
            }).join('')}</tbody>
          </table>
          <p class="hint">這個月起的資料由新系統記錄，預設不匯入，避免重複。</p>
        </section>

        <section class="stats-section">
          <h3 class="admin-sub">疑似同一人<span class="h2-sub">${groups.length} 組</span></h3>
          ${groups.length ? `<p class="hint">選擇要統一成哪個寫法；不是同一人就選「各自保留」。括號是出現次數。</p>
          <ul class="merge-list">${groups.map((g, gi) => {
            const names = g.names.map((n) => n.name);
            const chosen = merge.get(names[0]) === names[0] && names.every((n) => merge.get(n) === n) ? '' : merge.get(names[0]);
            return `<li class="merge-group"><div class="checks checks-col">
              ${g.names.map((n) => `<label class="check"><input type="radio" name="g${gi}" value="${esc(n.name)}"${chosen === n.name ? ' checked' : ''}> 統一成「${esc(n.name)}」（${n.count}）</label>`).join('')}
              <label class="check"><input type="radio" name="g${gi}" value=""${!chosen ? ' checked' : ''}> 各自保留（${g.names.map((n) => esc(n.name)).join('、')}）</label>
            </div></li>`;
          }).join('')}</ul>` : '<p class="muted">沒有發現寫法相近的名字。</p>'}
        </section>

        <div class="notice notice-success"><p><strong>將匯入 ${total.events} 場、壇辦 ${total.tan} 人次、道親 ${total.dao} 人次${total.extra ? `、備註計入 ${total.extra} 人次` : ""}</strong></p>${total.extra ? "<p>備註裡「工作：名字」的人算出勤，身分依同一批資料推斷（找不到就記為未填身分）。</p>" : ""}</div>
        <div class="form-error" data-error hidden></div>
        <button type="button" class="btn btn-primary btn-block" data-go${total.events ? '' : ' disabled'}>開始匯入</button>`;

      box.querySelectorAll('[data-month]').forEach((c) => c.addEventListener('change', () => {
        months[Number(c.dataset.month)].checked = c.checked;
        render();
      }));
      groups.forEach((g, gi) => box.querySelectorAll(`input[name="g${gi}"]`).forEach((r) => r.addEventListener('change', () => {
        g.names.forEach((n) => merge.set(n.name, r.value || n.name));
      })));
      box.querySelector('[data-go]').addEventListener('click', () => go(total));
    }

    async function go(total) {
      const ok = await Confirm.open({
        title: '確定開始匯入嗎？',
        rows: [['場次', `${total.events} 場`], ['壇辦', `${total.tan} 人次`], ['道親', `${total.dao} 人次`]].concat(total.extra ? [['備註計入', `${total.extra} 人次`]] : []),
        note: '匯入後會出現在行事曆的過去日期與統計表。同名同日的勤務已存在會略過。',
        confirmText: '開始匯入'
      });
      if (!ok) return;
      const fix = (list) => [...new Set(list.map((n) => merge.get(n) || n))];
      // 同名同日的兩場（原 Excel 分兩段寫）先合併，分批送出時才不會被當成已存在而略過
      const byKey = new Map();
      selected().flatMap((m) => m.events).forEach((e) => {
        const key = e.name + '|' + e.date;
        const into = byKey.get(key);
        if (!into) {
          byKey.set(key, { date: e.date, end: e.end, name: e.name, nature: e.nature, tan: fix(e.tan), dao: fix(e.dao), extra: fix(e.extra || []), accompany: fix(e.accompany) });
          return;
        }
        ['tan', 'dao', 'extra', 'accompany'].forEach((k) => { into[k] = [...new Set(into[k].concat(fix(e[k] || [])))]; });
        if (e.end > into.end) into.end = e.end;
      });
      const events = HistoryParse.inferIdentity([...byKey.values()]);
      const sum = { duties: 0, signups: 0, skipped: 0, updated: 0 };
      try {
        for (let i = 0; i < events.length; i += CHUNK) {
          Busy.show(`匯入中⋯（${Math.min(i + CHUNK, events.length)}／${events.length} 場）`, '請不要關閉畫面');
          const res = await Api.admin('adminImportHistory', { events: events.slice(i, i + CHUNK), source: books.map((b) => b.file).join('、') });
          sum.duties += res.duties;
          sum.signups += res.signups;
          sum.skipped += res.skipped;
          sum.updated += res.updated || 0;
        }
        Busy.hide();
        AdminPage.clearMemo();
        if (window.CalendarPage) CalendarPage.refresh();
        box.innerHTML = `<div class="notice notice-success" role="status"><p><strong>匯入完成：新增 ${sum.duties} 場、${sum.signups} 筆出席</strong></p>
          ${sum.updated ? `<p>之前匯入過的 ${sum.updated} 場，已補上這次多讀到的人。</p>` : ''}${sum.skipped ? `<p>已存在而略過 ${sum.skipped} 場。</p>` : ''}<p><a href="#/admin/stats">到統計頁看結果 ›</a></p></div>`;
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        const e = box.querySelector('[data-error]');
        e.innerHTML = `<strong>${esc(err.message || '匯入失敗')}</strong>${sum.duties ? `<br>已匯入 ${sum.duties} 場。可以重新按「開始匯入」，已匯入的會自動略過。` : ''}`;
        e.hidden = false;
      }
    }

    render();
  }

  window.HistoryPage = { show };
})();
