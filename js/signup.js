// 報名表單：選了愿項目（額滿反灰）→ 選日期（多天勤務）→ 填名字（自動提示、可多人、選道親／壇辦／未求道；壇辦可選了愿／陪同）→ 確認報名。
// 名額與重複的最終判斷在伺服器（LockService 鎖定），這裡只做提示。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const SEARCH_LIMIT = 10; // 與後端 MEMBER_SEARCH_LIMIT 相同；結果少於此數代表已完整
  const IDENTITIES = ['道親', '壇辦', '未求道'];
  const KNOWN_IDENTITIES = IDENTITIES.concat(['點傳師']); // 成員名單上可能登記的（點傳師只由名單帶入）

  function normalize(name) {
    return String(name || '').replace(/^[\s　]+|[\s　]+$/g, '');
  }

  function mount(el, duty, defaultDate, onSuccess) {
    const allDates = Fmt.datesBetween(duty.start, duty.end);
    const openDates = allDates.filter((d) => d > duty.today); // 勤務當天（含）之後不能報名
    const multiDay = allDates.length > 1;
    const state = {
      // 選到的了愿項目；可兼任的勤務可以複選，其他勤務最多一個
      positionIds: new Set(duty.positions.length === 1 ? [duty.positions[0].id] : []),
      dates: new Set([openDates.indexOf(defaultDate) !== -1 ? defaultDate : openDates[0]]),
      entries: [], // { name, identity: '道親'|'壇辦'|'未求道'|'', accompany }
      leader: '', // 勤務有組長職稱時：這次報名誰當組長（名字；空白＝這次沒有）
      showMissing: false, // 送出時有人沒選身分，標示出來
      submitting: false
    };
    const searchCache = new Map(); // 查詢字 → 成員陣列
    const knownIdentity = new Map(); // 提示中出現過的成員 → 成員名單上的身分
    let searchToken = 0;
    let searchTimer = null;
    let step = 1;
    // 可兼任（可報多項）的勤務：上面只顯示名額，每個人在自己的名字卡勾項目，不會上下兩處都能選
    const perPerson = !!duty.multi && duty.positions.length > 1;
    // 道務、教育的活動只有一個「參加」：不用選項目，直接填名字
    const single = (duty.category === '道務' || duty.category === '教育') && duty.positions.length === 1;

    el.innerHTML = `
      <h2>我要報名</h2>
      <form class="signup-form" novalidate>
        <fieldset class="field"${perPerson || single ? ' hidden' : ''}>
          <legend>${perPerson || single ? '了愿項目名額' : `<span class="step">${step++}</span>選了愿項目`}</legend>
          <div class="choices" data-positions></div>
          ${perPerson ? '<p class="hint">這個勤務可以一人兼任多個項目：加入名字後，在每個人的名字下面勾他要報的項目（可以勾好幾項）。</p>' : ''}
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
          ${duty.leaderTitle ? '<div class="leader-pick" data-leader-pick></div>' : ''}
          <p class="hint">幫長輩或家人報名時，可以連續加入多個名字${perPerson ? '，每個名字下面各自勾項目' : duty.positions.length > 1 ? '；有人要報不同的了愿項目，按他名字下的<span class="nw">「這個人改報別的」</span>' : ''}。每個名字都要選<span class="nw">「道親」</span><span class="nw">「壇辦」</span>或<span class="nw">「未求道」</span>（成員名單上已登記的會自動帶入，不能改）。壇辦可選<span class="nw">「陪同」</span>，陪同不佔名額。</p>
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
        const checked = state.positionIds.has(p.id) && !fullAll;
        let sub;
        if (fullAll) sub = '額滿';
        else if (dates.length === 1) {
          const c = count(dates[0], p.id);
          sub = p.max !== null ? `已報 ${c}／${p.max}` : `已報 ${c} 人`;
        } else sub = p.max !== null ? `每天 ${p.max} 人` : '不限人數';
        if (perPerson) {
          return `<div class="choice is-static${fullAll ? ' is-disabled' : ''}"><span class="choice-main">${esc(p.name)}</span><span class="choice-sub">${esc(sub)}</span></div>`;
        }
        return `
          <label class="choice${fullAll ? ' is-disabled' : ''}${checked ? ' is-checked' : ''}">
            <input type="radio" name="position" value="${esc(p.id)}"${checked ? ' checked' : ''}${fullAll ? ' disabled' : ''}>
            <span class="choice-main">${esc(p.name)}${p.slot && p.name.indexOf(p.slot) === -1 ? `<small>${esc(p.slot)}</small>` : ''}</span>
            <span class="choice-sub">${esc(sub)}</span>
          </label>`;
      }).join('');
      // 額滿（不能勾）的項目從選擇中拿掉
      if (!perPerson) state.positionIds.forEach((id) => { const el = $(`[data-positions] input[value="${id}"]`); if (!el || !el.checked) state.positionIds.delete(id); });
    }

    /** 已選的日期（沒選日期時看所有還能報的日子）這個項目都額滿了 */
    function positionFull(p) {
      const dates = state.dates.size ? Array.from(state.dates) : allDates.filter((d) => d > duty.today);
      return dates.length > 0 && dates.every((d) => isFull(p, d));
    }

    // ---------- 日期（多天勤務） ----------

    /** 組長：選的日期已經有組長就只顯示是誰；沒有就讓這次報名的其中一位當（陪同的不行） */
    function renderLeader() {
      const box = $('[data-leader-pick]');
      if (!box) return;
      const title = duty.leaderTitle;
      const taken = (duty.signups || []).filter((s) => s.leader && state.dates.has(s.date));
      if (taken.length) {
        state.leader = '';
        box.innerHTML = `<p class="leader-taken">★ 已經有${esc(title)}：<strong>${esc([...new Set(taken.map((s) => s.name))].join('、'))}</strong></p>`;
        return;
      }
      const can = state.entries.filter((e) => !e.accompany);
      if (!can.some((e) => e.name === state.leader)) state.leader = '';
      box.innerHTML = `
        <p class="leader-title">★ ${esc(title)}<small>每天一位就好，還沒有人當</small></p>
        ${can.length ? `<div class="leader-options">${can.map((e) => `<label class="segment${state.leader === e.name ? ' is-checked' : ''}"><input type="radio" name="leader" value="${esc(e.name)}" data-leader-name${state.leader === e.name ? ' checked' : ''}>${esc(e.name)}</label>`).join('')}
          <label class="segment${!state.leader ? ' is-checked' : ''}"><input type="radio" name="leader" value="" data-leader-name${!state.leader ? ' checked' : ''}>這次沒有</label></div>`
          : '<p class="muted">加入名字後，可以選一位當' + esc(title) + '。</p>'}`;
    }

    function renderDates() {
      renderLeader();
      if (!multiDay) return;
      const chosen = duty.positions.filter((p) => state.positionIds.has(p.id) || state.entries.some((e) => e.positionIds.has(p.id)));
      const position = chosen.length === 1 ? chosen[0] : null; // 只選一項時才顯示該項人數
      $('[data-dates]').innerHTML = allDates.map((d) => {
        const past = d <= duty.today;
        const full = chosen.some((p) => isFull(p, d)); // 複選時，任一項額滿那天就不能選（整批報名）
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
        const posMissing = state.showMissing && e.custom && !e.positionIds.size;
        return `
        <li class="name-item${missing || posMissing ? ' is-missing' : ''}">
          <div class="name-top">
            <span class="name-text">${esc(e.name)}${e.temple ? `<small class="name-temple">${esc(e.temple)}</small>` : ''}${e.typed ? `<small class="name-typed">打「${esc(e.typed)}」，已對到成員名單</small>` : ''}</span>
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
            ${duty.positions.length > 1 ? (e.custom ? `<div class="option-row">
              <span class="option-label">項目</span>
              <div>
                <div class="pos-chips" role="group" aria-label="${esc(e.name)} 的了愿項目">
                  ${duty.positions.map((p) => { const full = !e.positionIds.has(p.id) && positionFull(p); return `<label class="pos-chip${e.positionIds.has(p.id) ? ' is-checked' : ''}${full ? ' is-disabled' : ''}">
                    <input type="${duty.multi ? 'checkbox' : 'radio'}" name="epos-${i}" value="${esc(p.id)}" data-entry-pos="${i}"${e.positionIds.has(p.id) ? ' checked' : ''}${full ? ' disabled' : ''}>${esc(p.name)}${full ? '<small>額滿</small>' : ''}</label>`; }).join('')}
                </div>
                ${perPerson ? '' : `<button type="button" class="link-btn" data-pos-reset="${i}">改回跟上面一樣</button>`}
              </div>
            </div>` : `<div class="option-row">
              <span class="option-label">項目</span>
              <div class="pos-same">
                <span>${state.positionIds.size ? esc(duty.positions.filter((p) => state.positionIds.has(p.id)).map((p) => p.name).join('、')) : '<span class="muted">請在上面選了愿項目</span>'}<span class="muted">（同上面）</span></span>
                <button type="button" class="link-btn" data-pos-custom="${i}">這個人改報別的</button>
              </div>
            </div>`) : ''}
            ${e.identity === '壇辦' ? `<div class="option-row">
              <span class="option-label">方式</span>
              <div class="segmented" role="radiogroup" aria-label="${esc(e.name)} 的參加方式">
                ${[['了愿', false], ['陪同', true]].map(([label, value]) => `
                  <label class="segment${e.accompany === value ? ' is-checked' : ''}">
                    <input type="radio" name="accompany-${i}" value="${value}" data-accompany="${i}"${e.accompany === value ? ' checked' : ''}>${label}
                  </label>`).join('')}
              </div>
            </div>` : ''}
            ${duty.layout === '職司表' ? `<label class="option-row note-row">
              <span class="option-label">註記</span>
              <input class="input" data-entry-note="${i}" maxlength="100" value="${esc(e.note || '')}" placeholder="例：8:00-19:00、代理人" aria-label="${esc(e.name)} 的註記">
            </label>` : ''}
          </div>
          ${missing ? '<p class="name-missing">請選擇道親、壇辦或未求道</p>' : ''}
          ${posMissing ? '<p class="name-missing">請選這個人的了愿項目</p>' : ''}
        </li>`;
      }).join('');
      renderLeader();
      const n = state.entries.length;
      $('[data-submit]').textContent = state.submitting ? '報名中⋯' : n ? `確認報名（${n} 人）` : '確認報名';
    }

    /**
     * 成員名單上已登記身分的人：身分固定（locked），報名者不能改（統計以成員名單為準）。
     * 從提示點選時直接帶入；手動輸入的名字到成員名單查一次，完全同名且有身分就帶入並固定。
     */
    function addName(raw, identity, temple) {
      const name = normalize(raw);
      if (!name) return false;
      temple = temple || '';
      // 同一人：名字相近，且佛堂沒有不同（兩邊都有佛堂又不同就是兩個人）
      const same = state.entries.find((e) => Fmt.sameName(e.name, name) && !(e.temple && temple && e.temple !== temple));
      if (same) {
        showError(same.name === name ? `「${name}」已經在名單裡了` : `「${name}」與「${same.name}」視為同一人，已經在名單裡了`);
        return false;
      }
      const known = identity !== undefined ? identity : knownIdentity.get(name + '|');
      const fixed = KNOWN_IDENTITIES.indexOf(known) !== -1 ? known : '';
      // 項目先用上面選的；之後可以在名字卡各自改（custom＝改過，上面再改就不跟著變）
      const entry = { name, temple, identity: fixed, accompany: false, locked: !!fixed, positionIds: perPerson ? new Set() : new Set(state.positionIds), custom: perPerson };
      state.entries.push(entry);
      hideError();
      renderNames();
      flyIn(state.entries.length - 1);
      if (!fixed && known === undefined) lookupIdentity(entry);
      return true;
    }

    /**
     * 加入的動畫：新的名字卡從輸入框的位置滑下來、放大到名單裡（結尾彈一下），再亮黃色，讓人清楚知道加進去了。
     * 直接移動名字卡本身（不用浮在畫面上的標籤），iPhone 鍵盤打開時位置也不會跑掉。
     */
    function flyIn(index) {
      const li = $('[data-names]').children[index];
      if (!li) return;
      li.classList.add('is-new');
      setTimeout(() => li.classList.remove('is-new'), 1800);
      const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || !li.animate) return;
      const dy = input.getBoundingClientRect().top - li.getBoundingClientRect().top;
      li.animate([
        { transform: `translateY(${dy}px) scale(.55)`, opacity: 0.2, offset: 0 },
        { transform: 'translateY(6px) scale(1.03)', opacity: 1, offset: 0.75 },
        { transform: 'none', opacity: 1, offset: 1 }
      ], { duration: 700, easing: 'cubic-bezier(.3, .7, .3, 1)' });
      setTimeout(() => {
        const r = li.getBoundingClientRect();
        if (r.bottom > window.innerHeight - 20 || r.top < 0) li.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 720);
    }

    /** 手動輸入的名字：查成員名單，完全同名且有身分就帶入並固定 */
    async function lookupIdentity(entry) {
      try {
        const res = await Api.searchMembers(entry.name, duty.groupType, duty.group);
        // 打的是別名：換成真名
        const byAlias = res.members.filter((x) => x.alias === entry.name);
        if (byAlias.length === 1 && !res.members.some((x) => x.name === entry.name)) {
          entry.name = byAlias[0].name;
          entry.temple = entry.temple || byAlias[0].temple || '';
        }
        // 只打名字、沒打姓（例：榮欽）：名單上只有一位「〇榮欽」就換成全名；好幾位就請他點選
        if (entry.name.length >= 2 && !res.members.some((x) => x.name === entry.name) && !byAlias.length) {
          const given = res.members.filter((x) => x.name.length > entry.name.length && x.name.length <= entry.name.length + 2 && x.name.slice(-entry.name.length) === entry.name);
          if (given.length === 1) {
            const full = given[0];
            const dup = state.entries.find((o) => o !== entry && o.name === full.name && (o.temple || '') === (full.temple || ''));
            if (dup) { state.entries.splice(state.entries.indexOf(entry), 1); renderNames(); showError(`「${entry.name}」就是「${full.name}」，已經在名單裡了`); return; }
            entry.typed = entry.name;
            entry.name = full.name;
            entry.temple = entry.temple || full.temple || '';
          } else if (given.length > 1) {
            renderNames();
            showError(`名單上有好幾位名字是「${entry.name}」：${given.map((x) => x.name + (x.temple ? '（' + x.temple + '）' : '')).join('、')}。請移除這張卡片，打字後從名字提示點選是哪一位`);
            return;
          }
        }
        const same = res.members.filter((x) => x.name === entry.name);
        if (same.length > 1 && !entry.temple) { showError(`名單上有 ${same.length} 位「${entry.name}」（${same.map((x) => x.temple || '未填佛堂').join('、')}），請移除後從名字提示點選是哪一位`); return; }
        const m = same[0];
        if (!m || KNOWN_IDENTITIES.indexOf(m.identity) === -1 || state.entries.indexOf(entry) === -1) { renderNames(); return; }
        entry.identity = m.identity;
        entry.locked = true;
        if (entry.identity !== '壇辦') entry.accompany = false;
        renderNames();
      } catch (e) { /* 查不到就讓報名者自己選，伺服器存檔時仍會以成員名單為準 */ }
    }

    /** 一格打了好幾個名字（王小明.測試甲、王小明 測試甲）就拆開；空白只在每段都是兩個字以上的中文時才算分隔 */
    function splitInput(raw) {
      const byMark = String(raw || '').split(/[、,，.。．\/／;；|]+/).map(normalize).filter(Boolean);
      return byMark.flatMap((part) => {
        const bySpace = part.split(/[\s　]+/).filter(Boolean);
        return bySpace.length > 1 && bySpace.every((x) => /^[\u4e00-\u9fff]{2,}$/.test(x)) ? bySpace : [part];
      });
    }

    function addFromInput() {
      const parts = splitInput(input.value);
      if (parts.length > 1) {
        let added = 0;
        parts.forEach((p) => { if (addName(p)) added += 1; });
        input.value = '';
        clearSuggestions();
        if (added) {
          const note = document.createElement('p');
          note.className = 'hint split-note';
          note.textContent = `已幫您分成 ${added} 個名字，一個名字一張卡片 😊`;
          const old = el.querySelector('.split-note');
          if (old) old.remove();
          $('[data-names]').insertAdjacentElement('beforebegin', note);
          setTimeout(() => note.remove(), 6000);
        }
        input.focus();
        return;
      }
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

    /** pending：伺服器還沒回來，先顯示查過的結果，後面加「搜尋中」 */
    function renderSuggestions(list, pending) {
      const taken = new Set(state.entries.map((e) => e.name + '|' + (e.temple || '')));
      const items = list.filter((m) => !taken.has(m.name + '|' + (m.temple || '')));
      items.forEach((m) => { knownIdentity.set(m.name + '|' + (m.temple || ''), m.identity || ''); if (!m.dup) knownIdentity.set(m.name + '|', m.identity || ''); });
      const inGroup = (m) => duty.groupType && duty.group && m.groups && m.groups[duty.groupType] === duty.group;
      $('[data-suggestions]').innerHTML = items.length
        ? items.map((m) => `<button type="button" class="suggestion" data-suggest="${esc(m.name)}" data-temple="${esc(m.temple || '')}">${esc(m.name)}${m.alias ? `<small>${esc(m.alias)}</small>` : ''}${m.dup ? `<small>${esc(m.temple || '未填佛堂')}</small>` : ''}${inGroup(m) ? '<small>本組</small>' : ''}</button>`).join('')
        : '';
      if (pending) $('[data-suggestions]').insertAdjacentHTML('beforeend', '<span class="muted small">搜尋更多中⋯</span>');
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
      // 伺服器每次約 1.5–2 秒：先用查過的結果（不完整也沒關係）在本機篩選先顯示，等伺服器回來再補齊
      const early = partialFromCache(q);
      if (early.length) renderSuggestions(early, true);
      searchTimer = setTimeout(async () => {
        const t = ++searchToken;
        if (!early.length) $('[data-suggestions]').innerHTML = '<span class="muted small">搜尋中⋯ 也可以直接打完整名字按「加入」</span>';
        try {
          const res = await Api.searchMembers(q, duty.groupType, duty.group);
          searchCache.set(q, res.members);
          if (t === searchToken) renderSuggestions(res.members);
        } catch (e) {
          if (t === searchToken && !early.length) $('[data-suggestions]').innerHTML = '';
        }
      }, 250);
    }

    /** 查過的結果中，名字含有這次輸入的（可能不完整，只是先顯示） */
    function partialFromCache(q) {
      const seen = new Map();
      for (const list of searchCache.values()) list.forEach((m) => { if (m.name.indexOf(q) !== -1) seen.set(m.name, m); });
      return [...seen.values()];
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
      if (normalize(input.value)) { // 打了名字但還沒按「加入」：提醒他按，不自動加入
        showError(`「${esc(normalize(input.value))}」還沒加入名單，請先按旁邊的「加入」`);
        input.focus();
        return;
      }

      const problems = [];
      // 共用的項目沒選（有人跟著上面）→ 請選上面；改報別的人沒選 → 請選他自己的
      if (!perPerson && !state.positionIds.size && (!state.entries.length || state.entries.some((e) => !e.custom))) problems.push('請選擇了愿項目');
      if (state.entries.some((e) => e.custom && !e.positionIds.size)) {
        problems.push(perPerson ? '請在每個名字下面勾他要報的了愿項目' : '改報別的人，請選他的了愿項目');
        state.showMissing = true;
        renderNames();
      }
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
      const nameOf = (id) => (duty.positions.find((p) => p.id === id) || {}).name || '';
      const chosen = duty.positions.filter((p) => state.entries.some((e) => e.positionIds.has(p.id)));
      const payload = {
        dutyId: duty.id,
        positionId: chosen[0].id,
        positionIds: chosen.map((p) => p.id),
        dates: Array.from(state.dates).sort(),
        entries: state.entries.map((e) => ({ name: e.name, temple: e.temple || '', identity: e.identity, accompany: e.accompany, leader: !!duty.leaderTitle && !e.accompany && e.name === state.leader, note: duty.layout === '職司表' ? String(e.note || '').trim() : '', positionIds: duty.positions.filter((p) => e.positionIds.has(p.id)).map((p) => p.id) }))
      };
      // 每個人報的項目不一樣時，成功訊息逐人列出
      const same = payload.entries.every((e) => e.positionIds.join() === payload.entries[0].positionIds.join());
      const result = {
        dutyId: duty.id, dates: payload.dates, positionId: chosen[0].id,
        positionName: same ? payload.entries[0].positionIds.map(nameOf).join('、') : '',
        entries: payload.entries.map((e) => Object.assign({}, e, { positionLabel: e.positionIds.map(nameOf).join('、') }))
      };
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
      const added = fresh.signups.filter((s) => !knownIds.has(s.id) && payload.positionIds.indexOf(s.positionId) !== -1);
      const found = [];
      for (const e of payload.entries) {
        for (const pid of e.positionIds) {
          for (const date of payload.dates) {
            const s = added.find((x) => x.positionId === pid && x.date === date && x.name === e.name);
            if (!s) return found.length ? null : false;
            found.push({ id: s.id, date, name: s.name, identity: e.identity, accompany: s.accompany, positionId: pid });
          }
        }
      }
      return { created: found, days: fresh.days };
    }

    // ---------- 事件 ----------

    $('[data-positions]').addEventListener('change', (ev) => {
      if (duty.multi) {
        if (ev.target.checked) state.positionIds.add(ev.target.value);
        else state.positionIds.delete(ev.target.value);
      } else {
        state.positionIds = new Set([ev.target.value]);
      }
      state.entries.forEach((e) => { if (!e.custom) e.positionIds = new Set(state.positionIds); });
      renderNames();
      renderPositions();
      renderDates();
    });

    if (multiDay) {
      $('[data-dates]').addEventListener('change', (ev) => {
        if (ev.target.checked) state.dates.add(ev.target.value);
        else state.dates.delete(ev.target.value);
        renderDates();
        renderPositions();
        if (perPerson) renderNames();
      });
    }

    $('[data-add]').addEventListener('click', addFromInput);
    input.addEventListener('input', onInput);
    input.addEventListener('focus', () => { if (!searchCache.size) Api.warmUp(); }, { once: true });
    // 鍵盤上的「✓／Enter」不加入名字（注音選字時常按到，會把還沒打完的字加進去，甚至送出報名），只收起鍵盤；
    // 一定要按「加入」按鈕（或點提示的名字）才算加入
    input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      input.blur();
    });

    $('[data-suggestions]').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-suggest]');
      if (!btn) return;
      addName(btn.dataset.suggest, knownIdentity.get(btn.dataset.suggest + '|' + (btn.dataset.temple || '')), btn.dataset.temple || '');
      input.value = '';
      clearSuggestions();
      input.focus();
    });

    $('[data-names]').addEventListener('click', (ev) => {
      // 這個人改報別的項目：展開自己的選擇（先帶入上面選的）
      const custom = ev.target.closest('[data-pos-custom]');
      if (custom) {
        const entry = state.entries[Number(custom.dataset.posCustom)];
        entry.custom = true;
        entry.positionIds = new Set(state.positionIds);
        renderNames();
        return;
      }
      // 改回跟上面一樣
      const reset = ev.target.closest('[data-pos-reset]');
      if (reset) {
        const entry = state.entries[Number(reset.dataset.posReset)];
        entry.custom = false;
        entry.positionIds = new Set(state.positionIds);
        renderNames();
        renderDates();
        return;
      }
      const btn = ev.target.closest('[data-remove]');
      if (!btn) return;
      state.entries.splice(Number(btn.dataset.remove), 1);
      renderNames();
    });

    const leaderBox = $('[data-leader-pick]');
    if (leaderBox) leaderBox.addEventListener('change', (ev) => {
      if (ev.target.dataset.leaderName !== undefined) { state.leader = ev.target.value; renderLeader(); }
    });
    $('[data-names]').addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.entryPos !== undefined) {
        const entry = state.entries[Number(t.dataset.entryPos)];
        if (duty.multi) { if (t.checked) entry.positionIds.add(t.value); else entry.positionIds.delete(t.value); }
        else entry.positionIds = new Set([t.value]);
        entry.custom = true;
        renderNames();
        renderDates();
        return;
      }
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

    // 職司表的註記：打字時只記下來，不重畫（避免游標跑掉）
    form.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.dataset.entryNote !== undefined) state.entries[Number(t.dataset.entryNote)].note = t.value;
    });
    form.addEventListener('submit', submit);

    renderPositions();
    renderDates();
    renderPositions(); // 日期可能因額滿被移除，了愿項目狀態再算一次
    renderNames();
  }

  window.SignupForm = { mount };
})();
