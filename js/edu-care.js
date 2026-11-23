// 教育組的關心名單（2026/11/23）：依成員的生日、學齡，自動列出「這個月該關心誰」，每位附上原因和可以聊的話題。
//   🎓 升學年：國三（會考、升高中）、高三（學測、分科、升大學）整個學年都列，每學期記一次已關心；
//      升國中（國小六年級 6～8 月）、大學畢業（大四 5～6 月）。不記大考的確切日期（每年不一樣）。
//   🎂 生日：前 3 天到後 7 天（35 歲以下，有填月日的）
//   🔄 升班銜接：6～8 月列出 9 月要換班的人（讀經班→青少年班⋯），9～10 月列出剛升上新班的人
// 「✓ 已關心」記在 apps-script/EduCare.gs（EDU_CARE），一句紀錄也寫進成員的成全紀錄。
// build() 是純函式（Node 測試用 module.exports），mount() 畫畫面（瀏覽器用 window.EduCare）。
(function (root) {
  'use strict';

  const TOPICS = {
    幼兒園: '喜歡玩什麼、在幼兒園開不開心；多抱抱、多稱讚',
    國小: '學校好不好玩、喜歡什麼、背了哪段經典（多稱讚）',
    國中: '課業壓力、同學朋友、會考準備（多聽少說教）',
    高中: '志願方向、讀書方法、睡得夠不夠',
    大學: '住宿生活、打工、社團、未來想做什麼',
    青年: '工作適應、家庭、身體；邀請當學弟妹的小老師'
  };
  const is = (stage, grade) => (st) => !!st && st.stage === stage && (grade === undefined || st.grade === grade);
  /**
   * 升學年（2026/11/23 改：不記大考日期）：國三、高三整個學年（9 月～隔年 8 月）都列，每學期（9～1 月、2～8 月）可以記一次已關心；
   * 升國中、大學畢業只在那幾個月。
   */
  const EVENTS = [
    { id: 'g9', icon: '🎓', title: '國三：今年考會考、升高中', who: is('國中', 3), from: '09-01', to: '08-31', term: true, topic: '會考大約在 5 月：平常多鼓勵、考前打氣不給壓力（可以送平安符或小卡），放榜後問志願；壓力大的多聽少說。' },
    { id: 'g12', icon: '🎓', title: '高三：今年考學測、升大學', who: is('高中', 3), from: '09-01', to: '08-31', term: true, topic: '學測大約在 1 月、分科測驗大約在 7 月：關心讀書和睡眠，考前打氣，放榜後問想走的方向；要離家讀書的關心住宿、介紹那邊的道場。' },
    { id: 'g6', icon: '🏫', title: '升國中', who: is('國小', 6), from: '06-01', to: '08-31', topic: '新環境、交新朋友；邀請繼續來青少年班。' },
    { id: 'u4', icon: '🎓', title: '大學畢業', who: is('大學', 4), from: '05-01', to: '06-30', topic: '找工作、當兵；邀請來青年班，也可以當學弟妹的小老師。' }
  ];
  const BDAY_BEFORE = 3, BDAY_AFTER = 7, BDAY_MAX_AGE = 35;
  const MOVE_FROM = '06-01', MOVE_TO = '10-31';

  const md = (d) => String(d).slice(5, 10);
  const inWin = (m, from, to) => (from <= to ? m >= from && m <= to : m >= from || m <= to);
  const acadOf = (d) => { const y = Number(d.slice(0, 4)); return Number(d.slice(5, 7)) >= 9 ? y : y - 1; };
  const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  const short = (m) => `${Number(m.slice(0, 2))}/${Number(m.slice(3, 5))}`;

  /** 那一天是哪一班（EduStats.AGE_CLASSES；沒有＝''） */
  function classAt(m, date, stageOf, classes) {
    if (!m.birthYear) return '';
    const st = stageOf(m.birthYear, date);
    const age = Number(date.slice(0, 4)) - Number(m.birthYear);
    const k = classes.find((c) => c.test(st, age));
    return k ? k.name : '';
  }
  const topicOf = (st, age) => (st ? TOPICS[st.stage] || '' : age !== '' && age <= 35 ? TOPICS['青年'] : '');

  /**
   * members：成員名單（只算啟用中、不是待確認）；config：保留（不用了）；stageOf＝Family.schoolStage；classes＝EduStats.AGE_CLASSES。
   * 回傳 [{ id, icon, title, topic, items: [{ key, name, temple, label, reason, topic }] }]（沒有人的不回）
   */
  function build(members, today, config, stageOf, classes) {
    config = config || {};
    const m0 = md(today);
    const y = Number(today.slice(0, 4));
    const acad = acadOf(today);
    const list = (members || []).filter((m) => m && m.name && m.active !== false && !m.pending);
    const info = list.map((m) => {
      const st = m.birthYear ? stageOf(m.birthYear, today) : null;
      const age = m.birthYear ? y - Number(m.birthYear) : '';
      return { m, st, age, label: st ? st.label : age !== '' ? age + ' 歲' : '' };
    });
    const sortI = (a, b) => (a.age === '' ? 999 : a.age) - (b.age === '' ? 999 : b.age) || a.m.name.localeCompare(b.m.name, 'zh-Hant');
    const item = (p, key, reason, topic) => ({ key, name: p.m.name, temple: p.m.temple || '', label: p.label, reason, topic: topic || topicOf(p.st, p.age) });
    const groups = [];

    // 🎓 大考、升學
    const term = m0 >= '02-01' && m0 < '09-01' ? 2 : 1; // 上學期 9～1 月、下學期 2～8 月
    EVENTS.forEach((e) => {
      if (!inWin(m0, e.from, e.to)) return;
      const key = (p) => `${p.m.name}|${e.id}|${acad}${e.term ? '-' + term : ''}`;
      const why = e.term ? `${e.title}（${term === 1 ? '上' : '下'}學期）` : `${e.title}（${short(e.from)}～${short(e.to)}）`;
      const items = info.filter((p) => e.who(p.st)).sort(sortI).map((p) => item(p, key(p), why, ''));
      if (items.length) groups.push({ id: e.id, icon: e.icon, title: e.title, topic: e.topic, items });
    });

    // 🎂 生日（前 3 天到後 7 天）
    const bd = info.filter((p) => p.m.birthday && (p.age === '' || p.age <= BDAY_MAX_AGE)).map((p) => {
      let when = `${y}-${p.m.birthday}`;
      let diff = dayNum(when) - dayNum(today);
      if (diff < -BDAY_BEFORE) { when = `${y + 1}-${p.m.birthday}`; diff = dayNum(when) - dayNum(today); }
      if (diff > BDAY_AFTER + 300) { when = `${y - 1}-${p.m.birthday}`; diff = dayNum(when) - dayNum(today); }
      return { p, when, diff };
    }).filter((x) => x.diff >= -BDAY_BEFORE && x.diff <= BDAY_AFTER).sort((a, b) => a.diff - b.diff);
    if (bd.length) {
      groups.push({ id: 'bday', icon: '🎂', title: '生日', topic: '「生日快樂！」一句祝福或一張小卡就很暖；小朋友可以一起唱生日快樂歌。',
        items: bd.map((x) => {
          const turn = x.p.m.birthYear ? Number(x.when.slice(0, 4)) - Number(x.p.m.birthYear) : '';
          const day = x.diff === 0 ? '今天生日' : x.diff > 0 ? `${short(md(x.when))} 生日（還有 ${x.diff} 天）` : `${short(md(x.when))} 生日（${-x.diff} 天前）`;
          return item(x.p, `${x.p.m.name}|bday|${x.when.slice(0, 4)}`, day + (turn ? `・滿 ${turn} 歲` : ''), '');
        }) });
    }

    // 🔄 升班銜接（6～10 月）
    if (classes && inWin(m0, MOVE_FROM, MOVE_TO)) {
      const before = m0 < '09-01';
      const other = before ? `${y}-09-01` : `${y}-08-31`;
      const moves = info.map((p) => {
        const now = classAt(p.m, today, stageOf, classes);
        const then = classAt(p.m, other, stageOf, classes);
        if (now === then) return null;
        const to = before ? then : now, from = before ? now : then;
        if (!to) return null; // 超過 35 歲、離開青年班的不列
        return { p, reason: before ? `9 月要從${from || '學齡前'}升到${to}` : `剛升上${to}${from ? `（原本${from}）` : ''}`, to };
      }).filter(Boolean).sort((a, b) => sortI(a.p, b.p));
      if (moves.length) {
        groups.push({ id: 'move', icon: '🔄', title: '升班銜接', topic: '換班最容易不來了：主動邀請到新的班，介紹新班的老師和同學，第一次可以陪他去。',
          items: moves.map((x) => item(x.p, `${x.p.m.name}|move|${before ? acad + 1 : acad}`, x.reason, '')) });
      }
    }
    return groups;
  }

  // =====================================================================
  // 畫面（統計 → 教育 →「💛 這個月的關心名單」）
  // =====================================================================

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** box：放畫面的地方；opts = { members（已讀好的成員名單）, guard } */
  async function mount(box, opts) {
    let d;
    try { d = await Api.admin('adminEduCareList', {}, true); } catch (e) {
      if (opts.guard && opts.guard(e)) return;
      box.innerHTML = `<h3 class="admin-sub">💛 這個月的關心名單</h3><p class="form-error">${esc(e.message || '讀不到關心紀錄')}</p>`;
      return;
    }
    const draw = () => {
      if (!box.isConnected) return;
      const groups = build(opts.members, d.today, null, Family.schoolStage, EduStats.AGE_CLASSES);
      const n = groups.reduce((s, g) => s + g.items.length, 0);
      const done = groups.reduce((s, g) => s + g.items.filter((x) => d.care[x.key]).length, 0);
      box.innerHTML = `
        <h3 class="admin-sub">💛 這個月的關心名單<span class="h2-sub">${n ? `${n} 位・已關心 ${done} 位` : '依生日、學齡自動列出'}</span></h3>
        <p class="hint">系統依成員的生日（出生年）自動列出：🎓 升學年（國三、高三整年，每學期關心一次）、升國中、大學畢業、🎂 生日（35 歲以下，有填月日的）、🔄 升班銜接。關心過了按「✓ 已關心」，組員之間不會重複找同一個人；寫的一句話也會記進那位成員的成全紀錄。</p>
        ${n ? groups.map((g, gi) => `
          <div class="ecare-group">
            <h4 class="ecare-head">${g.icon} ${esc(g.title)}<span>${g.items.length} 位</span></h4>
            <p class="ecare-topic">💡 ${esc(g.topic)}</p>
            <ul class="ecare-list">${g.items.map((x, i) => { const c = d.care[x.key]; return `
              <li class="ecare-item${c ? ' is-done' : ''}">
                <div class="ecare-who"><strong>${opts.personHtml ? opts.personHtml(x.name, x.temple) : esc(x.name)}</strong>${x.temple ? `<small>${esc(x.temple)}</small>` : ''}${x.label ? `<span class="tag">${esc(x.label)}</span>` : ''}</div>
                <p class="ecare-reason">${esc(x.reason)}</p>
                ${x.topic ? `<p class="ecare-talk">可以聊：${esc(x.topic)}</p>` : ''}
                ${c ? `<p class="ecare-done">✓ 已關心（${esc(c.by)} ${esc(String(c.at).slice(5, 10).replace('-', '/'))}）${c.note ? '：' + esc(c.note) : ''}${d.canEdit ? ` <button type="button" class="link-btn" data-care-undo="${gi}|${i}">取消</button>` : ''}</p>`
                  : d.canEdit ? `<button type="button" class="btn btn-small btn-primary" data-care="${gi}|${i}">✓ 已關心</button>` : ''}
              </li>`; }).join('')}</ul>
          </div>`).join('') : '<p class="panel-empty">這個月沒有要特別關心的人（升學、生日、升班都還沒到）。生日在「👥 人員 → 成員」補，填了就會自動列進來。</p>'}
        <div class="admin-actions no-print">${n ? '<button type="button" class="btn" data-care-copy>📋 複製名單（貼到 LINE 分工）</button>' : ''}</div>`;
      const pick = (v) => { const [gi, i] = v.split('|').map(Number); return groups[gi].items[i] && Object.assign({ group: groups[gi] }, groups[gi].items[i]); };
      box.querySelectorAll('[data-care]').forEach((b) => b.addEventListener('click', () => {
        const x = pick(b.dataset.care);
        const m = Modal.open(`<h2 class="modal-title">✓ 已關心 ${esc(x.name)}</h2>
          <p class="modal-note">${esc(x.group.icon + ' ' + x.reason)}</p>
          <label class="form-row"><span>記一句（選填，例：打電話了，考試順利）</span><input class="input" data-note maxlength="100"></label>
          <div class="form-error" data-err hidden></div>
          <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-ok>✓ 記下已關心</button><button type="button" class="btn btn-block" data-close>返回</button></div>`);
        m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
        m.el.querySelector('[data-ok]').addEventListener('click', async () => {
          try { d = await Api.admin('adminEduCare', { key: x.key, name: x.name, temple: x.temple, label: x.group.title, note: m.el.querySelector('[data-note]').value }); m.close(); draw(); }
          catch (e) { if (opts.guard && opts.guard(e)) return; const er = m.el.querySelector('[data-err]'); er.textContent = e.message; er.hidden = false; }
        });
      }));
      box.querySelectorAll('[data-care-undo]').forEach((b) => b.addEventListener('click', async () => {
        const x = pick(b.dataset.careUndo);
        try { d = await Api.admin('adminEduCare', { key: x.key, name: x.name, label: x.group.title, undo: true }); draw(); } catch (e) { if (!(opts.guard && opts.guard(e))) alert(e.message); }
      }));
      const cp = box.querySelector('[data-care-copy]');
      if (cp) cp.addEventListener('click', async () => {
        const text = `💛【教育組關心名單】${d.today.slice(5).replace('-', '/')}\n` + groups.map((g) => `\n${g.icon} ${g.title}（${g.items.length} 位）\n` + g.items.map((x) => `・${x.name}${x.temple ? '（' + x.temple + '）' : ''} ${x.label}｜${x.reason}${d.care[x.key] ? '｜✓已關心' : ''}`).join('\n')).join('\n');
        cp.textContent = (await Share.copyText(text)) ? '已複製 ✓' : '複製失敗，請再按一次';
      });
    };
    draw();
  }

  const api = { build, mount, EVENTS, TOPICS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EduCare = api;
})(typeof window !== 'undefined' ? window : globalThis);
