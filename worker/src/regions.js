// 分區（2026/11/19）：區代號 → 區名。教全區沒有代號（用原本的 Durable Object「main」）。
// 前端 js/region.js 有一樣的清單（tests/region.test.js 會檢查兩邊一致）。
export const REGIONS = {
  zhen: '教真區', shan: '教善區', mei: '教美區', zhi: '教志區', xiao: '教孝區', ren: '教仁區',
  yong: '教勇區', ding: '教定區', hui: '教慧區', fa: '教發區', ci: '教慈區', she: '教捨區',
    hq: '宏教分壇' // 宏教分壇（2026/11/22）：上級單位，只有「📣 分派」後台，沒有行事曆；分派送給上面 12 區和教全區（worker/src/hq.js）
};

/** 網址的 region 參數 → Durable Object 名稱；沒帶＝教全區（main），不認得的代號回 null */
export function regionOf(url) {
  const r = String(url.searchParams.get('region') || '').trim();
  if (!r || r === 'main') return 'main';
  return Object.prototype.hasOwnProperty.call(REGIONS, r) ? r : null;
}

/** 正式網站的網址（教全區；開通連結、推播聯絡用） */
export const SITE_BASE = 'https://jiaoquan-cal.pages.dev/'; // 2026/11/19 從 bailixiao.github.io/duty-calendar/ 搬過來（tools/build-pages.js）

/**
 * 每一區自己的網站（2026/11/26）：https://jiao<代號>-cal.pages.dev/（教捨區 jiaoshe-cal），宏教分壇 https://hong-cal.pages.dev/。
 * 每一個都是 Cloudflare Pages 的專案（tools/build-pages.js 一起部署）；網頁用網域認是哪一區（js/region.js，兩邊要一致）。
 * 舊網址 jiaoquan-cal.pages.dev/she/、?r=she 會自動轉過去（index.html 最前面）。
 */
export function regionHost(code) {
  return code === 'hq' ? 'hong-cal' : 'jiao' + code + '-cal';
}
/** 某一區的網站網址；siteBase 不是正式網站（本機測試版）時照舊用 …/<代號>/ */
export function regionSiteUrl(code, siteBase) {
  if (!code || code === 'main') return siteBase || SITE_BASE;
  if (siteBase && siteBase !== SITE_BASE) return siteBase + code + '/';
  return 'https://' + regionHost(code) + '.pages.dev/';
}

/** 新開通的區一開始的網站設定（存進那一區的 SITE_JSON；之後總管理者在後台「⚙️ 區設定」改） */
export function regionSiteDefaults(code, siteBase) {
  const name = REGIONS[code];
  return {
    name: name + '行事曆',
    org: name,
    venue: '區中心',
    temple: '佛堂',
    categoryLabels: { 勤務: '總務・勤務', 道務: '道務', 教育: '教育' },
    locations: ['區中心'],
    eduTeacherClasses: ['讀經班', '青少年班', '高大班', '青年班'],
    overseas: [],
    shortageTitle: '🙏【' + name + '勤務缺人通知】🙏',
    inviteTitle: '🙏【' + name + ' 成全邀請】🙏',
    features: { venue: true, repair: true, help: true, push: true },
    siteUrl: regionSiteUrl(code, siteBase),
    aiRegion: name,
    aiRegionShort: name.replace(/區$/, '')
  };
}
