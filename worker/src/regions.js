// 分區（2026/11/19）：區代號 → 區名。教全區沒有代號（用原本的 Durable Object「main」）。
// 前端 js/region.js 有一樣的清單（tests/region.test.js 會檢查兩邊一致）。
export const REGIONS = {
  zhen: '教真區', shan: '教善區', mei: '教美區', zhi: '教志區', xiao: '教孝區', ren: '教仁區',
  yong: '教勇區', ding: '教定區', hui: '教慧區', fa: '教發區', ci: '教慈區', she: '教捨區'
};

/** 網址的 region 參數 → Durable Object 名稱；沒帶＝教全區（main），不認得的代號回 null */
export function regionOf(url) {
  const r = String(url.searchParams.get('region') || '').trim();
  if (!r || r === 'main') return 'main';
  return Object.prototype.hasOwnProperty.call(REGIONS, r) ? r : null;
}
