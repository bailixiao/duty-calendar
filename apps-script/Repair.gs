/**
 * 區中心修繕回報（2026/10/6）：家人們在借場地頁回報（文字＋照片），總管理者、場管在後台處理。
 *   - 公開的「目前已知的問題」只有位置、問題、狀態、日期；回報人、電話、照片只在後台。
 *   - 有人回報時通知開啟場地申請通知的手機；狀態變處理中、已修好時通知回報人（有允許通知的話）。
 *   - 照片由 Cloudflare 版的 repairUpload 先上傳（worker/src/app.js），這裡只存檔案代號。
 */

var REPAIR_LOCATIONS = ['大殿', '教室', '廁所（乾）', '廁所（坤）', '廚房', '冷氣', '燈光', '桌椅', '音響投影', '門窗', '水電', '其他'];
var REPAIR_URGENCY = ['一般', '盡快', '有危險'];
var REPAIR_STATUS = ['待處理', '處理中', '已修好'];

function repairRows_() {
  return readTable_(SHEETS.REPAIRS).filter(function (r) { return r['修繕ID']; });
}

/** 排序：沒修好的在前（有危險→盡快→一般），同一級新的在前；修好的照完成時間新到舊 */
function repairSort_(a, b) {
  var done = function (r) { return r['狀態'] === '已修好' ? 1 : 0; };
  if (done(a) !== done(b)) return done(a) - done(b);
  if (!done(a)) {
    var u = REPAIR_URGENCY.indexOf(b['急迫']) - REPAIR_URGENCY.indexOf(a['急迫']);
    if (u) return u;
    return String(b['建立時間']).localeCompare(String(a['建立時間']));
  }
  return String(b['完成時間']).localeCompare(String(a['完成時間']));
}

/** 公開：還沒修好的＋7 天內修好的（不含回報人、電話、照片） */
function getRepairs_() {
  var weekAgo = addDaysStr_(todayString_(), -7);
  return {
    locations: REPAIR_LOCATIONS,
    items: repairRows_().filter(function (r) { return r['狀態'] !== '已修好' || String(r['完成時間']).slice(0, 10) >= weekAgo; })
      .sort(repairSort_)
      .map(function (r) {
        return { id: r['修繕ID'], location: r['位置'], detail: r['位置說明'], problem: r['問題'], urgency: r['急迫'], status: r['狀態'],
          date: String(r['建立時間']).slice(0, 10), doneAt: String(r['完成時間'] || '').slice(0, 10) };
      })
  };
}

/** body = { location, detail, problem, urgency, name, phone, photos: [檔案代號] }：回報 */
function reportRepair_(body) {
  var location = cleanText_(body.location);
  var detail = cleanText_(body.detail).slice(0, 40);
  var problem = String(body.problem || '').replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '').slice(0, 500);
  var urgency = REPAIR_URGENCY.indexOf(body.urgency) !== -1 ? body.urgency : '一般';
  var name = normalizeName_(body.name);
  var phone = cleanText_(body.phone).replace(/[^\d+\-() ]/g, '');
  var photos = (Array.isArray(body.photos) ? body.photos : []).filter(function (id) { return /^F-[\w-]{6,40}$/.test(String(id)); }).slice(0, 3);
  var errors = [];
  if (location && REPAIR_LOCATIONS.indexOf(location) === -1) location = ''; // 2026/10/8 起不用選位置（舊的前端還會送）
  if (problem.length < 2) errors.push('請寫一下是什麼問題');
  if (!name) errors.push('請填姓名');
  if (phone.replace(/\D/g, '').length < 8) errors.push('請填聯絡電話（管理者有問題時會打給您）');
  if (errors.length) throw new ApiError_('VALIDATION', '回報沒有送出，請看下面的說明', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var id = newId_('R');
    var now = nowString_();
    appendRows_(SHEETS.REPAIRS, [{ '修繕ID': id, '位置': location, '位置說明': detail, '問題': problem, '急迫': urgency, '姓名': name, '電話': phone,
      '照片': photos.join(','), '狀態': '待處理', '處理說明': '', '廠商': '', '費用': '', '建立時間': now, '更新時間': now, '處理人': '', '完成時間': '' }]);
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '修繕回報', '報名ID': '', '內容摘要': name + '｜' + location + (detail ? '（' + detail + '）' : '') + '｜' + urgency + '｜' + problem.slice(0, 60), '還原用的前一版資料': '' }]);
    notifyVenueAdmins_((urgency === '有危險' ? '⚠️ ' : '') + '🔧 有人回報' + SITE.venue + '要修繕', location + (detail ? '（' + detail + '）' : '') + '｜' + urgency + '\n' + problem.slice(0, 80) + '\n請到後台「場地借用」看看 🙏');
    SpreadsheetApp.flush();
    return { id: id };
  });
}

