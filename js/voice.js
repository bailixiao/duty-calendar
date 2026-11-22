// 🎤 用講的報名（2026/11/22）：首頁按「🎤 用講的報名」，說「我要報名 12 月 13 號闡道班勤務，蔡某某、陳某某」，
// 找出是哪一個勤務、哪一天、誰，大字給長輩確認；按「對，去報名」就打開那個勤務的報名表、名字都填好，最後按「確認報名」。
// 語音用瀏覽器內建的語音辨識（Chrome、Safari；聲音交給 Google／Apple 轉成文字），不能用的時候可以用打字（手機鍵盤也有麥克風）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const NAME_KEYS = ['duty-calendar:last-name', 'duty-calendar:mine-name', 'duty-calendar:push-name'];

  // 給報名表：打開勤務後把名字、日期、項目帶進去（SignupForm 會來拿）
  let prefill = null;
  window.VoicePrefill = {
    take(dutyId) { const p = prefill; if (p && p.dutyId === dutyId) { prefill = null; return p; } return null; }
  };

  const myName = () => { for (const k of NAME_KEYS) { try { const v = (localStorage.getItem(k) || '').trim(); if (v) return v.split(/[、,，]/)[0]; } catch (e) { /* 無痕 */ } } return ''; };
  const memberCache = new Map();
  async function lookup(name) {
    if (!memberCache.has(name)) {
      memberCache.set(name, Api.searchMembers(name).then((r) => (r.members || [])).catch(() => []));
    }
    return memberCache.get(name);
  }
  // 名單上剛好有這個名字（或別名）
  const isName = async (s) => (await lookup(s)).some((m) => m.name === s || m.alias === s);

  function open() {
    const m = Modal.open(`
      <div class="voice">
        <h2 class="modal-title">🎤 用講的報名</h2>
        <p class="voice-example">按下面的麥克風，說：<br><strong>「我要報名 12 月 13 號闡道班勤務，<br>王小明、陳小華」</strong></p>
        ${SR ? '<button type="button" class="voice-mic" data-mic aria-label="按一下開始講話"><span class="voice-mic-icon">🎤</span><span data-mic-text>按一下，開始講</span></button>' : '<p class="notice">這個瀏覽器不能直接聽，可以按下面的框框，用<strong>手機鍵盤上的 🎤 麥克風</strong>講，或用打字。<br><small>從 LINE 打開的，請按右上角「⋯」用 Chrome 或 Safari 開，就能直接講。</small></p>'}
        <label class="form-row"><span>聽到的話（可以改）</span><textarea class="input voice-text" rows="3" data-text placeholder="我要報名 12 月 13 號闡道班勤務，王小明"></textarea></label>
        <button type="button" class="btn btn-primary btn-block btn-big" data-find>🔍 幫我找</button>
        <div data-result aria-live="polite"></div>
        <div class="modal-actions"><button type="button" class="btn btn-block" data-close>返回</button></div>
      </div>`);
    const el = m.el;
    const ta = el.querySelector('[data-text]');
    const out = el.querySelector('[data-result]');
    let rec = null;
    let events = null;
    const loadEvents = () => events || (events = Api.getEvents(Fmt.addDays(todayIso(), 1), Fmt.addDays(todayIso(), 120)).then((r) => r));
    loadEvents().catch(() => { events = null; });
    el.querySelector('[data-close]').addEventListener('click', () => { listening = false; clearInterval(timer); if (rec) try { rec.abort(); } catch (e) { /* 已停 */ } m.close(); });

    /**
     * 聽：長輩講話中間會停下來想（想名字），一停就結束太快（2026/11/22 改）。
     *   - 瀏覽器自己停掉時（停頓、Android 一段一段的）自動再接著聽，已經聽到的字留著
     *   - 有聽到字之後，安靜 SILENCE_MS 才真的結束；還沒講話等 WAIT_MS；最長 MAX_MS；也可以按「講完了」
     */
    const SILENCE_MS = 4000, WAIT_MS = 10000, MAX_MS = 40000;
    const mic = el.querySelector('[data-mic]');
    let listening = false;
    let heard = ''; // 前幾段已經確定的字
    let lastHeard = 0, startedAt = 0, timer = null;
    const micText = (t) => { mic.querySelector('[data-mic-text]').textContent = t; };
    function finish() {
      listening = false;
      clearInterval(timer);
      if (rec) { const r = rec; rec = null; try { r.stop(); } catch (e) { /* 已停 */ } }
      mic.classList.remove('is-on');
      micText('再講一次');
      if (ta.value.trim()) find();
    }
    let restarts = 0;
    function startOnce() {
      rec = new SR();
      rec.lang = 'zh-TW';
      rec.interimResults = true;
      rec.continuous = true;
      let session = ''; // 這一段確定的字
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) {
            // Android 有時候每次都給「到目前為止的全部」：開頭一樣就換掉，不要重複
            session = t.indexOf(session) === 0 ? t : session + t;
          } else interim += t;
        }
        ta.value = heard + session + interim;
        lastHeard = Date.now();
      };
      rec.onerror = (ev) => {
        if (ev.error === 'no-speech' || ev.error === 'aborted') return; // 安靜：交給計時器決定要不要結束
        if (restarts && /not-allowed/.test(ev.error)) { listening = false; return; } // 自動接著聽被擋（iOS）：用已經聽到的字
        listening = false;
        const msg = { 'not-allowed': '麥克風沒有開放：請在跳出來的視窗按「允許」，或到瀏覽器設定打開麥克風', 'service-not-allowed': '麥克風沒有開放：請在跳出來的視窗按「允許」，或到瀏覽器設定打開麥克風', 'network': '網路不穩，聽不到，請再試一次或用打字' }[ev.error] || '聽不清楚，請再試一次或用打字';
        out.innerHTML = `<p class="form-error">${esc(msg)}</p>`;
      };
      rec.onend = () => {
        heard = ta.value; // 這一段的字留著
        if (listening) { try { restarts++; startOnce(); return; } catch (e) { /* 接不上就結束 */ } }
        if (rec) finish();
      };
      rec.start();
    }
    if (mic) mic.addEventListener('click', () => {
      if (listening) { finish(); return; }
      listening = true;
      heard = ta.value.trim() ? ta.value.trim() + ' ' : '';
      startedAt = Date.now();
      lastHeard = 0;
      restarts = 0;
      mic.classList.add('is-on');
      micText('我在聽⋯講完了按這裡');
      out.innerHTML = '';
      timer = setInterval(() => {
        const now = Date.now();
        if (!listening) return;
        if ((lastHeard && now - lastHeard > SILENCE_MS) || (!lastHeard && now - startedAt > WAIT_MS) || now - startedAt > MAX_MS) {
          if (!lastHeard) out.innerHTML = '<p class="form-error">沒有聽到聲音，請再按一次、靠近手機講</p>';
          finish();
        }
      }, 300);
      try { startOnce(); } catch (e) { finish(); }
    });
    el.querySelector('[data-find]').addEventListener('click', find);

    async function find() {
      const text = ta.value.trim();
      if (!text) { out.innerHTML = '<p class="form-error">先按麥克風講話，或在框框裡打字</p>'; return; }
      out.innerHTML = '<p class="muted">找找看⋯</p>';
      let data;
      try { data = await loadEvents(); } catch (e) { events = null; out.innerHTML = '<p class="form-error">讀不到勤務，請檢查網路再試一次</p>'; return; }
      const r = VoiceParse.parse(text, data.duties || [], data.today || todayIso());
      // 名字：黏在一起的拆開、到名單核對
      let names = [];
      for (const chunk of r.nameChunks) names = names.concat(await VoiceParse.splitNames(chunk, isName));
      if (!names.length && r.self && myName()) names = [myName()];
      const checked = await Promise.all(names.map(async (n) => {
        const list = await lookup(n);
        const hit = list.find((x) => x.name === n || x.alias === n);
        return { said: n, name: hit ? hit.name : n, known: !!hit, maybe: hit ? [] : list.slice(0, 4).map((x) => x.name) };
      }));
      show(r, checked);
    }

    function show(r, people) {
      if (!r.options.length) {
        out.innerHTML = `<div class="notice notice-error"><p>找不到要報名的勤務${r.date ? `（${esc(Fmt.shortDate(r.date))}）` : ''}。</p><p>請講<strong>日期</strong>和<strong>勤務名稱</strong>，例如「12 月 13 號闡道班勤務」，或按「返回」到行事曆點勤務。</p></div>`;
        return;
      }
      let pick = r.options.length === 1 && !r.dateMiss ? 0 : -1;
      const draw = () => {
        const o = pick >= 0 ? r.options[pick] : null;
        const timeOf = (x) => [x.duty.startTime ? x.duty.startTime + (x.duty.endTime ? '–' + x.duty.endTime : '') : '', x.duty.location].filter(Boolean).join('・');
        out.innerHTML = `
          ${r.dateMiss ? `<p class="notice">${esc(Fmt.shortDate(r.date))} 沒有這個勤務，下面是別天的：</p>` : ''}
          ${o ? '' : `<p class="voice-ask">是哪一個？請點一下：</p><div class="voice-options">${r.options.map((x, i) => `<button type="button" class="voice-option" data-pick="${i}"><strong>${esc(Fmt.shortDate(x.date))}　${esc(x.duty.name)}</strong><small>${esc(timeOf(x))}</small></button>`).join('')}</div>`}
          ${o ? `<div class="voice-confirm">
            <p class="voice-q">要幫下面的人報名嗎？</p>
            <p class="voice-duty">📅 <strong>${esc(Fmt.shortDate(o.date))}</strong>　${esc(o.duty.name)}${r.position && r.position.id && o.duty.positions.some((p) => p.id === r.position.id) ? `<br>🙏 ${esc(r.position.name)}` : ''}<small>${esc(timeOf(o))}</small></p>
            <ul class="voice-people">${people.length ? people.map((p) => `<li>${p.known ? '✅' : '❓'} <strong>${esc(p.name)}</strong>${p.known ? '' : `<small>名單上找不到${p.maybe.length ? '，是不是：' + p.maybe.map(esc).join('、') : ''}（到報名表可以改）</small>`}</li>`).join('') : '<li class="muted">沒有聽到名字，到報名表再填</li>'}</ul>
            <button type="button" class="btn btn-primary btn-block btn-big" data-go>✅ 對，去報名</button>
            ${r.options.length > 1 ? '<button type="button" class="btn btn-block" data-repick>不是這個，換一個</button>' : ''}
          </div>` : ''}`;
        out.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { pick = Number(b.dataset.pick); draw(); }));
        const rp = out.querySelector('[data-repick]');
        if (rp) rp.addEventListener('click', () => { pick = -1; draw(); });
        const go = out.querySelector('[data-go]');
        if (go) go.addEventListener('click', () => {
          prefill = { dutyId: o.duty.id, date: o.date, names: people.map((p) => p.name), positionId: r.position && o.duty.positions.some((p) => p.id === r.position.id) ? r.position.id : '' };
          m.close();
          location.hash = `#/duty/${encodeURIComponent(o.duty.id)}?date=${o.date}`;
        });
        const first = out.querySelector('.voice-confirm, .voice-options');
        if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      draw();
    }
  }

  /** 首頁的大按鈕 */
  function init() {
    const pins = document.getElementById('home-pins');
    if (!pins || document.getElementById('voice-signup')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'voice-signup';
    b.className = 'btn voice-signup';
    b.innerHTML = '🎤 用講的報名';
    b.addEventListener('click', open);
    pins.parentNode.insertBefore(b, pins);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.VoiceSignup = { open };
})();
