// 手機提醒（推播）：開啟後每天晚上 8 點通知明天的勤務、早上 7 點通知今天的勤務（見 apps-script/Push.gs、sw.js）。
//   - 通知一定要本人按「允許」，網站不能自己打開。所以第一次打開網站時，行事曆上方會出現一張詢問卡片；
//     按「以後再說」兩週後再問。已開啟、已封鎖、或不支援的手機不顯示。
//   - iPhone 要先「加到主畫面」、從主畫面圖示打開才能收通知，卡片會改成教學。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const ASK_KEY = 'duty-calendar:push-ask-later';
  const ASK_AGAIN_MS = 14 * 24 * 3600 * 1000;

  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function b64ToBytes(b64) {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }

  async function registration() {
    // sw.js 在網頁載入後才註冊（本機測試要加 ?sw=1）；這裡等它好，最多 10 秒
    if (!navigator.serviceWorker.controller) navigator.serviceWorker.register('sw.js').catch(() => {});
    return Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('通知功能還在準備中，麻煩您重新整理網頁後再試一次，謝謝您 🙏')), 10000))]);
  }

  async function currentSub() {
    if (!supported() || Notification.permission !== 'granted') return null;
    try { return await (await registration()).pushManager.getSubscription(); } catch (e) { return null; }
  }

  /** 目前狀態：'ios-install' | 'unsupported' | 'denied' | 'on' | 'off' */
  async function state() {
    if (isIOS() && !standalone()) return 'ios-install';
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return (await currentSub()) ? 'on' : 'off';
  }

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? '通知目前被封鎖了，麻煩您到手機的「設定 → 通知」允許本網站，謝謝您 🙏' : '您還沒有允許通知，所以提醒尚未開啟。');
    const reg = await registration();
    const { publicKey } = await Api.pushKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await Api.pushSubscribe(sub.endpoint);
  }

  async function disable() {
    const sub = await currentSub();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await Api.pushUnsubscribe(endpoint).catch(() => {});
  }

  const IOS_STEPS = `
    <ol class="push-steps">
      <li>用 <strong>Safari</strong> 開啟本網站</li>
      <li>點下方的 <strong>分享</strong> 按鈕（方框加向上箭頭 ⬆️）</li>
      <li>往下找 <strong>「加入主畫面」</strong>，按「新增」</li>
      <li>回到手機主畫面，點 <strong>「勤務行事曆」</strong> 圖示打開</li>
      <li>再按一次 <strong>🔔 手機提醒</strong>，就可以開啟了 😊</li>
    </ol>`;

  // ---------- 「🔔 手機提醒」視窗 ----------

  async function openPanel() {
    const m = Modal.open('<h2 class="modal-title">🔔 手機提醒</h2><div data-push-body><p class="panel-empty">讀取中⋯</p></div>');
    const body = m.el.querySelector('[data-push-body]');
    const render = async (flash) => {
      const st = await state();
      const note = flash ? `<div class="notice notice-${flash.kind}" role="status"><p>${esc(flash.text)}</p></div>` : '';
      const close = '<button type="button" class="btn btn-block" data-close>返回</button>';
      if (st === 'ios-install') {
        body.innerHTML = `${note}<p>iPhone 需要先把本網站<strong>加到主畫面</strong>，才能收到勤務提醒，步驟如下：</p>${IOS_STEPS}<div class="modal-actions">${close}</div>`;
      } else if (st === 'unsupported') {
        body.innerHTML = `${note}<p>不好意思，這個瀏覽器還不支援通知。麻煩您改用 <strong>Chrome</strong>（Android）或 <strong>Safari</strong>（iPhone）開啟本網站。</p><p class="muted">您也可以在報名後按「加到手機行事曆」，前一天同樣會提醒您 😊</p><div class="modal-actions">${close}</div>`;
      } else if (st === 'denied') {
        body.innerHTML = `${note}<p>通知目前被封鎖了。麻煩您到手機的 <strong>設定 → 通知</strong>（或瀏覽器的網站設定），允許本網站傳送通知，再回來開啟，謝謝您 🙏</p><div class="modal-actions">${close}</div>`;
      } else if (st === 'on') {
        body.innerHTML = `${note}<p>✅ <strong>已為您開啟提醒</strong>。有勤務或活動時，會在<strong>前一天晚上 8 點</strong>、<strong>當天早上 7 點</strong>溫馨提醒您。感恩您的發心 🙏</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-block btn-primary" data-test>傳一則測試通知給我</button>
            <button type="button" class="btn btn-block" data-off>關閉提醒</button>
            ${close}
          </div>`;
      } else {
        body.innerHTML = `${note}<p>開啟後，每逢有勤務或活動，會在<strong>前一天晚上 8 點</strong>、<strong>當天早上 7 點</strong>溫馨提醒您 🙏</p><p class="muted">沒有勤務的日子不會打擾您。</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-block btn-primary" data-on>好的，請提醒我</button>
            ${close}
          </div>`;
      }
      bind();
    };
    const run = async (btn, text, fn, okText) => {
      btn.disabled = true;
      btn.textContent = text;
      try {
        await fn();
        await render(okText ? { kind: 'success', text: okText } : null);
        hideCard();
      } catch (e) {
        await render({ kind: 'error', text: e.message || '不好意思，這次沒有成功，請稍後再試一次 🙏' });
      }
    };
    function bind() {
      const q = (s) => body.querySelector(s);
      if (q('[data-close]')) q('[data-close]').addEventListener('click', () => m.close());
      if (q('[data-on]')) q('[data-on]').addEventListener('click', (ev) => run(ev.target, '正在為您開啟⋯', enable, '已為您開啟提醒 🎉 可以按「傳一則測試通知給我」試試看喔'));
      if (q('[data-off]')) q('[data-off]').addEventListener('click', (ev) => run(ev.target, '正在關閉⋯', disable, '已為您關閉提醒，隨時歡迎再開啟 😊'));
      if (q('[data-test]')) q('[data-test]').addEventListener('click', (ev) => run(ev.target, '正在傳送⋯', async () => {
        const sub = await currentSub();
        if (!sub) throw new Error('提醒目前沒有開啟喔');
        await Api.pushTest(sub.endpoint);
      }, '已送出測試通知，請稍候幾秒鐘 😊 若沒有收到，麻煩您看看手機是否開啟了勿擾或省電模式。'));
    }
    render();
  }

  // ---------- 行事曆上方的詢問卡片 ----------

  function askedRecently() {
    try { return Date.now() - Number(localStorage.getItem(ASK_KEY) || 0) < ASK_AGAIN_MS; } catch (e) { return false; }
  }

  function hideCard() {
    const card = document.getElementById('push-card');
    if (card) card.hidden = true;
  }

  async function showCardIfNeeded() {
    const card = document.getElementById('push-card');
    if (!card || askedRecently()) return;
    const st = await state();
    if (st !== 'off' && st !== 'ios-install') return;
    try { await Api.pushKey(); } catch (e) { return; } // 管理者還沒設定推播（setupPush）就先不問
    card.innerHTML = st === 'ios-install'
      ? `<p><strong>🔔 想收到勤務提醒嗎？</strong></p><p>iPhone 只要把本網站<strong>加到主畫面</strong>，就能收到溫馨提醒 😊</p>
         <div class="push-card-actions"><button type="button" class="btn btn-primary" data-card-how>教我怎麼做</button><button type="button" class="btn" data-card-later>以後再說</button></div>`
      : `<p><strong>🔔 需要為您開啟勤務提醒嗎？</strong></p><p>有勤務或活動時，會在前一天晚上溫馨提醒您，讓您不錯過每一次了愿的機會 🙏</p>
         <div class="push-card-actions"><button type="button" class="btn btn-primary" data-card-on>好的，請提醒我</button><button type="button" class="btn" data-card-later>以後再說</button></div>`;
    card.hidden = false;
    card.querySelector('[data-card-later]').addEventListener('click', () => {
      try { localStorage.setItem(ASK_KEY, String(Date.now())); } catch (e) { /* 無痕模式：下次再問 */ }
      hideCard();
    });
    const how = card.querySelector('[data-card-how]');
    if (how) how.addEventListener('click', openPanel);
    const on = card.querySelector('[data-card-on]');
    if (on) on.addEventListener('click', async () => {
      on.disabled = true;
      on.textContent = '正在為您開啟⋯';
      try {
        await enable();
        card.innerHTML = '<p>✅ 已為您開啟勤務提醒，感恩您 🙏</p>';
        setTimeout(hideCard, 3000);
      } catch (e) {
        on.disabled = false;
        on.textContent = '好的，請提醒我';
        card.insertAdjacentHTML('beforeend', `<p class="form-error">${esc(e.message || '不好意思，這次沒有成功，請稍後再試一次 🙏')}</p>`);
      }
    });
  }

  window.PushPage = { openPanel, showCardIfNeeded };
})();
