// 網站設定（前端）：團體名稱、場地、用詞、選項、要開哪些功能。複製給別的團體時，主要改這個檔案和 apps-script/Config.gs 最上面的 SITE。
// 兩邊的共同欄位要一致（tests/site-config.test.js 會檢查）。這裡只放公開的字，不放人名、電話。
(function () {
  window.SITE = {
    name: '教全區行事曆',              // 網站名稱（標題列、主畫面圖示名稱、通知）
    org: '教全區',                    // 團體名稱（名單開頭、缺人通知）
    venue: '區中心',                  // 可以借的場地名稱
    temple: '佛堂',                   // 「佛堂」這個用詞（同名同姓時用來分）
    categoryLabels: { 勤務: '總務・勤務', 道務: '道務', 教育: '教育' }, // 類別顯示的名字（內部代號不變）
    locations: ['宏宗', '區中心', '彌勒山', '厚德樓', '樹林頭活動地'],    // 新增勤務時的地點選項
    eduTeacherClasses: ['讀經班', '青少年班', '高大班', '青年班'],        // 教育統計「各班師資」看哪幾個班
    vegCandidateMin: 15,              // 道親清口：近一年出席幾次以上算「可成全清口」
    overseas: ['陸', '韓國'],         // 成員的「國外」選項（空白＝台灣）：統計算在同名的佛堂卡片，不算年齡統計
    // 通知、分享用的標題
    shortageTitle: '🙏【教全區勤務缺人通知】🙏',
    inviteTitle: '🙏【教全區 成全邀請】🙏',
    // 畫面上的範例字（placeholder）
    examples: { dutyName: '例：彌勒山志工輪值', pushBody: '例：今晚 19:30 宏宗，還缺 3 位，歡迎成全 🙏' },
    // 功能開關：不需要的設成 false（目前只用來顯示／隱藏入口）
    features: { venue: true, repair: true, help: true, push: true }
  };
})();
