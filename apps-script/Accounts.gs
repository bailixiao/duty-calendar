/**
 * 管理後台的帳號與權限（規格第 2、8 節）。
 *   角色：總管理者（全部，含帳號管理）、勤務／道務／教育（只管自己類別的勤務）、唯讀（全部都能看、都不能改）。
 *   - 總管理者沿用原本的管理密碼（Script Properties 的 ADMIN_PASSWORD），帳號欄可留空或填「總管理者」。
 *   - 其他帳號存在「帳號」分頁：密碼只存加密後的雜湊與鹽，不存原文；此分頁不會同步到 Google 試算表。
 *   - 權限一律由伺服器檢查（adminAuthorize_），畫面只是把用不到的按鈕藏起來。
 *   - 每個帳號各自只能一台裝置登入。
 */

var ROLES = ['總管理者', '勤務', '道務', '教育', '唯讀', '場管']; // 場管＝區中心場管：只審核場地借用
var CATEGORIES = ['勤務', '道務', '教育'];
var SUPER_ACCOUNT = '總管理者';
var PASSWORD_MIN = 6;

/** 目前這次請求的登入者（{ account, role }）；操作紀錄記下是誰做的 */
var ADMIN_SESSION_ = null;

function hashPassword_(password, salt) {
  var h = String(salt) + '|' + String(password);
  for (var i = 0; i < 500; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  }
  return h;
}

function dutyCategory_(duty) {
  var c = duty && duty['類別'];
  return CATEGORIES.indexOf(c) !== -1 ? c : '勤務';
}

function accountRows_() {
  return readTable_(SHEETS.ACCOUNTS);
}

/** 操作紀錄後面加的註記：總管理者「（管理者）」，其他帳號「（帳號名稱）」 */
function adminTag_() {
  if (!ADMIN_SESSION_ || ADMIN_SESSION_.role === SUPER_ACCOUNT) return '（管理者）';
  return '（' + ADMIN_SESSION_.account + '）';
}

/** 登入：回傳 { account, role } 或丟出錯誤（連錯 10 次鎖 10 分鐘） */
function checkLogin_(account, password) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('admin-fails') || 0);
  if (fails >= ADMIN_MAX_FAILS) throw new ApiError_('LOCKED', '密碼錯誤太多次，請 10 分鐘後再試');
  var name = String(account || '').trim();
  var ok = null;
  if (!name || name === SUPER_ACCOUNT) {
    var pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
    if (!pw) throw new ApiError_('CONFIG', '尚未設定管理密碼，請依部署說明在「指令碼屬性」設定 ADMIN_PASSWORD');
    if (String(password || '') === pw) ok = { account: SUPER_ACCOUNT, role: SUPER_ACCOUNT };
  } else {
    var row = accountRows_().filter(function (r) { return r['帳號'] === name && r['啟用'] !== '否'; })[0];
    if (row && hashPassword_(password, row['鹽']) === row['密碼雜湊'] && ROLES.indexOf(row['角色']) !== -1) {
      ok = { account: name, role: row['角色'], row: row };
    }
  }
  if (!ok) {
    cache.put('admin-fails', String(fails + 1), ADMIN_LOCK_SEC);
    throw new ApiError_('UNAUTHORIZED', name && name !== SUPER_ACCOUNT ? '帳號或密碼不正確' : '密碼不正確');
  }
  cache.remove('admin-fails');
  if (ok.row) updateRow_(SHEETS.ACCOUNTS, ok.row, { '最後登入': nowString_() });
  return { account: ok.account, role: ok.role };
}

function currentTokenKey_(account) {
  return account === SUPER_ACCOUNT ? 'ADMIN_CURRENT_TOKEN' : 'ADMIN_CURRENT_TOKEN:' + account;
}

// ---------- 權限 ----------

// 所有角色都能用的讀取
var ADMIN_READ_ACTIONS = ['adminPing', 'adminLogout', 'adminMe', 'adminRecent', 'adminDuty', 'adminLogs', 'adminDay', 'adminRoster',
  'adminDutyList', 'adminDutyForEdit', 'adminStats', 'adminMembers', 'adminGroups', 'adminGoals', 'adminVenue', 'adminPushList', 'adminFaq', 'adminRepairs'];
// 依勤務類別判斷的寫入（勤務／道務／教育帳號只能動自己類別）
var ADMIN_CATEGORY_ACTIONS = ['adminCancel', 'adminReschedule', 'adminRestore', 'adminCreateDuties', 'adminUpdateDuty',
  'adminDeleteDuty', 'adminSetAttendance', 'adminAddAttendee', 'adminDraftFromImages', 'adminUpdateStatsSheet', 'adminSetTeachers', 'adminSaveGoals', 'adminVenueDecide', 'adminPushSave', 'adminPushDelete', 'adminAutoPushSave', 'adminRollcallLink', 'adminImportAttendance', 'adminSetMemberExtra', 'adminSplitSignup'];