/** body = { endpoint, id }：回報人允許通知，處理進度送到這支手機 */
function repairWatch_(body) {
  var id = cleanText_(body.id);
  if (!id || !repairRows_().some(function (r) { return r['修繕ID'] === id; })) throw new ApiError_('NOT_FOUND', '找不到這筆回報');
  return withSignupLock_(function () {
    addPushTarget_(body.endpoint, '修繕回報', id);
    return { ok: true };
  });
}

function repairOut_(r) {
  return { id: r['修繕ID'], location: r['位置'], detail: r['位置說明'], problem: r['問題'], urgency: r['急迫'], name: r['姓名'], phone: r['電話'],
    photos: String(r['照片'] || '').split(',').filter(Boolean), status: r['狀態'], note: r['處理說明'], vendor: r['廠商'], cost: r['費用'],
    createdAt: r['建立時間'], updatedAt: r['更新時間'], by: r['處理人'], doneAt: r['完成時間'] };
}

/** 後台：還沒修好的全部＋90 天內修好的；另外回傳這段期間的費用合計 */
function adminRepairs_() {
  var since = addDaysStr_(todayString_(), -90);
  var rows = repairRows_().filter(function (r) { return r['狀態'] !== '已修好' || String(r['完成時間']).slice(0, 10) >= since; }).sort(repairSort_);
  var cost = rows.reduce(function (n, r) { return n + (Number(r['費用']) || 0); }, 0);
  return { today: todayString_(), locations: REPAIR_LOCATIONS, items: rows.map(repairOut_), costTotal: cost };
}

/** body = { id, status, note, vendor, cost }：更新處理進度（總管理者、場管） */
function adminRepairUpdate_(body) {
  var role = ADMIN_SESSION_.role;
  if (role !== SUPER_ACCOUNT && role !== '場管') throw new ApiError_('FORBIDDEN', '只有總管理者、場管能處理修繕');
  var status = REPAIR_STATUS.indexOf(body.status) !== -1 ? body.status : '';
  if (!status) throw new ApiError_('BAD_REQUEST', '狀態不對');
  var costText = cleanText_(body.cost).replace(/[,，\s元]/g, '');
  if (costText && !/^\d{1,7}$/.test(costText)) throw new ApiError_('VALIDATION', '費用請填數字（元）');
  return withSignupLock_(function () {
    var row = repairRows_().filter(function (r) { return r['修繕ID'] === body.id; })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這筆回報，請重新整理');
    var now = nowString_();
    var who = role === SUPER_ACCOUNT ? '總管理者' : ADMIN_SESSION_.account;
    var before = row['狀態'];
    var note = cleanText_(body.note).slice(0, 200);
    updateRow_(SHEETS.REPAIRS, row, { '狀態': status, '處理說明': note, '廠商': cleanText_(body.vendor).slice(0, 40), '費用': costText,
      '更新時間': now, '處理人': who, '完成時間': status === '已修好' ? (row['完成時間'] || now) : '' });
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '修繕處理', '報名ID': '', '內容摘要': who + '｜' + row['位置'] + '｜' + row['問題'].slice(0, 30) + '｜' + before + ' → ' + status + (costText ? '｜' + costText + ' 元' : ''), '還原用的前一版資料': '' }]);
    if (status !== before && (status === '處理中' || status === '已修好')) {
      var targets = pushTargets_('修繕回報', row['修繕ID']);
      var where = row['位置'] + (row['位置說明'] ? '（' + row['位置說明'] + '）' : '');
      pushMessageTo_(targets, '🔧 ' + SITE.venue + '修繕進度', status === '已修好'
        ? '✅ 您回報的「' + where + '」已經修好了，感恩您告訴我們 🙏' + (note ? '\n' + note : '')
        : '🛠️ 您回報的「' + where + '」正在處理中' + (note ? '：' + note : '') + '，謝謝您的耐心 🙏', '#/venue');
    }
    SpreadsheetApp.flush();
    return adminRepairs_();
  });
}
