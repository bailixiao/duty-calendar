// 📸 活動相簿（2026/11/23）：活動當天起，任何人都可以上傳照片（自動縮成大圖 1600px＋縮圖 400px）、貼相簿連結（LINE、Google 相簿）。
// 家人們的勤務頁、後台的勤務名單都有；後台（不是唯讀）可以刪。全部下載＝打包成 zip。
// 後端：worker/src/app.js albumUpload、adminAlbumDelete；apps-script/Album.gs（album、albumLink）。
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAME_KEY = 'duty-calendar:mine-name';
  const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
  const saveName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 無痕模式 */ } };
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

  /** 照片縮成 JPEG：長邊 max、品質 q，回傳 base64 */
  function shrink(file, max, q) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', q).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀不到這張照片')); };
      img.src = url;
    });
  }
  const loadZip = () => (window.JSZip ? Promise.resolve() : new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = ok;
    s.onerror = () => no(new Error('無法載入打包工具，請檢查網路'));
    document.head.appendChild(s);
  }));

  /**
   * box：放相簿的地方；duty = { id, name, start, end, today }；opts = { admin（可以刪）, guard }
   */
  async function mount(box, duty, opts) {
    if (!box) return;
    opts = opts || {};
    const today = duty.today || Fmt.toDateStr(new Date());
    const dates = Fmt.datesBetween(duty.start, duty.end || duty.start).filter((d) => d <= today);
    if (!dates.length) { box.hidden = true; return; }
    box.hidden = false;
    let data = { dates: {}, maxPhotos: 60 };
    let cur = opts.date && dates.indexOf(opts.date) !== -1 ? opts.date : dates[dates.length - 1];
    const draw = () => {
      if (!box.isConnected) return;
      const day = data.dates[cur] || { photos: [], links: [] };
      const total = Object.values(data.dates).reduce((n, x) => n + x.photos.length, 0);
      box.innerHTML = `
        <h2>📸 活動照片${total ? `<span class="h2-sub">${total} 張</span>` : ''}</h2>
        ${dates.length > 1 ? `<div class="album-days">${dates.map((d) => { const n = (data.dates[d] || { photos: [] }).photos.length; return `<button type="button" class="album-day${d === cur ? ' is-on' : ''}" data-day="${d}">${md(d)}${n ? `<small>${n}</small>` : ''}</button>`; }).join('')}</div>` : ''}
        ${day.links.length ? `<ul class="album-links">${day.links.map((l) => `<li><a class="btn btn-block" href="${esc(l.url)}" target="_blank" rel="noopener nofollow">🔗 ${esc(l.label || '相簿')}<small>${esc(host(l.url))}・${esc(l.by)}</small></a>${opts.admin ? `<button type="button" class="btn btn-small btn-quiet-danger" data-del="${esc(l.id)}" aria-label="刪除這個連結">🗑</button>` : ''}</li>`).join('')}</ul>` : ''}
        ${day.photos.length ? `<div class="album-grid">${day.photos.map((p, i) => `<button type="button" class="album-thumb" data-view="${i}"><img src="${esc(Api.fileUrl(p.thumb))}" alt="${esc(p.by)} 放的照片" loading="lazy"></button>`).join('')}</div>`
          : `<p class="hint">${dates.length > 1 ? md(cur) + ' ' : ''}還沒有照片。有拍照的家人，歡迎放上來存查 🙏</p>`}
        <div class="album-actions">
          <button type="button" class="btn btn-primary" data-up>📷 上傳照片</button>
          <button type="button" class="btn" data-link>🔗 貼相簿連結</button>
          ${day.photos.length ? '<button type="button" class="btn" data-zip>⬇ 全部下載</button>' : ''}
        </div>
        <p class="hint">照片會自動縮小（手機看很清楚）；每天最多 ${data.maxPhotos} 張，挑精華的就好。更多照片可以放 LINE 或 Google 相簿，貼連結上來。</p>`;
      box.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.day; draw(); }));
      box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => view(Number(b.dataset.view))));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => del(b.dataset.del, '這個連結')));
      box.querySelector('[data-up]').addEventListener('click', upload);
      box.querySelector('[data-link]').addEventListener('click', addLink);
      const z = box.querySelector('[data-zip]');
      if (z) z.addEventListener('click', () => zip(z));
    };
    const load = async () => {
      try { data = await Api.album(duty.id); } catch (e) { /* 讀不到就先顯示空的 */ }
      draw();
    };

    /** 看大圖：左右切換；後台可以刪 */
    function view(i) {
      const list = (data.dates[cur] || { photos: [] }).photos;
      let k = i;
      const m = Modal.open('<div data-v></div>');
      m.el.classList.add('modal-wide');
      const paint = () => {
        const p = list[k];
        m.el.querySelector('[data-v]').innerHTML = `
          <p class="modal-note">${k + 1}／${list.length}・${esc(p.by)} 放的・${esc(String(p.at).slice(5, 16).replace('-', '/'))}</p>
          <img class="image-full" src="${esc(Api.fileUrl(p.file))}" alt="${esc(p.by)} 放的照片">
          <div class="album-nav">${list.length > 1 ? '<button type="button" class="btn" data-prev>‹ 上一張</button><button type="button" class="btn" data-next>下一張 ›</button>' : ''}</div>
          <div class="modal-actions">
            <a class="btn btn-block" href="${esc(Api.fileUrl(p.file))}" target="_blank" rel="noopener">開新頁看大圖（可以用手指放大、長按存檔）</a>
            ${opts.admin ? '<button type="button" class="btn btn-block btn-quiet-danger" data-del-photo>🗑 刪除這張</button>' : ''}
            <button type="button" class="btn btn-block" data-close>關閉</button>
          </div>`;
        const v = m.el.querySelector('[data-v]');
        v.querySelector('[data-close]').addEventListener('click', () => m.close());
        const pv = v.querySelector('[data-prev]');
        if (pv) pv.addEventListener('click', () => { k = (k - 1 + list.length) % list.length; paint(); });
        const nx = v.querySelector('[data-next]');
        if (nx) nx.addEventListener('click', () => { k = (k + 1) % list.length; paint(); });
        const dl = v.querySelector('[data-del-photo]');
        if (dl) dl.addEventListener('click', async () => { m.close(); await del(p.id, '這張照片'); });
      };
      paint();
    }

    async function del(id, what) {
      const ok = await Confirm.open({ title: `確定要刪除${what}嗎？`, rows: [['活動', duty.name || ''], ['日期', md(cur)]], note: '刪掉就找不回來了。', confirmText: '確定刪除', cancelText: '不要刪除', danger: true });
      if (!ok) return;
      Busy.show('刪除中⋯');
      try { data = await Api.admin('adminAlbumDelete', { id }); Busy.hide(); draw(); } catch (e) { Busy.hide(); if (!(opts.guard && opts.guard(e))) alert(e.message); }
    }

    /** 名字欄（連動成員名單） */
    const nameField = () => `<label class="form-row"><span>您的名字（誰放的）</span><input class="input" name="by" maxlength="20" value="${esc(savedName())}" autocomplete="off" placeholder="打一兩個字會出現名單"></label>`;
    const attachName = (f) => { if (window.MemberSuggest) MemberSuggest.attach(f.elements.by); };

    function upload() {
      const m = Modal.open(`<h2 class="modal-title">📷 上傳照片</h2>
        <p class="modal-note">${esc(duty.name || '')}・${md(cur)}</p>
        <form class="admin-form" novalidate>
          ${nameField()}
          <label class="form-row"><span>選照片（可以一次選好幾張）</span><input class="input" type="file" name="files" accept="image/*" multiple></label>
          <p class="hint" data-prog></p>
          <div class="form-error" data-error hidden></div>
          <div class="modal-actions"><button type="submit" class="btn btn-primary btn-block">上傳</button><button type="button" class="btn btn-block" data-close>返回</button></div>
        </form>`);
      const f = m.el.querySelector('form');
      attachName(f);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const box2 = f.querySelector('[data-error]');
        const prog = f.querySelector('[data-prog]');
        box2.hidden = true;
        const by = f.elements.by.value.replace(/\s+/g, '');
        const files = [...f.elements.files.files];
        if (by.length < 2) { box2.textContent = '請填您的名字'; box2.hidden = false; return; }
        if (!files.length) { box2.textContent = '請選照片'; box2.hidden = false; return; }
        saveName(by);
        m.el.setAttribute('data-locked', '');
        f.querySelector('[type=submit]').disabled = true;
        let done = 0;
        const fails = [];
        for (let i = 0; i < files.length; i++) {
          prog.textContent = `上傳中⋯（${i + 1}／${files.length}）`;
          try {
            const [big, small] = await Promise.all([shrink(files[i], 1600, 0.82), shrink(files[i], 400, 0.7)]);
            data = await Api.albumUpload({ dutyId: duty.id, date: cur, by, mime: 'image/jpeg', data: big, thumb: small });
            done++;
          } catch (e) {
            fails.push(`${files[i].name || '第 ' + (i + 1) + ' 張'}：${e.message}`);
            if (/最多|太多/.test(e.message)) break;
          }
        }
        m.el.removeAttribute('data-locked');
        draw();
        if (!fails.length) { m.close(); return; }
        f.querySelector('[type=submit]').disabled = false;
        prog.textContent = done ? `已上傳 ${done} 張。` : '';
        box2.textContent = '這幾張沒有上傳成功：' + fails.join('；');
        box2.hidden = false;
      });
    }

    function addLink() {
      const m = Modal.open(`<h2 class="modal-title">🔗 貼相簿連結</h2>
        <p class="modal-note">照片很多的話，放在 LINE 相簿或 Google 相簿，把分享連結貼在這裡，大家就找得到。</p>
        <form class="admin-form" novalidate>
          <label class="form-row"><span>相簿網址</span><input class="input" name="url" inputmode="url" placeholder="https://⋯"></label>
          <label class="form-row"><span>說明（可空白）</span><input class="input" name="label" maxlength="30" placeholder="例：LINE 相簿、全部照片"></label>
          ${nameField()}
          <div class="form-error" data-error hidden></div>
          <div class="modal-actions"><button type="submit" class="btn btn-primary btn-block">貼上</button><button type="button" class="btn btn-block" data-close>返回</button></div>
        </form>`);
      const f = m.el.querySelector('form');
      attachName(f);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const box2 = f.querySelector('[data-error]');
        box2.hidden = true;
        const by = f.elements.by.value.replace(/\s+/g, '');
        // 從 LINE 複製常會帶一段文字：取出裡面的網址
        const raw = f.elements.url.value.trim();
        const url = (raw.match(/https:\/\/\S+/) || [raw])[0];
        Busy.show('貼上中⋯');
        try {
          data = await Api.albumLink({ dutyId: duty.id, date: cur, by, url, label: f.elements.label.value });
          if (by) saveName(by);
          Busy.hide(); m.close(); draw();
        } catch (e) { Busy.hide(); box2.textContent = e.message; box2.hidden = false; }
      });
    }

    async function zip(btn) {
      const list = (data.dates[cur] || { photos: [] }).photos;
      btn.disabled = true;
      try {
        await loadZip();
        const z = new JSZip();
        for (let i = 0; i < list.length; i++) {
          btn.textContent = `打包中⋯（${i + 1}／${list.length}）`;
          const res = await fetch(Api.fileUrl(list[i].file));
          z.file(`${String(i + 1).padStart(2, '0')}_${list[i].by}.jpg`, await res.blob());
        }
        const blob = await z.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${duty.name || '活動'}_${cur}_照片.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      } catch (e) { alert(e.message || '下載失敗'); }
      btn.disabled = false;
      btn.textContent = '⬇ 全部下載';
    }

    draw();
    load();
  }

  window.Album = { mount };
})();