// 成員、分組的編輯動作，與可以編輯的帳號（總管理者另外全部可以）
var PEOPLE_EDIT_ACTIONS = ['adminSaveMember', 'adminDeleteMember', 'adminMemberCandidates', 'adminAddMembers', 'adminMergeNames', 'adminClearCandidates',
  'adminConfirmMembers', 'adminMergePendingMember', 'adminSaveGroup', 'adminDeleteGroup', 'adminMergeMembers', 'adminImportMembers', 'adminSameNameSignups', 'adminAssignSignupTemple'];
var PEOPLE_EDIT_ROLES = ['道務', '教育'];

function findDutyById_(id) {
  return findById_(readTableCached_(SHEETS.DUTIES), '勤務ID', id) || null;
}

function dutyOfSignup_(signupId) {
  var s = readTable_(SHEETS.SIGNUPS).filter(function (r) { return r['報名ID'] === signupId; })[0];
  return s ? findDutyById_(s['勤務ID']) : null;
}

/** 這個請求會動到的勤務（找不到回傳 null，交給原本的函式回錯誤） */
function targetDuties_(body) {
  switch (body.action) {
    case 'adminCancel': case 'adminReschedule': case 'adminSetAttendance': case 'adminRestore':
      return [dutyOfSignup_(body.signupId)];
    case 'adminAddAttendee':
      return [findDutyById_(body.dutyId)];
    case 'adminUpdateDuty': // 同名勤務一次改：一起改的那些也要檢查
      return [findDutyById_(body.id)].concat((body.alsoIds || []).map(findDutyById_));
    case 'adminSetTeachers':
      return (body.items || []).map(function (it) { return findDutyById_(it.id); });
    case 'adminDeleteDuty': // 同名一起刪：一起刪的那些也要檢查
      return [findDutyById_(body.id)].concat((body.alsoIds || []).map(findDutyById_));
    case 'adminRollcallLink':
      return [findDutyById_(body.dutyId)];
    case 'adminImportAttendance': // 新增的場次在 adminImportAttendance_ 裡固定成帳號的類別
      return (body.sessions || []).filter(function (s) { return s && s.dutyId; }).map(function (s) { return findDutyById_(s.dutyId); });
    case 'adminDuty': case 'adminDutyForEdit':
      return [findDutyById_(body.id)];
    default:
      return [];
  }
}

/** 檢查權限；勤務／道務／教育帳號新增、修改勤務時，類別固定成自己的類別 */
function adminAuthorize_(session, body) {
  var role = session.role;
  var action = body.action;
  if (role === SUPER_ACCOUNT) return;
  var denied = function () { throw new ApiError_('FORBIDDEN', '這個帳號沒有權限做這件事'); };
  // 區中心場管：只看、只審核場地借用
  if (role === '場管') {
    if (['adminPing', 'adminLogout', 'adminMe', 'adminVenue', 'adminVenueDecide', 'adminVenueWatch', 'adminFaq', 'adminRepairs', 'adminRepairUpdate'].indexOf(action) === -1) denied();
    return;
  }
  // 唯讀不看操作紀錄、名單（有個資與聯絡細節）、勤務管理
  if (role === '唯讀' && ['adminLogs', 'adminDay', 'adminRoster', 'adminDutyList', 'adminDutyForEdit'].indexOf(action) !== -1) denied();
  // 操作紀錄、舊的單日名單只給總管理者（「名單」分頁的 adminRoster 勤務／道務／教育帳號也能用，只看自己類別）
  if (['adminLogs', 'adminDay'].indexOf(action) !== -1) denied();
  // 各佛堂道務目標：總管理者、道務、唯讀看得到；只有總管理者、道務能改
  if (action === 'adminGoals' && (role === '勤務' || role === '教育')) denied();
  if (action === 'adminSaveGoals' && role !== '道務') denied();
  // 場地借用：總管理者、場管審核；其他帳號只能看
  if (action === 'adminVenueDecide' || action === 'adminVenueWatch' || action === 'adminRepairUpdate') denied();
  // 後台推播：總管理者、勤務、道務、教育（類別帳號只看、只改自己類別，在 PushMore.gs 檢查）
  if (/^adminPush/.test(action) && PUSH_PLAN_ROLES.indexOf(role) === -1) denied();
  if (ADMIN_READ_ACTIONS.indexOf(action) !== -1) {
    if (CATEGORIES.indexOf(role) !== -1 && (action === 'adminDuty' || action === 'adminDutyForEdit')) {
      var d = targetDuties_(body)[0];
      if (d && dutyCategory_(d) !== role) throw new ApiError_('FORBIDDEN', '這是「' + dutyCategory_(d) + '」的勤務，這個帳號不能查看');
    }
    return;
  }
  // 成員、分組：總管理者、道務、教育帳號可以編輯（2026/10/6）
  if (PEOPLE_EDIT_ACTIONS.indexOf(action) !== -1) {
    if (PEOPLE_EDIT_ROLES.indexOf(role) !== -1) return;
    denied();
  }
  if (role === '唯讀' || CATEGORIES.indexOf(role) === -1) denied();
  if (ADMIN_CATEGORY_ACTIONS.indexOf(action) === -1) denied(); // 匯入歷史、帳號：只有總管理者
  targetDuties_(body).forEach(function (d) {
    if (d && dutyCategory_(d) !== role) throw new ApiError_('FORBIDDEN', '這是「' + dutyCategory_(d) + '」的勤務，這個帳號不能修改');
  });
  if (action === 'adminCreateDuties') (body.duties || []).forEach(function (d) { if (d) d.category = role; });
  if (action === 'adminUpdateDuty' && body.duty) body.duty.category = role;
}

