// 農曆換算：包裝 lunar-javascript（全域 Solar），並把簡體月名轉為繁體。
(function () {
  'use strict';

  const MONTH_NAMES = {
    '正': '正月', '二': '二月', '三': '三月', '四': '四月', '五': '五月', '六': '六月',
    '七': '七月', '八': '八月', '九': '九月', '十': '十月', '冬': '十一月', '腊': '十二月'
  };

  /** 'yyyy-MM-dd' → { month: '九月' | '閏六月', day: '初一', isFirst, isFifteenth, full: '九月初一' } */
  function lunarOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const lunar = window.Solar.fromYmd(y, m, d).getLunar();
    const raw = lunar.getMonthInChinese();
    const leap = raw.charAt(0) === '闰';
    const month = (leap ? '閏' : '') + MONTH_NAMES[leap ? raw.slice(1) : raw];
    const day = lunar.getDayInChinese();
    return {
      month,
      day,
      isFirst: lunar.getDay() === 1,
      isFifteenth: lunar.getDay() === 15,
      full: month + day
    };
  }

  /** 行事曆格子用的短標籤：初一顯示月名，其他顯示日 */
  function cellLabel(dateStr) {
    const l = lunarOf(dateStr);
    return { text: l.isFirst ? l.month : l.day, highlight: l.isFirst || l.isFifteenth };
  }

  window.LunarUtil = { lunarOf, cellLabel };
})();
