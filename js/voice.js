// 🎤 語音助理（2026/11/27）：右下角的麥克風。說一句話 → 伺服器 voiceAsk（AI 只提案）→ 確認卡 → 按確認才做。
// 家人們：問問題、打開勤務、幫忙填好報名表（自己按送出報名）。管理者（後台）：新增勤務、停課、放到首頁、補登出席、複製通知，
// 這些由 js/voice-admin.js（後台才載入）用 Voice.register 加進來。這支檔案不直接用後台的程式。
(function () {
  const esc = (s) => Fmt.esc(s);
  const SIGNUP_KEY = 'duty-calendar:voice-signup'; // 報名頁讀了就刪（js/signup.js）
  const handlers = {}; // action → { title, confirm, run(plan, ui) }（後台的 Voice.register 加進來）
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------- 家人們也能用的 ----------
  handlers.answer = { title: '💬 回答', confirm: '' };
  handlers.unclear = { title: '🤔 沒有聽懂', confirm: '' };
  handlers.open = { title: '📄 打開', confirm: '打開', run: (p) => { location.hash = '#/duty/' + encodeURIComponent(p.dutyId) + '?date=' + p.date; } };
  handlers.signup = {
    title: '📝 幫您填報名表',
    confirm: '幫我填好報名表',
    detail: (p) => `<p class="hint">會打開「${esc(p.dutyName)}」的報名頁，名字先幫您填好${p.names.length ? '' : '（沒有聽到名字，請自己加）'}，看一下沒問題再按「送出報名」。</p>`,
    run: (p) => {
      try { sessionStorage.setItem(SIGNUP_KEY, JSON.stringify({ dutyId: p.dutyId, date: p.date, names: p.names || [], position: p.position || '', at: Date.now() })); } catch (e) { /* 存不了就只打開 */ }
      const hash = '#/duty/' + encodeURIComponent(p.dutyId) + '?date=' + p.date;
      if (location.hash === hash) { location.hash = '#/'; setTimeout(() => { location.hash = hash; }, 0); } else location.hash = hash;
    }
  };

  /** 報名頁（js/signup.js）拿走語音幫忙填的內容（同一個勤務、10 分鐘內才算） */
  function takeSignup(dutyId) {
    try {
      const v = JSON.parse(sessionStorage.getItem(SIGNUP_KEY) || 'null');
      if (!v || v.dutyId !== dutyId || Date.now() - v.at > 600000) return null;
      sessionStorage.removeItem(SIGNUP_KEY);
      return v;
    } catch (e) { return null; }
  }

  /** 後台：js/voice-admin.js 把管理者的動作加進來 */
  function register(more) { Object.assign(handlers, more); }

  const inAdmin = () => Api.isAdmin() && /^#\/admin/.test(location.hash);

  // ---------- 畫面 ----------
  function mountButton() {
    if (document.querySelector('.voice-fab')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'voice-fab no-print';
    b.setAttribute('aria-label', '語音助理：用說的報名、問問題');
    b.innerHTML = '<span aria-hidden="true">🎤</span>';
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }

  function examples() {
    return inAdmin()
      ? ['12 月 26 號讀經班停課，老師請假', '新增 1 月 16 號宏宗打掃，第三組，早上 8 點', '12/12 讀經班補登測試甲、測試乙', '把敦化班放到首頁', '這週有哪些還缺人？']
      : ['我要報名 12 月 12 號的讀經班，王小明', '這個星期六有什麼活動？', '宏宗打掃還缺幾個人？'];
  }

  function open() {
    const m = Modal.open(`
      <h2 class="modal-title">🎤 語音助理</h2>
      <p class="hint">${inAdmin() ? '用說的做後台的事，每一件都會先給您確認。' : '用說的報名或問問題，會先給您確認。'}</p>
      <div class="voice-box">
        <button type="button" class="voice-mic" data-mic aria-label="開始說話">🎤</button>
        <p class="voice-state" data-state>${Rec ? '按一下麥克風開始說話，說完再按一次送出' : '這個瀏覽器不能用語音，請在下面打字'}</p>
      </div>
      <textarea class="input voice-text" rows="2" data-text placeholder="說的話會出現在這裡，也可以直接打字"></textarea>
      <p class="hint voice-eg">例如：${examples().map((x) => `「${esc(x)}」`).join('、')}</p>
      <div data-result></div>
      <div class="form-error" data-error hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-block btn-primary" data-send>送出</button>
        <button type="button" class="btn btn-block" data-close>關閉</button>
      </div>`);
    const el = m.el;
    const $ = (s) => el.querySelector(s);
    const textBox = $('[data-text]');
    const state = (t) => { $('[data-state]').textContent = t; };
    const err = (t) => { const e = $('[data-error]'); e.textContent = t || ''; e.hidden = !t; };
    let rec = null;
    const stop = () => { if (rec) { try { rec.stop(); } catch (e) { /* 已經停了 */ } } };
    const quit = () => { want = false; stop(); };
    $('[data-close]').addEventListener('click', () => { quit(); m.close(); });

    // 按一次開始收音、再按一次停下並送出（2026/11/27 維護者要求）；中間手機自己停了（靜音太久）就自動接著收
    let want = false; // 使用者還要繼續說
    let heard = ''; // 已經確定的字（重新開始收音時接在後面）
    /** 麥克風按鈕的樣子：idle 🎤（按了開始說）、listen 👂（正在聽，再按一次送出）、think ⏳（AI 在想，不能按） */
    function setMic(mode) {
      const b = $('[data-mic]');
      b.classList.toggle('is-on', mode === 'listen');
      b.classList.toggle('is-think', mode === 'think');
      b.disabled = mode === 'think';
      b.textContent = mode === 'listen' ? '👂' : mode === 'think' ? '⏳' : '🎤';
      b.setAttribute('aria-label', mode === 'listen' ? '正在聽，說完再按一次送出' : mode === 'think' ? 'AI 在想' : '開始說話');
    }
    function startRec() {
      rec = new Rec();
      rec.lang = 'zh-TW';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (ev) => {
        let fin = '';
        let interim = '';
        for (let i = 0; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) fin += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript;
        }
        rec._fin = fin;
        textBox.value = (heard + fin + interim).trim();
      };
      rec.onerror = (ev) => {
        if (ev.error === 'no-speech' || ev.error === 'aborted') return; // 還沒說話：等使用者按停
        want = false;
        state(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? '沒有麥克風權限，請在瀏覽器允許，或直接打字' : '語音辨識出了點問題，可以直接打字');
      };
      rec.onend = () => {
        heard = textBox.value.trim() ? textBox.value.trim() : heard;
        rec = null;
        if (want) { try { startRec(); return; } catch (e) { want = false; } } // 手機自己停了：接著收
        setMic('idle');
        if (textBox.value.trim()) { state('收到了，幫您整理中⋯'); send(); } else state('沒有聽到聲音，再按一次麥克風試試');
      };
      rec.start();
    }
    function listen() {
      if (!Rec) { textBox.focus(); return; }
      if (want) { // 第二次按：停下、送出
        want = false;
        state('收到了，幫您整理中⋯');
        if (rec) stop(); else { setMic('idle'); send(); }
        return;
      }
      err('');
      $('[data-result]').innerHTML = '';
      $('[data-send]').hidden = false;
      textBox.value = '';
      heard = '';
      want = true;
      setMic('listen');
      state('👂 正在聽⋯說完再按一次送出');
      try { startRec(); } catch (e) { want = false; rec = null; setMic('idle'); state('語音辨識打不開，可以直接打字'); }
    }
    $('[data-mic]').addEventListener('click', listen);

    async function send() {
      const text = textBox.value.trim();
      if (!text) { err('請先說話或打字'); return; }
      err('');
      const btn = $('[data-send]');
      btn.disabled = true;
      setMic('think');
      $('[data-result]').innerHTML = '<p class="muted voice-thinking">⏳ AI 想一下⋯（大約 5～15 秒）</p>';
      try {
        const res = inAdmin() ? await Api.admin('voiceAsk', { text }) : await Api.voiceAsk(text);
        showPlan(res.plan);
        state('還要做別的，再按一次麥克風');
      } catch (e) {
        $('[data-result]').innerHTML = '';
        err(e.message || '沒有成功，請再試一次');
        state('按一下麥克風，再說一次');
      } finally { btn.disabled = false; setMic('idle'); }
    }
    $('[data-send]').addEventListener('click', send);
    textBox.addEventListener('input', () => { $('[data-send]').hidden = false; }); // 改了字可以再送一次

    function showPlan(plan) {
      const h = handlers[plan.action] || handlers.unclear;
      if (plan.heard) textBox.value = plan.heard; // 去掉贅字、改正錯字後的那句話（可以再改、再送）
      const box = $('[data-result]');
      const names = plan.names && plan.names.length ? `<p class="voice-names">${plan.names.map((n) => `<span class="tag">${esc(n)}</span>`).join(' ')}</p>` : '';
      box.innerHTML = `<div class="voice-plan${plan.action === 'unclear' ? ' is-unclear' : ''}">
        <p class="voice-plan-title">${esc(h.title)}</p>
        ${plan.heard ? `<p class="voice-heard">🗣 我聽成：「${esc(plan.heard)}」</p>` : ''}
        <p class="voice-say">${esc(plan.say || '')}</p>
        ${plan.action === 'signup' || plan.action === 'attend' ? names : ''}
        ${h.detail ? h.detail(plan) : ''}
        ${h.confirm && h.run ? `<div class="voice-plan-actions"><button type="button" class="btn btn-primary" data-ok>✓ ${esc(h.confirm)}</button><button type="button" class="btn" data-no>不對，重說</button></div>` : ''}
      </div>`;
      const ok = box.querySelector('[data-ok]');
      $('[data-send]').hidden = !!ok; // 有確認卡時，下面的「送出」先藏起來（只留確認、重說）
      if (ok) {
        ok.addEventListener('click', async () => {
          ok.disabled = true;
          try {
            const msg = await h.run(plan, { close: () => { quit(); m.close(); } });
            if (msg) { box.innerHTML = `<div class="notice notice-success" role="status"><p>${esc(msg)}</p></div>`; } else { quit(); m.close(); }
          } catch (e) { ok.disabled = false; err(e.message || '沒有成功，請再試一次'); }
        });
        box.querySelector('[data-no]').addEventListener('click', () => { box.innerHTML = ''; textBox.value = ''; $('[data-send]').hidden = false; listen(); });
      }
    }

    if (!Rec) textBox.focus(); // 不自動開始：按麥克風才收音
  }

  // 測試中先藏起來（2026/11/27 維護者要求）：網址加 ?voice=1 打開過的這台手機才有按鈕；?voice=0 關掉
  const FLAG = 'duty-calendar:voice-on';
  function enabled() {
    try {
      const q = new URLSearchParams(location.search).get('voice');
      if (q === '1') localStorage.setItem(FLAG, '1');
      if (q === '0') localStorage.removeItem(FLAG);
      return localStorage.getItem(FLAG) === '1';
    } catch (e) { return false; }
  }
  function init() {
    if (!window.Api || !window.Modal || !enabled()) return;
    mountButton();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Voice = { register, takeSignup, open };
})();
