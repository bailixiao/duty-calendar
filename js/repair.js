// 區中心修繕回報（借場地頁）：公開「目前已知的問題」＋「🔧 回報需要修繕」表單（文字＋最多 3 張照片）。見 apps-script/Repair.gs。
// 照片先縮小再上傳（repairUpload），只有後台看得到；回報人的電話記在這台手機（和借場地的資料一起）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const URGENCY = [['一般', '一般'], ['盡快', '盡快'], ['有危險', '⚠️ 有危險（漏電、漏水、會受傷）']];
  let locations = [];
  /** 標題：舊資料有位置照舊；沒有就用「在哪裡」，再沒有就用問題的前幾個字 */
  const repairTitle = (r) => (r.location ? r.location + (r.detail ? `（${r.detail}）` : '') : r.detail || String(r.problem || '').slice(0, 16));

  /** 在 box 裡畫出目前已知的問題 */
  async function mount(box) {
    box.innerHTML = `<h2 class="venue-h">🔧 ${esc(window.SITE.venue)}修繕</h2>
      <p class="hint">發現哪裡壞了、需要修理，請告訴我們，管理者會盡快處理 🙏</p>
      <button type="button" class="btn btn-block repair-open" data-repair-open>🔧 回報需要修繕</button>
      <div data-repair-list><p class="muted">讀取中⋯</p></div>`;
    box.querySelector('[data-repair-open]').addEventListener('click', () => openForm(box));
    await drawList(box);
  }

  async function drawList(box) {
    const list = box.querySelector('[data-repair-list]');
    try {
      const res = await Api.getRepairs();
      locations = res.locations;
      list.innerHTML = res.items.length ? `<p class="repair-sub">目前已知的問題：</p><ul class="repair-list">${res.items.map((r) => `
        <li class="repair-item is-${r.status === '已修好' ? 'done' : r.urgency === '有危險' ? 'danger' : 'open'}">
          <span class="repair-where">${r.status === '已修好' ? '✅' : r.urgency === '有危險' ? '⚠️' : '🔧'} ${esc(repairTitle(r))}</span>
          <span class="repair-what">${esc(r.problem)}</span>
          <span class="repair-meta">${esc(r.status)}${r.status === '已修好' && r.doneAt ? `・${esc(Fmt.shortDate(r.doneAt))} 修好` : `・${esc(Fmt.shortDate(r.date))} 回報`}</span>
        </li>`).join('')}</ul>` : '<p class="muted">目前沒有已知的問題 😊</p>';
    } catch (e) {
      list.innerHTML = '';
    }
  }

  function profile() {
    try { return JSON.parse(localStorage.getItem('duty-calendar:venue-profiles') || '{}'); } catch (e) { return {}; }
  }

  function openForm(box) {
    const p = profile();
    const lastName = (() => { try { return localStorage.getItem('duty-calendar:venue-name') || ''; } catch (e) { return ''; } })();
    const me = lastName && p[lastName] ? { name: lastName, phone: p[lastName].phone || '' } : { name: lastName, phone: '' };
    const photos = []; // { id, url }
    const m = Modal.open(`
      <form class="modal-form repair-form" novalidate>
        <h2 class="modal-title">🔧 回報需要修繕</h2>
        <label class="form-row"><span>在哪裡（選填）</span><input class="input" name="detail" maxlength="40" placeholder="例：大殿、二樓廁所、靠窗那台冷氣"></label>
        <label class="form-row"><span>什麼問題？</span><textarea class="input" name="problem" rows="3" maxlength="500" placeholder="例：冷氣開了不會冷，有滴水"></textarea></label>
        <div class="form-row"><span>急不急？</span>
          <div class="repair-urgency">${URGENCY.map(([v, l], i) => `<label class="check"><input type="radio" name="urgency" value="${v}"${i === 0 ? ' checked' : ''}> ${l}</label>`).join('')}</div></div>
        <div class="form-row"><span>照片（選填，最多 3 張）</span>
          <div class="repair-photos" data-photos></div>
          <label class="btn repair-photo-btn" data-photo-btn>📷 拍照或選照片<input type="file" accept="image/*" multiple hidden data-photo-input></label></div>
        <label class="form-row"><span>姓名</span><input class="input" name="name" autocomplete="name" value="${esc(me.name)}" placeholder="例：王小明"></label>
        <label class="form-row"><span>聯絡電話（只有管理者看得到）</span><input class="input" name="phone" type="tel" inputmode="tel" value="${esc(me.phone)}" placeholder="例：0912-345678"></label>
        <div class="form-error" data-err hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary btn-block">送出回報</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const err = f.querySelector('[data-err]');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const drawPhotos = () => {
      f.querySelector('[data-photos]').innerHTML = photos.map((ph, i) => `<span class="repair-thumb"><img src="${esc(ph.url)}" alt="照片 ${i + 1}"><button type="button" class="repair-thumb-del" data-del="${i}" aria-label="拿掉這張">✕</button></span>`).join('');
      f.querySelector('[data-photo-btn]').hidden = photos.length >= 3;
    };
    f.querySelector('[data-photos]').addEventListener('click', (ev) => {
      const d = ev.target.closest('[data-del]');
      if (!d) return;
      photos.splice(Number(d.dataset.del), 1);
      drawPhotos();
    });
    f.querySelector('[data-photo-input]').addEventListener('change', async (ev) => {
      const files = [...ev.target.files].slice(0, 3 - photos.length);
      ev.target.value = '';
      for (const file of files) {
        Busy.show(`上傳照片中（${photos.length + 1}）⋯`);
        try {
          const img = await shrink(file);
          const res = await Api.repairUpload({ mime: img.mime, data: img.data });
          photos.push({ id: res.id, url: 'data:image/jpeg;base64,' + img.data });
        } catch (e) {
          err.textContent = e.message || '照片上傳失敗，請再試一次';
          err.hidden = false;
        }
        Busy.hide();
      }
      drawPhotos();
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const body = {
        detail: f.elements.detail.value.trim(), problem: f.elements.problem.value.trim(),
        urgency: f.querySelector('[name=urgency]:checked').value, name: f.elements.name.value.trim(), phone: f.elements.phone.value.trim(),
        photos: photos.map((x) => x.id)
      };
      Busy.show('送出中⋯');
      try {
        const res = await Api.reportRepair(body);
        Busy.hide();
        m.close();
        const flash = document.createElement('div');
        flash.className = 'notice notice-success notice-big';
        flash.setAttribute('role', 'status');
        flash.innerHTML = '<p><strong>🙏 已收到您的回報，感恩您！</strong></p><p>管理者會盡快處理，進度會顯示在下面的「目前已知的問題」。</p>';
        box.insertBefore(flash, box.querySelector('[data-repair-list]'));
        offerNotify(flash, res.id);
        drawList(box);
      } catch (e) {
        Busy.hide();
        err.innerHTML = `<strong>${esc(e.message || '送出失敗')}</strong>${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        err.hidden = false;
      }
    });
    drawPhotos();
  }

  /** 修好時要不要通知（同借場地的審核結果通知） */
  async function offerNotify(box, id) {
    if (!window.PushPage) return;
    const st = PushPage.canNotify();
    if (st !== 'ok') return;
    const watch = async () => Api.repairWatch(await PushPage.ensureSub(), id);
    if (Notification.permission === 'granted') {
      try { await watch(); box.insertAdjacentHTML('beforeend', '<p>🔔 處理進度會傳通知給您 😊</p>'); } catch (e) { /* 沒關係 */ }
      return;
    }
    const card = document.createElement('div');
    card.innerHTML = '<p><strong>🔔 修好時要通知您嗎？</strong></p><div class="push-card-actions"><button type="button" class="btn btn-primary" data-yes>好的，通知我</button><button type="button" class="btn" data-no>不用了</button></div>';
    box.appendChild(card);
    card.querySelector('[data-no]').addEventListener('click', () => card.remove());
    card.querySelector('[data-yes]').addEventListener('click', async () => {
      try { await watch(); card.innerHTML = '<p>✅ 好的，有進度會通知您 😊</p>'; } catch (e) { card.innerHTML = `<p class="form-error">${esc(e.message || '沒有設定成功')}</p>`; }
    });
  }

  /** 照片縮成長邊 1600px 的 JPEG */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀不到這張照片')); };
      img.src = url;
    });
  }

  window.RepairPage = { mount };
})();
