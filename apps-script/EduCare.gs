/**
 * 教育組的關心名單（2026/11/23）：名單本身由前端依成員的生日、學齡算（js/edu-care.js：大考升學、生日、升班銜接），
 * 這裡只存「誰已經關心過了」（大考日期不記，2026/11/23 改：國三、高三整年都列）。
 *   指令碼屬性 EDU_CARE        ＝ { 關心代號（名字|原因|學年）: { at, by, note } }（只留一年）
 * 按「已關心」時，一句紀錄也加到那位成員的「成全紀錄」最前面（最多 300 字，舊的從後面剪掉）。
 */
var EDU_CARE_PROP = 'EDU_CARE';
var EDU_CARE_ROLES = ['總管理者', '教育', '道務']; // 總管理者＝SUPER_ACCOUNT（檔案載入順序不一定，這裡直接寫）

function eduCareRead_(prop) {
  try { var o = JSON.parse(PropertiesService.getScriptProperties().getProperty(prop) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
function eduCareCanEdit_() {
  if (!ADMIN_SESSION_ || EDU_CARE_ROLES.indexOf(ADMIN_SESSION_.role) === -1) throw new ApiError_('FORBIDDEN', '關心名單只有總管理者、教育、道務帳號能記錄');
}

/** 關心紀錄 */
function adminEduCareList_() {
  return { care: eduCareRead_(EDU_CARE_PROP), today: todayString_(),
    canEdit: !!ADMIN_SESSION_ && EDU_CARE_ROLES.indexOf(ADMIN_SESSION_.role) !== -1 };
}

/**
 * 按「已關心」（或取消）：body = { key, name, temple, label（原因，例：國中會考）, note, undo }
 */
function adminEduCare_(body) {
  eduCareCanEdit_();
  var key = String(body.key || '').slice(0, 120);
  var name = normalizeName_(body.name);
  if (!key || !name) throw new ApiError_('BAD_REQUEST', '缺少要記錄的人');
  var note = String(body.note || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
  return withSignupLock_(function () {
    var care = eduCareRead_(EDU_CARE_PROP);
    var today = todayString_();
    // 一年前的拿掉，屬性不會一直變大
    var cut = addDaysStr_(today, -400);
    Object.keys(care).forEach(function (k) { if (String(care[k].at || '').slice(0, 10) < cut) delete care[k]; });
    var who = ADMIN_SESSION_.account || ADMIN_SESSION_.role;
    if (body.undo) delete care[key];
    else care[key] = { at: nowString_(), by: who, note: note };
    PropertiesService.getScriptProperties().setProperty(EDU_CARE_PROP, JSON.stringify(care));
    if (!body.undo) {
      // 加到成員的成全紀錄（同名用佛堂分；找不到就只記關心名單）
      var temple = cleanText_(body.temple || '');
      var rows = readTable_(SHEETS.MEMBERS).filter(function (m) { return normalizeName_(m['姓名']) === name && (!temple || !m['佛堂'] || m['佛堂'] === temple); });
      if (rows.length === 1) {
        var line = today.slice(5).replace('-', '/').replace(/^0/, '') + ' ' + String(body.label || '關心').slice(0, 20) + (note ? '：' + note : '') + '（' + who + '）';
        var next = (line + (rows[0]['成全紀錄'] ? '；' + rows[0]['成全紀錄'] : '')).slice(0, 300);
        updateRow_(SHEETS.MEMBERS, rows[0], { '成全紀錄': next });
        invalidateTable_(SHEETS.MEMBERS);
      }
    }
    writeDutyLog_('成員', '教育組關心名單｜' + name + '｜' + String(body.label || '') + (body.undo ? '｜取消已關心' : '｜已關心' + (note ? '：' + note : '')));
    return adminEduCareList_();
  });
}