/** 讀取結果依帳號類別過濾（勤務／道務／教育帳號只看到自己類別） */
function adminScope_(session, action, result) {
  var role = session.role;
  if (CATEGORIES.indexOf(role) === -1 || !result) return result;
  var mine = function (d) { return (d.category || '勤務') === role; };
  if ((action === 'adminRecent' || action === 'adminDutyList' || action === 'adminDay') && Array.isArray(result.duties)) {
    result.duties = result.duties.filter(mine);
  }
  if (action === 'adminRoster' && Array.isArray(result.days)) {
    result.days = result.days.map(function (day) { return { date: day.date, duties: day.duties.filter(mine) }; })
      .filter(function (day) { return day.duties.length; });
  }
  if (action === 'adminStats' && Array.isArray(result.events)) result.events = result.events.filter(mine);
  if (action === 'adminStats' && Array.isArray(result.eduSessions)) result.eduSessions = result.eduSessions.filter(mine);
  if (action === 'adminDutyForEdit' && Array.isArray(result.siblings)) result.siblings = result.siblings.filter(mine);
  return result;
}

/** 帳號依角色排序：勤務、道務、教育、唯讀；同角色照建立順序 */
function sortedAccountRows_() {
  return accountRows_().filter(function (r) { return r['帳號']; })
    .map(function (r, i) { return { r: r, i: i }; })
    .sort(function (a, b) { return (ROLES.indexOf(a.r['角色']) - ROLES.indexOf(b.r['角色'])) || (a.i - b.i); })
    .map(function (x) { return x.r; });
}

/** 登入畫面的帳號下拉選單：總管理者＋啟用中的帳號名稱（不含角色、密碼） */
function loginAccounts_() {
  return {
    accounts: [SUPER_ACCOUNT].concat(sortedAccountRows_().filter(function (r) { return r['啟用'] !== '否'; })
      .map(function (r) { return r['帳號']; }))
  };
}

// ---------- 帳號管理（只有總管理者） ----------

function accountToJson_(r) {
  return { account: r['帳號'], name: r['名稱'], role: r['角色'], active: r['啟用'] !== '否', createdAt: r['建立時間'], lastLogin: r['最後登入'] };
}

function adminAccounts_() {
  return { accounts: sortedAccountRows_().map(accountToJson_), roles: ROLES.slice(1) };
}

/** body.account = { account, name, role, active, password（新帳號必填；舊帳號留空表示不改）, original（修改時原本的帳號） } */
function adminSaveAccount_(body) {
  var a = body.account || {};
  var account = String(a.account || '').trim();
  var errors = [];
  if (!account) errors.push('請填帳號');
  if (account === SUPER_ACCOUNT) errors.push('「總管理者」是保留的名稱，請換一個');
  if (account && !/^[^\s]{2,20}$/.test(account)) errors.push('帳號要 2～20 個字，不能有空白');
  if (ROLES.indexOf(a.role) <= 0) errors.push('請選角色（勤務、道務、教育、唯讀或場管）');
  var password = String(a.password || '');
  if (password && password.length < PASSWORD_MIN) errors.push('密碼至少 ' + PASSWORD_MIN + ' 個字');
  return withSignupLock_(function () {
    var rows = accountRows_();
    var original = String(a.original || '');
    var row = original ? rows.filter(function (r) { return r['帳號'] === original; })[0] : null;
    if (original && !row) errors.push('找不到原本的帳號，請重新整理');
    if (!original && !password) errors.push('新帳號要設定密碼');
    if (rows.some(function (r) { return r['帳號'] === account && r !== row; })) errors.push('「' + account + '」這個帳號已經有了');
    if (errors.length) throw new ApiError_('VALIDATION', errors.join('；'));
    var changes = { '帳號': account, '名稱': String(a.name || '').trim(), '角色': a.role, '啟用': a.active === false ? '否' : '是' };
    if (password) {
      var salt = Utilities.getUuid().replace(/-/g, '');
      changes['鹽'] = salt;
      changes['密碼雜湊'] = hashPassword_(password, salt);
    }
    if (row) updateRow_(SHEETS.ACCOUNTS, row, changes);
    else appendRows_(SHEETS.ACCOUNTS, [Object.assign({ '建立時間': nowString_(), '最後登入': '' }, changes)]);
    // 改了密碼、停用、改名或改角色：讓那個帳號現有的登入失效，重新登入
    if (row && (password || changes['啟用'] === '否' || original !== account || row['角色'] !== a.role)) {
      PropertiesService.getScriptProperties().setProperty(currentTokenKey_(original), 'revoked-' + Utilities.getUuid());
    }
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.ACCOUNTS);
    return adminAccounts_();
  });
}
