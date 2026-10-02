// 勤務頁的「重點圖片」：依勤務名稱（含這段文字就算）顯示的說明圖片，圖片放在 img/duty/。
// 圖片會公開（與網站相同），不可放有人名、電話、人臉的照片。
window.DUTY_IMAGES = [
  {
    match: '12人小組',
    images: [
      { src: 'img/duty/twelve-security-duties.jpg', caption: '母殿區值勤事項（起床、門禁鏈子、早課、天窗）' },
      { src: 'img/duty/twelve-incense-sop.jpg', caption: '拜香 SOP（拜香時間、燈控開關、關門頂門）' },
      { src: 'img/duty/twelve-cleaning-sop.jpg', caption: '清潔 SOP（母殿區及一、二樓廁所）' },
      { src: 'img/duty/twelve-meal-portion.jpg', caption: '前人吃飯量（餐點份量參考）' }
    ]
  },
  {
    match: '重陽節',
    images: [
      { src: 'img/duty/double-ninth-dm.jpg', caption: '重陽活動 DM（活動流程表）' }
    ]
  }
];
