/**
 * 教育組的關心名單（2026/11/23）：名單本身由前端依成員的生日、學齡算（js/edu-care.js：大考升學、生日、升班銜接），
 * 這裡只存「誰已經關心過了」（大考日期不記，2026/11/23 改：國三、高三整年都列）。
 *   指令碼屬性 EDU_CARE        ＝ { 關心代號（名字|原因|學年）: { at, by, note, name } }（只留一年）
 * 2026/11/24：統計的「💛 關懷名單」（久沒來的人，代號 名字|away|最後出席日）也記在這裡；勤務帳號也可以記。
 *   同一個人的每一筆（不同原因、不同時間）合起來就是他的關心紀錄（前端 EduCare.historyOf）。
 * 按「已關心」時，一句紀錄也加到那位成員的「成全紀錄」最前面（最多 300 字，舊的從後面剪掉）。
 */
var EDU_CARE_PROP = 'EDU_CARE';
var EDU_CLAIM_PROP = 'EDU_CARE_CLAIM'; // 2026/11/24 認領：{ 關心代號: { who（負責的人，成員名單上的名字）, at, by（哪個帳號按的） } }（只留 60 天）
var EDU_CARE_ROLES = ['總管理者', '勤務', '教育', '道務']; // 總管理者＝SUPER_ACCOUNT（檔案載入順序不一定，這裡直接寫）

function eduCareRead_(prop) {
  try { var o = JSON.parse(PropertiesService.getScriptProperties().getProperty(prop) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
function eduCareCanEdit_() {
  if (!ADMIN_SESSION_ || EDU_CARE_ROLES.indexOf(ADMIN_SESSION_.role) === -1) throw new ApiError_('FORBIDDEN', '關心紀錄只有總管理者、勤務、道務、教育帳號能記');
}

/** 關心紀錄 */
function adminEduCareList_() {
  return { care: eduCareRead_(EDU_CARE_PROP), claims: eduCareRead_(EDU_CLAIM_PROP), today: todayString_(),
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
    else care[key] = { at: nowString_(), by: who, note: note, name: name };
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

/**
 * 「🙋 我來關心」認領（2026/11/24）：按「已關心」之前先寫誰負責，組員分工不重複。
 * body = { key, name, who（負責的人）, undo }。已關心以後認領就沒用了，前端不再顯示。
 */
function adminEduCareClaim_(body) {
  eduCareCanEdit_();
  var key = String(body.key || '').slice(0, 120);
  var name = normalizeName_(body.name);
  var who = normalizeName_(body.who || '').slice(0, 20);
  if (!key || !name) throw new ApiError_('BAD_REQUEST', '缺少要關心的人');
  if (!body.undo && !who) throw new ApiError_('BAD_REQUEST', '請填誰負責關心');
  return withSignupLock_(function () {
    var claims = eduCareRead_(EDU_CLAIM_PROP);
    var cut = addDaysStr_(todayString_(), -60);
    Object.keys(claims).forEach(function (k) { if (String(claims[k].at || '').slice(0, 10) < cut) delete claims[k]; });
    if (body.undo) delete claims[key];
    else claims[key] = { who: who, at: nowString_(), by: ADMIN_SESSION_.account || ADMIN_SESSION_.role, name: name };
    PropertiesService.getScriptProperties().setProperty(EDU_CLAIM_PROP, JSON.stringify(claims));
    writeDutyLog_('成員', '關心名單｜' + name + (body.undo ? '｜取消認領' : '｜' + who + ' 負責關心'));
    return adminEduCareList_();
  });
}
