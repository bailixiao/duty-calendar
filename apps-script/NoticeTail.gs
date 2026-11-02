/**
 * 總務佈達「每次都要加在最後的話」（例：母殿報到提醒、聯絡人）：存在後台（Script Properties），
 * 所有登入的總管理者、勤務帳號共用；裡面可能有電話，所以不放進程式，一般 API 也不回傳（2026/11/2）。
 */

var NOTICE_TAIL_KEY = 'NOTICE_TAIL';
var NOTICE_TAIL_MAX = 1000;

/** body = { text? }：沒給 text＝讀；給了就存（只有總管理者、勤務帳號能改）。回傳 { text } */
function adminNoticeTail_(body) {
  var props = PropertiesService.getScriptProperties();
  if (body.text !== undefined) {
    var role = ADMIN_SESSION_.role;
    if (role !== SUPER_ACCOUNT && role !== '勤務') throw new ApiError_('FORBIDDEN', '只有總管理者、' + SITE.categoryLabels['勤務'] + '帳號能改佈達最後的話');
    var text = String(body.text || '').replace(/\r\n/g, '\n').trim();
    if (text.length > NOTICE_TAIL_MAX) throw new ApiError_('BAD_REQUEST', '最多 ' + NOTICE_TAIL_MAX + ' 字');
    props.setProperty(NOTICE_TAIL_KEY, text);
    return { text: text };
  }
  return { text: props.getProperty(NOTICE_TAIL_KEY) || '' };
}
