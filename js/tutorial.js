// 圖解教學（常見問題頁最上面）：一步一步的手機畫面，分 iPhone／Android。
// 圖片在 img/tutorial/（測試版、假名拍攝）：兩種手機一樣的寫 NN.jpg，不一樣的寫 ios-NN.jpg／android-NN.jpg。
(function () {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 兩種手機畫面不一樣的步驟
  const DIFF = ['01', '02', '03', '04', '05', '06', '16', '24', '25', '26', '27', '29'];
  // 每一步的說明（iPhone、Android 不同的寫成 [iPhone, Android]）
  const STEPS = {
    '01': '在 LINE 點教學裡的網址',
    '02': '還在 LINE 裡？按「用瀏覽器開啟」',
    '03': ['把網站放到桌面：點「分享」', '把網站放到桌面：點右上角「⋮」'],
    '04': ['往下找「加入主畫面」，點它', '選「加到主畫面」'],
    '05': ['按右上角的「新增」', '按「新增」'],
    '06': ['回到主畫面，點「勤務行事曆」', '回到桌面，點「勤務行事曆」'],
    '07': '按「近期」看最近的勤務',
    '08': '紅框寫「缺人」的最需要幫忙',
    '09': '也可以用月曆點日期',
    '10': '選了愿項目',
    '11': '輸入名字',
    '12': '確認名字和身分',
    '13': '可以幫家人一起報',
    '14': '好幾天的勤務：勾日期',
    '15': '按「確認報名」',
    '16': '看到「報名成功」就完成了 🎉',
    '17': '一人可做好幾項：在名字下面勾',
    '18': '活動的報名方式也一樣',
    '19': '拜香輪值：看輪值組就好',
    '20': '查我的報名：按這裡',
    '21': '打名字，點自己的名字',
    '22': '要取消或改期，按這裡',
    '23': '確認後才會取消',
    '24': '開啟手機提醒：按「好的，請提醒我」',
    '25': '手機問要不要允許，按「允許」',
    '26': '看到「已為您開啟」就完成了',
    '27': '想試試看，按「🔔 手機提醒」',
    '28': '按「傳一則測試通知給我」',
    '29': '收到通知，點一下就能看勤務'
  };
  const CHAPTERS = [
    ['📲 把網站放到手機桌面', 1, 6],
    ['✍️ 報名勤務', 7, 19],
    ['🔍 查我的報名、取消、改期', 20, 23],
    ['🔔 開啟手機提醒', 24, 29]
  ];

  const KEY = 'duty-calendar:tutorial-device';
  function device() {
    try { const v = localStorage.getItem(KEY); if (v === 'ios' || v === 'android') return v; } catch (e) { /* 無痕模式 */ }
    return /android/i.test(navigator.userAgent) ? 'android' : 'ios';
  }

  function stepHtml(n, dev) {
    const label = Array.isArray(STEPS[n]) ? STEPS[n][dev === 'ios' ? 0 : 1] : STEPS[n];
    const src = DIFF.indexOf(n) !== -1 ? `img/tutorial/${dev}-${n}.jpg` : `img/tutorial/${n}.jpg`;
    return `<li class="tut-step"><p class="tut-cap"><span class="tut-n">${Number(n)}</span>${esc(label)}</p><img src="${src}" alt="${esc(label)}" loading="lazy" width="540"></li>`;
  }

  function html() {
    const dev = device();
    return `
      <section class="tutorial">
        <h2 class="tut-title">📱 圖解教學<small>一步一步跟著做</small></h2>
        <div class="seg tut-device"><label class="seg-item"><input type="radio" name="tutDev" value="ios"${dev === 'ios' ? ' checked' : ''}><span>iPhone</span></label><label class="seg-item"><input type="radio" name="tutDev" value="android"${dev === 'android' ? ' checked' : ''}><span>Android</span></label></div>
        ${CHAPTERS.map(([title, from, to]) => {
          const nums = [];
          for (let i = from; i <= to; i++) nums.push(String(i).padStart(2, '0'));
          return `<details class="tut-chapter"><summary>${esc(title)}<small>${nums.length} 步</small></summary><ol class="tut-steps">${nums.map((n) => stepHtml(n, dev)).join('')}</ol></details>`;
        }).join('')}
      </section>`;
  }

  /** 把圖解教學放進 box；換手機種類時重畫（保留打開的章節） */
  function mount(box) {
    box.innerHTML = html();
    box.querySelectorAll('input[name=tutDev]').forEach((r) => r.addEventListener('change', () => {
      try { localStorage.setItem(KEY, r.value); } catch (e) { /* 無痕模式 */ }
      const open = [...box.querySelectorAll('.tut-chapter')].map((d) => d.open);
      mount(box);
      box.querySelectorAll('.tut-chapter').forEach((d, i) => { d.open = open[i]; });
    }));
  }

  const api = { mount, STEPS, DIFF, CHAPTERS };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Tutorial = api;
})();
