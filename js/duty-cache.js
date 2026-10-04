// 勤務詳情的快取：開網站時一次打包拿回近 30 天勤務的詳情（見 calendar.js 的 getBundle），
// 點進勤務就能立刻顯示；看過的也記住。記在這台瀏覽器（localStorage），下次打開先顯示上次的，同時在背景更新。
// 名單本來就公開在勤務頁上；報名、取消時伺服器一律重新檢查，快取舊了也不會出錯。
(function () {
  'use strict';

  const STORAGE_KEY = 'duty-calendar:details';
  const FRESH_MS = 30000; // 30 秒內拿到的視為最新，點進去不用再問伺服器
  const MAX_KEEP = 80;

  const map = new Map(); // id → { data, at }（at：從伺服器拿到的時間；從手機讀出來的舊資料 at = 0）
  const inflight = new Map(); // id → Promise

  (function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') Object.keys(raw).forEach((id) => map.set(id, { data: raw[id], at: 0 }));
    } catch (e) { /* 讀不到就算了 */ }
  })();

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        // 只留最近拿到的，且勤務還沒結束的
        const today = Fmt.toDateStr(new Date());
        const keep = [...map.entries()]
          .filter(([, v]) => v.data && v.data.end >= today)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, MAX_KEEP);
        const obj = {};
        keep.forEach(([id, v]) => { obj[id] = v.data; });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch (e) { /* 空間不足或無痕模式，忽略 */ }
    }, 500);
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  /** 有快取就回傳一份複本（可以隨意修改），沒有回傳 null */
  function get(id) {
    const v = map.get(id);
    if (!v) return null;
    const data = clone(v.data);
    // 上次存的「今天」可能已經過了一天（判斷能不能取消、改期要用）
    const today = Fmt.toDateStr(new Date());
    if (!data.today || data.today < today) data.today = today;
    return data;
  }

  function isFresh(id) {
    const v = map.get(id);
    return !!v && Date.now() - v.at < FRESH_MS;
  }

  function set(id, data) {
    if (!id || !data) return;
    map.set(id, { data: clone(data), at: Date.now() });
    save();
  }

  /** 打包拿回的一批詳情 { id: data } */
  function setMany(details) {
    const now = Date.now();
    Object.keys(details || {}).forEach((id) => map.set(id, { data: details[id], at: now }));
    save();
  }

  /** 向伺服器讀（同一個勤務同時只問一次）；結果存進快取 */
  function fetch(id) {
    if (inflight.has(id)) return inflight.get(id);
    const p = Api.getDuty(id).then((data) => {
      inflight.delete(id);
      set(id, data);
      return data;
    }, (err) => {
      inflight.delete(id);
      throw err;
    });
    inflight.set(id, p);
    return p;
  }

  /** 手指碰到勤務卡片時先讀（已經是最新的就不讀） */
  function prefetch(id) {
    if (!id || isFresh(id) || inflight.has(id)) return;
    fetch(id).catch(() => { /* 預先讀取失敗無妨，點進去會再讀 */ });
  }

  // 行事曆、近期、我的報名上的勤務連結：手指一碰到（還沒放開）就開始讀
  function onTouch(ev) {
    const a = ev.target.closest && ev.target.closest('a[href^="#/duty/"], a[href^="#/grid/"]');
    if (!a) return;
    const m = a.getAttribute('href').match(/^#\/(?:duty|grid)\/([^?]+)/);
    if (m) prefetch(decodeURIComponent(m[1]));
  }
  document.addEventListener('pointerdown', onTouch, { passive: true });
  document.addEventListener('mouseover', onTouch, { passive: true });

  window.DutyCache = { get, set, setMany, fetch, prefetch, isFresh };
})();
