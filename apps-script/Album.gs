/**
 * 📸 活動相簿（2026/11/23）：活動當天起，任何人都可以上傳照片、貼相簿連結（LINE 相簿、Google 相簿⋯），
 * 家人們的勤務頁和後台都看得到；管理者可以刪。
 *   - 照片本身由 Cloudflare 版存（worker/src/app.js 的 albumUpload：大圖＋縮圖兩個檔案），這裡只記「活動相簿」分頁的一列。
 *   - 一個勤務的一天最多 ALBUM_MAX_PHOTOS 張、ALBUM_MAX_LINKS 個連結。
 *   - 上傳人要填名字（連動成員名單，畫面上顯示）；不存電話。
 */
var ALBUM_MAX_PHOTOS = 60;
var ALBUM_MAX_LINKS = 5;

function albumRows_() {
  return readTable_(SHEETS.ALBUM).filter(function (r) { return r['ID']; });
}
function albumItemOut_(r) {
  return { id: r['ID'], type: r['類型'], date: r['日期'], file: r['檔案代號'] || '', thumb: r['縮圖代號'] || r['檔案代號'] || '',
    url: r['網址'] || '', label: r['說明'] || '', by: r['上傳人'] || '', at: r['建立時間'] || '' };
}

/** 這個勤務的相簿：{ dutyId, dates: { 日期: { photos: [...], links: [...] } }, max } */
function getAlbum_(params) {
  var dutyId = String(params.dutyId || '');
  var dates = {};
  albumRows_().filter(function (r) { return r['勤務ID'] === dutyId; }).forEach(function (r) {
    var d = dates[r['日期']] = dates[r['日期']] || { photos: [], links: [] };
    (r['類型'] === '連結' ? d.links : d.photos).push(albumItemOut_(r));
  });
  return { dutyId: dutyId, dates: dates, maxPhotos: ALBUM_MAX_PHOTOS, maxLinks: ALBUM_MAX_LINKS };
}

/** 檢查勤務、日期（活動的日期裡、今天以前）、名字；回傳整理好的 { duty, date, by } */
function albumCheck_(body) {
  var duty = findById_(readTableCached_(SHEETS.DUTIES), '勤務ID', String(body.dutyId || ''));
  if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個活動');
  var date = String(body.date || '');
  var start = duty['開始日'];
  var end = duty['結束日'] || start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < start || date > end) throw new ApiError_('BAD_REQUEST', '日期不對');
  if (date > todayString_()) throw new ApiError_('BAD_REQUEST', '活動當天起才能放照片');
  var by = normalizeName_(body.by);
  if (!by || by.length > 20) throw new ApiError_('VALIDATION', '請填您的名字（誰放的照片）');
  return { duty: duty, date: date, by: by };
}

/** 加一張照片（worker 先存好檔案）：body = { dutyId, date, by, file, thumb } */
function albumAddPhoto_(body) {
  var c = albumCheck_(body);
  return withSignupLock_(function () {
    var n = albumRows_().filter(function (r) { return r['勤務ID'] === c.duty['勤務ID'] && r['日期'] === c.date && r['類型'] === '照片'; }).length;
    if (n >= ALBUM_MAX_PHOTOS) throw new ApiError_('VALIDATION', '這一天的相簿已經有 ' + ALBUM_MAX_PHOTOS + ' 張了，挑精華的就好；更多照片可以放 LINE 或 Google 相簿，貼連結上來');
    appendRows_(SHEETS.ALBUM, [{ 'ID': newId_('P'), '勤務ID': c.duty['勤務ID'], '日期': c.date, '類型': '照片', '檔案代號': String(body.file), '縮圖代號': String(body.thumb || ''),
      '網址': '', '說明': '', '上傳人': c.by, '建立時間': nowString_() }]);
    invalidateTable_(SHEETS.ALBUM);
    return getAlbum_({ dutyId: c.duty['勤務ID'] });
  });
}

/** 貼相簿連結：body = { dutyId, date, by, url, label } */
function albumAddLink_(body) {
  var c = albumCheck_(body);
  var url = String(body.url || '').trim();
  if (!/^https:\/\/[^\s<>"']{4,300}$/.test(url)) throw new ApiError_('VALIDATION', '請貼完整的相簿網址（https:// 開頭）');
  var label = cleanText_(body.label || '').slice(0, 30);
  return withSignupLock_(function () {
    var list = albumRows_().filter(function (r) { return r['勤務ID'] === c.duty['勤務ID'] && r['日期'] === c.date && r['類型'] === '連結'; });
    if (list.some(function (r) { return r['網址'] === url; })) return getAlbum_({ dutyId: c.duty['勤務ID'] });
    if (list.length >= ALBUM_MAX_LINKS) throw new ApiError_('VALIDATION', '這一天已經有 ' + ALBUM_MAX_LINKS + ' 個相簿連結了');
    appendRows_(SHEETS.ALBUM, [{ 'ID': newId_('P'), '勤務ID': c.duty['勤務ID'], '日期': c.date, '類型': '連結', '檔案代號': '', '縮圖代號': '',
      '網址': url, '說明': label, '上傳人': c.by, '建立時間': nowString_() }]);
    invalidateTable_(SHEETS.ALBUM);
    return getAlbum_({ dutyId: c.duty['勤務ID'] });
  });
}

/**
 * 管理者刪照片或連結（不是唯讀；勤務／道務／教育帳號只能刪自己類別的）：body = { id }。
 * 回傳 { album, files: [要刪的檔案代號] }，檔案由 worker 刪。
 */
function adminAlbumDelete_(body) {
  var role = ADMIN_SESSION_ ? ADMIN_SESSION_.role : '';
  if (role === '唯讀' || role === '場管') throw new ApiError_('FORBIDDEN', '這個帳號沒有權限刪照片');
  return withSignupLock_(function () {
    var row = albumRows_().filter(function (r) { return r['ID'] === String(body.id || ''); })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這張照片，可能已經刪掉了');
    var duty = findById_(readTableCached_(SHEETS.DUTIES), '勤務ID', row['勤務ID']);
    if (duty && role !== SUPER_ACCOUNT && dutyCategory_(duty) !== role) throw new ApiError_('FORBIDDEN', '這是「' + dutyCategory_(duty) + '」的活動，這個帳號不能刪');
    deleteRows_(SHEETS.ALBUM, [row._row]);
    invalidateTable_(SHEETS.ALBUM);
    writeDutyLog_('修改勤務', '活動相簿刪除' + row['類型'] + '｜' + (duty ? duty['名稱'] : row['勤務ID']) + '｜' + row['日期'] + '｜' + row['上傳人'] + '放的');
    return { album: getAlbum_({ dutyId: row['勤務ID'] }), files: [row['檔案代號'], row['縮圖代號']].filter(Boolean) };
  });
}
