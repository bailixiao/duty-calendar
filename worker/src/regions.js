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

/** 正式網站的網址（開通連結、推播聯絡用） */
export const SITE_BASE = 'https://bailixiao.github.io/duty-calendar/';

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
    siteUrl: (siteBase || SITE_BASE) + code + '/',
    aiRegion: name,
    aiRegionShort: name.replace(/區$/, '')
  };
}
