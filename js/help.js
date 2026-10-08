// 常見問題與教學：家人們的「❓ 常見問題」（#/help）、後台「📖 教學」與總管理者的編輯（見 apps-script/Faq.gs）。
//   - 答案格式：一行一段；「1. 」步驟（①②③）；「- 」條列；**粗體**；![說明](圖片)；[文字](#/網址)。
//     圖片寫 img/help/… 是網站裡的檔案，寫 F-… 是後台上傳的（同 DM）。
//   - 搜尋在手機上直接做：比對問題、別稱、答案，並把常見說法換成系統用詞（例：退出 → 取消）。
//   - 加到主畫面：猜使用者的手機，把最可能的那題排第一。
(function () {
  'use strict';

  const esc = Fmt.esc;

  // ---------- 答案格式 ----------

  function imgSrc(src) {
    if (/^F-[\w-]+$/.test(src)) return Api.fileUrl(src);
    if (/^img\/[\w./-]+$/.test(src) || /^https:\/\//.test(src)) return src;
    return '';
  }

  /** 一行裡的粗體、連結、搜尋標記（先跳脫再換） */
  function inline(text, marks) {
    let h = esc(text);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\[([^\]]+)\]\(((?:#\/|https:\/\/)[^)\s]*)\)/g, (m, label, url) =>
      `<a href="${url}"${url.indexOf('https://') === 0 ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`);
    return marks ? markText(h, marks) : h;
  }

  /** 在已經是 HTML 的文字裡把搜尋的字標黃（不動標籤） */
  function markText(html, marks) {
    const words = marks.filter((w) => w && w.length >= 1).map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return html;
    const re = new RegExp('(' + words.join('|') + ')', 'gi');
    return html.split(/(<[^>]+>)/).map((part) => (part.charAt(0) === '<' ? part : part.replace(re, '<mark>$1</mark>'))).join('');
  }

  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

  function render(markup, marks) {
    const out = [];
    let list = null; // 'ol' | 'ul'
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    String(markup || '').split('\n').forEach((raw) => {
      const line = raw.trim();
      const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      const step = line.match(/^(\d{1,2})\.\s+(.*)$/);
      const bullet = line.match(/^[-・]\s+(.*)$/);
      if (!line) { close(); return; }
      if (img) {
        close();
        const src = imgSrc(img[2]);
        if (src) out.push(`<figure class="help-fig"><img src="${esc(src)}" alt="${esc(img[1])}" loading="lazy">${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ''}</figure>`);
        return;
      }
      if (step) {
        if (list !== 'ol') { close(); out.push('<ol class="help-steps">'); list = 'ol'; }
        const n = Number(step[1]);
        out.push(`<li><span class="help-num" aria-hidden="true">${CIRCLED.charAt(n - 1) || n + '.'}</span><span>${inline(step[2], marks)}</span></li>`);
        return;
      }
      if (bullet) {
        if (list !== 'ul') { close(); out.push('<ul class="help-bullets">'); list = 'ul'; }
        out.push(`<li>${inline(bullet[1], marks)}</li>`);
        return;
      }
      close();
      out.push(`<p>${inline(line, marks)}</p>`);
    });
    close();
    return out.join('');
  }

  // ---------- 搜尋 ----------

  // 常見說法 → 系統裡的用詞（打左邊的字，也會找右邊的字）
  const SYNONYMS = [
    [['退出', '不去', '不能去', '刪除', '撤銷', '退掉', '請假', '臨時有事', '取銷'], '取消'],
    [['換日期', '換一天', '改時間', '改天', '延期', '換時間'], '改期'],
    [['參加', '登記', '我要去', '報到', '發心'], '報名'],
    [['通知', '推播', '鬧鐘', '叫我'], '提醒'],
    [['桌面', '捷徑', 'app', '安裝', '圖示', 'icon'], '主畫面'],
    [['蘋果', 'ios', 'apple'], 'iphone'],
    [['安卓', '三星', 'oppo', '小米', '華碩', 'htc', 'sony'], 'android'],
    [['教室', '租', '借用', '場地'], '借場地'],
    [['課', '上課', '班'], '課程'],
    [['老師', '講師', '帶班'], '師資'],
    [['看不清楚', '放大', '字體', '老花'], '字太小'],
    [['line', '賴'], 'line'],
    [['日曆', 'google'], '行事曆']
  ];

  const norm = (s) => String(s || '').toLowerCase().replace(/[\s　，。、？?！!「」『』（）()：:；;·・…⋯]+/g, '');

  /** 搜尋：回傳 [{ item, score }]，分數高的在前；查不到時用兩個字一組的模糊比對 */
  function search(items, query) {
    const q = norm(query);
    if (!q) return items.map((item) => ({ item, score: 0 }));
    const terms = new Set(String(query).toLowerCase().split(/[\s　,，、]+/).map(norm).filter(Boolean));
    terms.add(q);
    SYNONYMS.forEach(([words, target]) => {
      if (words.some((w) => q.indexOf(norm(w)) !== -1) || q.indexOf(norm(target)) !== -1) terms.add(norm(target));
    });
    const score = (item, list) => {
      const fq = norm(item.q);
      const fa = norm(item.alias);
      const fb = norm(item.a.replace(/!\[[^\]]*\]\([^)]*\)/g, ''));
      let s = 0;
      list.forEach((t) => {
        if (fq.indexOf(t) !== -1) s += 6;
        if (fa.indexOf(t) !== -1) s += 4;
        if (fb.indexOf(t) !== -1) s += 1;
      });
      return s;
    };
    let res = items.map((item) => ({ item, score: score(item, [...terms]) })).filter((x) => x.score > 0);
    if (!res.length && q.length >= 2) {
      const grams = [];
      for (let i = 0; i < q.length - 1; i++) grams.push(q.slice(i, i + 2));
      res = items.map((item) => ({ item, score: score(item, grams) })).filter((x) => x.score > 0);
    }
    return res.sort((a, b) => b.score - a.score);
  }

  /** 標黃用的字：使用者打的字（拆開） */
  function marksOf(query) {
    return String(query || '').split(/[\s　,，、]+/).map((s) => s.trim()).filter((s) => s.length >= 1);
  }

  // ---------- 猜手機 ----------

  /** 最可能的「加到主畫面」那一題 */
  function guessHomeFaq() {
    const ua = navigator.userAgent;
    if (/\bLine\//i.test(ua)) return 'faq-home-line';
    const ipad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ipad) return 'faq-home-ipad';
    if (/iPhone|iPod/.test(ua)) {
      if (/CriOS/.test(ua)) return 'faq-home-ios-chrome';
      const v = ua.match(/OS (\d+)_/);
      return v && Number(v[1]) >= 26 ? 'faq-home-ios26' : 'faq-home-ios';
    }
    if (/SamsungBrowser/.test(ua)) return 'faq-home-samsung';
    if (/Android/.test(ua)) return 'faq-home-android';
    return '';
  }

  // ---------- 列表畫面（家人們、管理者共用） ----------

  /**
   * 在 box 裡畫出搜尋框、分類、題目列表。
   * opts: { items, openId, category, title, intro, linkBase（'#/help/' 或 ''），onOpen }
   */
  function mountList(box, opts) {
    const st = { q: '', cat: opts.category || '', open: opts.openId || '' };
    const guess = guessHomeFaq();
    const cats = [];
    opts.items.forEach((f) => { if (cats.indexOf(f.category) === -1) cats.push(f.category); });
    if (st.open) {
      const f = opts.items.find((x) => x.id === st.open);
      if (f) st.cat = '';
    }
    box.innerHTML = `
      <div class="help-search">
        <label class="sr-only" for="help-q-${opts.key}">搜尋問題</label>
        <input id="help-q-${opts.key}" class="input help-q" type="search" enterkeyhint="search" placeholder="🔍 想問什麼？例如：取消報名、加到主畫面" autocomplete="off">
      </div>
      <div class="help-cats" role="group" aria-label="分類">
        <button type="button" data-cat="" class="${st.cat ? '' : 'is-active'}">全部</button>
        ${cats.map((c) => `<button type="button" data-cat="${esc(c)}" class="${st.cat === c ? 'is-active' : ''}">${esc(c)}</button>`).join('')}
      </div>
      <div class="help-list" data-list aria-live="polite"></div>`;
    const list = box.querySelector('[data-list]');
    const input = box.querySelector('.help-q');

    const ordered = () => {
      // 加到主畫面：猜到的那題排在同分類的第一個
      const arr = opts.items.slice();
      if (!guess) return arr;
      const i = arr.findIndex((f) => f.id === guess);
      if (i === -1) return arr;
      const first = arr.findIndex((f) => f.category === arr[i].category && f.id !== 'faq-home-which' && f.id.indexOf('faq-home-') === 0);
      if (first !== -1 && first < i) arr.splice(first, 0, arr.splice(i, 1)[0]);
      return arr;
    };

    const draw = () => {
      const marks = marksOf(st.q);
      let rows = search(ordered(), st.q);
      if (!st.q && st.cat) rows = rows.filter((x) => x.item.category === st.cat);
      if (!rows.length) {
        list.innerHTML = `<div class="help-empty"><p>找不到「${esc(st.q)}」相關的問題 🙏</p><p class="muted">可以換個說法，例如「取消」「改期」「主畫面」，或${opts.audience === '管理者' ? '問總管理者' : '在 LINE 群組問、聯絡管理者'}。</p></div>`;
        return;
      }
      let lastCat = '';
      list.innerHTML = rows.map(({ item }) => {
        const head = !st.q && !st.cat && item.category !== lastCat ? `<h2 class="help-cat-title">${esc(item.category)}</h2>` : '';
        lastCat = item.category;
        const open = item.id === st.open;
        return `${head}<article class="help-item${open ? ' is-open' : ''}" data-id="${esc(item.id)}">
          <button type="button" class="help-qbtn" aria-expanded="${open}" data-toggle="${esc(item.id)}">
            <span class="help-qtext">${markText(esc(item.q), marks)}${item.id === guess ? ' <span class="help-guess">👈 您的手機可能是這種</span>' : ''}</span>
            <span class="help-chev" aria-hidden="true">${open ? '−' : '＋'}</span>
          </button>
          ${open ? `<div class="help-answer">${render(item.a, marks)}
            ${item.linkUrl ? `<a class="btn btn-primary help-go" href="${esc(item.linkUrl)}">👉 ${esc(item.linkText || '去看看')}</a>` : ''}
            ${opts.linkBase ? `<button type="button" class="link-btn help-copy" data-copy="${esc(item.id)}">🔗 複製這題的連結</button>` : ''}
          </div>` : ''}
        </article>`;
      }).join('');
    };

    input.addEventListener('input', () => { st.q = input.value; draw(); });
    box.querySelector('.help-cats').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-cat]');
      if (!b) return;
      st.cat = b.dataset.cat;
      st.q = '';
      input.value = '';
      box.querySelectorAll('.help-cats [data-cat]').forEach((x) => x.classList.toggle('is-active', x === b));
      draw();
    });
    list.addEventListener('click', async (ev) => {
      const t = ev.target.closest('[data-toggle]');
      if (t) {
        st.open = st.open === t.dataset.toggle ? '' : t.dataset.toggle;
        draw();
        if (opts.onOpen) opts.onOpen(st.open);
        const el = st.open && list.querySelector(`[data-id="${CSS.escape(st.open)}"]`);
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      const c = ev.target.closest('[data-copy]');
      if (c) {
        const url = location.origin + location.pathname + opts.linkBase + encodeURIComponent(c.dataset.copy);
        const ok = await Share.copyText(url);
        c.textContent = ok ? '已複製 ✓ 可以貼到 LINE' : '複製失敗';
        setTimeout(() => { c.textContent = '🔗 複製這題的連結'; }, 2500);
        return;
      }
      // 答案裡連到別題：直接在這頁打開
      const a = ev.target.closest('a[href^="#/help/"]');
      if (a && !opts.linkBase) {
        ev.preventDefault();
        st.open = decodeURIComponent(a.getAttribute('href').slice(7));
        st.q = '';
        input.value = '';
        draw();
      }
    });
    draw();
    if (st.open) {
      const el = list.querySelector(`[data-id="${CSS.escape(st.open)}"]`);
      if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 50);
    }
    return { reopen: (id) => { st.open = id; st.q = ''; input.value = ''; draw(); } };
  }

  // ---------- 家人們：#/help ----------

  let cache = null; // 拿過的題目（這次開網頁內）

  async function show(id, category) {
    const root = document.getElementById('view-help');
    root.innerHTML = `
      <h1 class="page-title">❓ 常見問題</h1>
      <div data-tutorial></div>
      <p class="hint">打字搜尋，或點下面的分類。點問題就會打開答案 😊</p>
      <div data-help><p class="panel-empty">載入中⋯</p></div>
      <a class="btn btn-block back-bottom" href="#/">‹ 回行事曆</a>`;
    if (window.Tutorial) Tutorial.mount(root.querySelector('[data-tutorial]'));
    const box = root.querySelector('[data-help]');
    try {
      if (!cache) cache = (await Api.getFaq()).items;
    } catch (err) {
      box.innerHTML = `<div class="notice notice-error" role="alert"><p>${esc(err.message || '讀取失敗，請稍後再試')}</p></div>`;
      return;
    }
    mountList(box, {
      key: 'pub', items: cache, openId: id, category, audience: '家人們', linkBase: '#/help/',
      onOpen: (open) => history.replaceState(null, '', open ? '#/help/' + encodeURIComponent(open) : '#/help')
    });
  }

  // ---------- 後台：📖 教學 ----------

  const editState = { editing: false, item: null };

  function adminShow(body, guard) {
    AdminPage.swr('faq', () => Api.admin('adminFaq', {}, true), (data, stale) => adminRender(body, guard, data, stale), body);
  }

  function adminRender(body, guard, data, stale) {
    const isSuper = Api.adminWho().role === '總管理者';
    if (editState.editing && isSuper) return editorRender(body, guard, data);
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${isSuper ? '<div class="help-admin-bar"><button type="button" class="btn" data-edit-mode>✏️ 編輯題目（家人們與管理者）</button><a class="btn" href="#/help">看家人們的常見問題</a></div>' : ''}
      <div data-help></div>`;
    mountList(body.querySelector('[data-help]'), { key: 'adm', items: data.items, audience: '管理者', linkBase: '' });
    const em = body.querySelector('[data-edit-mode]');
    if (em) em.addEventListener('click', () => { editState.editing = true; adminRender(body, guard, data, false); });
  }

  const ROLE_LIST = ['總管理者', '勤務', '道務', '教育', '唯讀', '場管'];

  function editorRender(body, guard, data) {
    const all = data.all || [];
    if (editState.item) return formRender(body, guard, data);
    const groups = [];
    all.forEach((f) => {
      const k = f.audience + '｜' + f.category;
      let g = groups.find((x) => x.k === k);
      if (!g) { g = { k, audience: f.audience, category: f.category, items: [] }; groups.push(g); }
      g.items.push(f);
    });
    body.innerHTML = `
      <div class="help-admin-bar">
        <button type="button" class="btn" data-back>‹ 回教學</button>
        <button type="button" class="btn btn-primary" data-new>＋ 新增題目</button>
      </div>
      <p class="hint">「家人們」的題目顯示在行事曆的「❓ 常見問題」；「管理者」的顯示在後台這一頁。用 ↑ ↓ 調整同一分類裡的順序。</p>
      ${['家人們', '管理者'].map((aud) => `
        <h2 class="admin-sub">給${aud}看</h2>
        ${groups.filter((g) => g.audience === aud).map((g) => `
          <h3 class="help-edit-cat">${esc(g.category)}</h3>
          <ul class="help-edit-list">${g.items.map((f, i) => `
            <li class="${f.enabled ? '' : 'is-off'}">
              <span class="help-edit-q">${esc(f.q)}${f.enabled ? '' : '<small>（停用）</small>'}${f.roles.length ? `<small>（${esc(f.roles.join('、'))}）</small>` : ''}</span>
              <span class="help-edit-actions">
                <button type="button" class="btn btn-small" data-move="${esc(f.id)}" data-dir="-1"${i === 0 ? ' disabled' : ''} aria-label="往上">↑</button>
                <button type="button" class="btn btn-small" data-move="${esc(f.id)}" data-dir="1"${i === g.items.length - 1 ? ' disabled' : ''} aria-label="往下">↓</button>
                <button type="button" class="btn btn-small" data-edit="${esc(f.id)}">修改</button>
              </span>
            </li>`).join('')}</ul>`).join('')}`).join('')}`;
    body.querySelector('[data-back]').addEventListener('click', () => { editState.editing = false; adminRender(body, guard, data, false); });
    body.querySelector('[data-new]').addEventListener('click', () => {
      editState.item = { id: '', audience: '家人們', category: '', q: '', a: '', alias: '', linkUrl: '', linkText: '', roles: [], enabled: true };
      editorRender(body, guard, data);
      window.scrollTo(0, 0);
    });
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      editState.item = Object.assign({}, all.find((f) => f.id === b.dataset.edit));
      editorRender(body, guard, data);
      window.scrollTo(0, 0);
    }));
    body.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => save(body, guard, 'adminFaqMove', { id: b.dataset.move, dir: Number(b.dataset.dir) }, true)));
  }

  async function save(body, guard, action, payload, stay) {
    Busy.show('儲存中⋯');
    try {
      const res = await Api.admin(action, payload);
      Busy.hide();
      AdminPage.clearMemo();
      cache = null;
      if (!stay) editState.item = null;
      adminRender(body, guard, res, false);
      return true;
    } catch (err) {
      Busy.hide();
      if (guard(err)) return false;
      const box = body.querySelector('[data-err]');
      const msg = `<strong>${esc(err.message || '沒有成功')}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
      if (box) { box.innerHTML = msg; box.hidden = false; } else alert(err.message || '沒有成功');
      return false;
    }
  }

  function formRender(body, guard, data) {
    const it = editState.item;
    const cats = [...new Set((data.all || []).filter((f) => f.audience === it.audience).map((f) => f.category))];
    body.innerHTML = `
      <div class="help-admin-bar"><button type="button" class="btn" data-cancel>‹ 不改了，回列表</button></div>
      <form class="help-form" novalidate>
        <h2 class="admin-sub">${it.id ? '修改題目' : '新增題目'}</h2>
        <div class="form-row-pair">
          <label><span>給誰看</span><select class="input" name="audience">${['家人們', '管理者'].map((x) => `<option${x === it.audience ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
          <label><span>分類</span><input class="input" name="category" list="help-cats" maxlength="20" value="${esc(it.category)}" placeholder="例：報名"><datalist id="help-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        </div>
        <div class="help-roles"${it.audience === '管理者' ? '' : ' hidden'}>
          <span class="field-label">哪些帳號看得到（都不勾＝全部後台帳號）</span>
          <div class="help-role-list">${ROLE_LIST.map((r) => `<label class="check"><input type="checkbox" name="role" value="${r}"${it.roles.indexOf(r) !== -1 ? ' checked' : ''}> ${r}</label>`).join('')}</div>
        </div>
        <label class="form-row"><span>問題</span><input class="input" name="q" maxlength="100" value="${esc(it.q)}" placeholder="例：怎麼取消報名？"></label>
        <label class="form-row"><span>答案</span>
          <textarea class="input help-a" name="a" rows="12" maxlength="6000" placeholder="1. 第一步&#10;![圖片說明](圖片)&#10;2. 第二步&#10;- 補充說明">${esc(it.a)}</textarea>
        </label>
        <div class="help-tools">
          <label class="btn btn-small help-upload">📷 加圖片<input type="file" accept="image/*" hidden data-upload></label>
          <button type="button" class="btn btn-small" data-ins="1. ">＋ 步驟</button>
          <button type="button" class="btn btn-small" data-ins="- ">＋ 條列</button>
          <button type="button" class="btn btn-small" data-bold>粗體</button>
        </div>
        <p class="hint">「1. 」開頭＝步驟（顯示成①②③）；「- 」開頭＝條列；**兩個星號包起來**＝粗體；圖片一行寫 ![說明](圖片)；連到別題寫 [文字](#/help/問題ID)。</p>
        <label class="form-row"><span>搜尋用的別稱（大家可能會打的字，用空白分開）</span><input class="input" name="alias" maxlength="200" value="${esc(it.alias)}" placeholder="例：退出 不去了 臨時有事"></label>
        <div class="form-row-pair">
          <label><span>按鈕文字（選填）</span><input class="input" name="linkText" maxlength="30" value="${esc(it.linkText)}" placeholder="例：去查我的報名"></label>
          <label><span>按鈕網址（選填）</span><input class="input" name="linkUrl" value="${esc(it.linkUrl)}" placeholder="例：#/mine"></label>
        </div>
        <label class="check"><input type="checkbox" name="enabled"${it.enabled ? ' checked' : ''}> 啟用（不勾就先隱藏）</label>
        <h3 class="help-edit-cat">預覽</h3>
        <div class="help-preview"><article class="help-item is-open"><div class="help-qbtn"><span class="help-qtext" data-pv-q></span></div><div class="help-answer" data-pv-a></div></article></div>
        <div class="form-error" data-err hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary btn-block">存檔</button>
          ${it.id ? '<button type="button" class="btn btn-quiet-danger btn-block" data-del>刪除這一題</button>' : ''}
        </div>
      </form>`;
    const f = body.querySelector('form');
    const ta = f.elements.a;
    const preview = () => {
      body.querySelector('[data-pv-q]').textContent = f.elements.q.value || '（問題）';
      body.querySelector('[data-pv-a]').innerHTML = render(ta.value) + (f.elements.linkUrl.value ? `<span class="btn btn-primary help-go">👉 ${esc(f.elements.linkText.value || '去看看')}</span>` : '');
    };
    const insert = (text, newLine) => {
      const s = ta.selectionStart;
      const before = ta.value.slice(0, s);
      const pre = newLine && before && !before.endsWith('\n') ? '\n' : '';
      ta.value = before + pre + text + ta.value.slice(ta.selectionEnd);
      const pos = (before + pre + text).length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      preview();
    };
    ['q', 'a', 'linkUrl', 'linkText'].forEach((n) => f.elements[n].addEventListener('input', preview));
    f.elements.audience.addEventListener('change', () => { body.querySelector('.help-roles').hidden = f.elements.audience.value !== '管理者'; });
    f.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => insert(b.dataset.ins, true)));
    f.querySelector('[data-bold]').addEventListener('click', () => {
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const sel = ta.value.slice(s, e) || '粗體字';
      ta.value = ta.value.slice(0, s) + '**' + sel + '**' + ta.value.slice(e);
      ta.focus();
      preview();
    });
    f.querySelector('[data-upload]').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      Busy.show('上傳圖片中⋯');
      try {
        const img = await shrinkImage(file);
        const res = await Api.admin('adminUploadFile', { mime: img.mime, name: file.name, data: img.data });
        Busy.hide();
        insert(`![](${res.id})\n`, true);
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        alert(err.message || '上傳失敗');
      }
    });
    body.querySelector('[data-cancel]').addEventListener('click', () => { editState.item = null; editorRender(body, guard, data); });
    const del = f.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => {
      if (!(await Confirm.open({ title: '確定刪除這一題嗎？', rows: [['問題', it.q]], confirmText: '刪除', danger: true }))) return;
      save(body, guard, 'adminFaqDelete', { id: it.id });
    });
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const item = {
        id: it.id, audience: f.elements.audience.value, category: f.elements.category.value.trim(), q: f.elements.q.value.trim(), a: ta.value,
        alias: f.elements.alias.value.trim(), linkUrl: f.elements.linkUrl.value.trim(), linkText: f.elements.linkText.value.trim(),
        roles: [...f.querySelectorAll('[name=role]:checked')].map((c) => c.value), enabled: f.elements.enabled.checked
      };
      editState.item = item;
      save(body, guard, 'adminFaqSave', { item });
    });
    preview();
  }

  /** 照片縮成長邊 1600px 的 JPEG（同 DM） */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ mime: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀不到這張圖片')); };
      img.src = url;
    });
  }

  window.Help = { render, search, guessHomeFaq };
  window.HelpPage = { show };
  window.HelpAdminPage = { show: adminShow };
})();
