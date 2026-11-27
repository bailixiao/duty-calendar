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
        <p class="voice-state" data-state>${Rec ? '按一下麥克風，開始說話' : '這個瀏覽器不能用語音，請在下面打字'}</p>
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
    $('[data-close]').addEventListener('click', () => { stop(); m.close(); });

    function listen() {
      if (!Rec) { textBox.focus(); return; }
      if (rec) { stop(); return; }
      err('');
      $('[data-result]').innerHTML = '';
      $('[data-send]').hidden = false;
      rec = new Rec();
      rec.lang = 'zh-TW';
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = '';
      $('[data-mic]').classList.add('is-on');
      state('請說話⋯（說完會自動停）');
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript;
        }
        textBox.value = (finalText + interim).trim();
      };
      rec.onerror = (ev) => {
        state(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? '沒有麥克風權限，請在瀏覽器允許，或直接打字' : ev.error === 'no-speech' ? '沒有聽到聲音，再按一次麥克風試試' : '語音辨識出了點問題，可以直接打字');
      };
      rec.onend = () => {
        rec = null;
        $('[data-mic]').classList.remove('is-on');
        if (textBox.value.trim() && finalText) { state('聽到了，幫您整理中⋯'); send(); } else if ($('[data-state]').textContent.indexOf('請說話') === 0) state('按一下麥克風，開始說話');
      };
      try { rec.start(); } catch (e) { rec = null; state('語音辨識打不開，可以直接打字'); }
    }
    $('[data-mic]').addEventListener('click', listen);

    async function send() {
      const text = textBox.value.trim();
      if (!text) { err('請先說話或打字'); return; }
      err('');
      const btn = $('[data-send]');
      btn.disabled = true;
      $('[data-result]').innerHTML = '<p class="muted voice-thinking">⏳ AI 想一下⋯（大約 5～15 秒）</p>';
      try {
        const res = inAdmin() ? await Api.admin('voiceAsk', { text }) : await Api.voiceAsk(text);
        showPlan(res.plan);
        state('還要做別的，再按一次麥克風');
      } catch (e) {
        $('[data-result]').innerHTML = '';
        err(e.message || '沒有成功，請再試一次');
        state('按一下麥克風，再說一次');
      } finally { btn.disabled = false; }
    }
    $('[data-send]').addEventListener('click', send);
    textBox.addEventListener('input', () => { $('[data-send]').hidden = false; }); // 改了字可以再送一次

    function showPlan(plan) {
      const h = handlers[plan.action] || handlers.unclear;
      const box = $('[data-result]');
      const names = plan.names && plan.names.length ? `<p class="voice-names">${plan.names.map((n) => `<span class="tag">${esc(n)}</span>`).join(' ')}</p>` : '';
      box.innerHTML = `<div class="voice-plan${plan.action === 'unclear' ? ' is-unclear' : ''}">
        <p class="voice-plan-title">${esc(h.title)}</p>
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
            const msg = await h.run(plan, { close: () => { stop(); m.close(); } });
            if (msg) { box.innerHTML = `<div class="notice notice-success" role="status"><p>${esc(msg)}</p></div>`; } else { stop(); m.close(); }
          } catch (e) { ok.disabled = false; err(e.message || '沒有成功，請再試一次'); }
        });
        box.querySelector('[data-no]').addEventListener('click', () => { box.innerHTML = ''; textBox.value = ''; $('[data-send]').hidden = false; listen(); });
      }
    }

    if (Rec) listen(); else textBox.focus();
  }

  function init() {
    if (!window.Api || !window.Modal) return;
    mountButton();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Voice = { register, takeSignup, open };
})();
