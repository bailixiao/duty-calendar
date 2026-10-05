/**
 * 常見問題與教學（2026/10/6）：家人們的「❓ 常見問題」（#/help）與後台「📖 教學」。
 *   - 資料在「常見問題」分頁；分頁還沒有資料時用 FaqSeed.gs 的預設題目，第一次編輯時整批寫入再改。
 *   - 對象：家人們（公開）／管理者（後台，可用「角色」限定哪些帳號看得到，空白＝全部後台帳號）。
 *   - 只有總管理者能新增、修改、刪除、排序。答案的格式見 js/help.js（步驟、條列、粗體、圖片、連結）。
 */

var FAQ_AUDIENCES = ['家人們', '管理者'];

function faqRowOut_(r) {
  return {
    id: r['問題ID'], audience: r['對象'] || '家人們', category: r['分類'] || '其他', q: r['問題'], a: r['答案'],
    alias: r['別稱'] || '', linkUrl: r['按鈕網址'] || '', linkText: r['按鈕文字'] || '',
    roles: String(r['角色'] || '').split(/[、,，\s]+/).filter(Boolean), order: Number(r['排序']) || 0, enabled: r['啟用'] !== '否'
  };
}

/** 預設題目轉成分頁的列（排序 10、20、30⋯ 方便之後插入） */
function faqSeedRows_() {
  return FAQ_DEFAULTS_.map(function (f, i) {
    return { '問題ID': f.id, '對象': f.audience, '分類': f.category, '問題': f.q, '答案': f.a, '別稱': f.alias || '',
      '按鈕網址': f.linkUrl || '', '按鈕文字': f.linkText || '', '角色': (f.roles || []).join('、'), '排序': String((i + 1) * 10), '啟用': '是', '更新時間': '' };
  });
}

/** 所有題目（分頁沒有資料就用預設題目），依排序 */
function faqAll_() {
  var rows = readTableCached_(SHEETS.FAQ).filter(function (r) { return r['問題ID']; });
  var list = (rows.length ? rows : faqSeedRows_()).map(faqRowOut_);
  return list.sort(function (a, b) { return a.order - b.order; });
}

/** 第一次編輯：把預設題目寫進分頁 */
function ensureFaqSeeded_() {
  if (readTable_(SHEETS.FAQ).some(function (r) { return r['問題ID']; })) return;
  appendRows_(SHEETS.FAQ, faqSeedRows_());
}

/** 公開：家人們看的題目 */
function getFaq_() {
  return { items: faqAll_().filter(function (f) { return f.enabled && f.audience === '家人們'; }) };
}

/** 後台：管理者教學（依角色）；總管理者另外拿到全部題目（編輯用） */
function adminFaq_() {
  var role = ADMIN_SESSION_.role;
  var all = faqAll_();
  var out = {
    items: all.filter(function (f) { return f.enabled && f.audience === '管理者' && (role === SUPER_ACCOUNT || !f.roles.length || f.roles.indexOf(role) !== -1); })
  };
  if (role === SUPER_ACCOUNT) out.all = all;
  return out;
}

/** body = { item: { id?, audience, category, q, a, alias, linkUrl, linkText, roles, enabled } }：新增或修改（總管理者） */
function adminFaqSave_(body) {
  var it = body.item || {};
  var errors = [];
  var audience = FAQ_AUDIENCES.indexOf(it.audience) !== -1 ? it.audience : '';
  var q = cleanText_(it.q).slice(0, 100);
  var a = String(it.a || '').replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '').slice(0, 6000);
  var linkUrl = cleanText_(it.linkUrl);
  if (!audience) errors.push('請選給誰看');
  if (!cleanText_(it.category)) errors.push('請填分類');
  if (!q) errors.push('請填問題');
  if (!a) errors.push('請填答案');
  if (linkUrl && !/^(#\/|https:\/\/)/.test(linkUrl)) errors.push('按鈕網址要用 #/ 或 https:// 開頭');
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存起來', errors.map(function (m) { return { message: m }; }));
  var roles = (Array.isArray(it.roles) ? it.roles : []).filter(function (r) { return ROLES.indexOf(r) !== -1; });
  return withSignupLock_(function () {
    ensureFaqSeeded_();
    var rows = readTable_(SHEETS.FAQ).filter(function (r) { return r['問題ID']; });
    var fields = { '對象': audience, '分類': cleanText_(it.category).slice(0, 20), '問題': q, '答案': a, '別稱': cleanText_(it.alias).slice(0, 200),
      '按鈕網址': linkUrl, '按鈕文字': cleanText_(it.linkText).slice(0, 30), '角色': audience === '管理者' ? roles.join('、') : '',
      '啟用': it.enabled === false ? '否' : '是', '更新時間': nowString_() };
    if (it.id) {
      var row = rows.filter(function (r) { return r['問題ID'] === it.id; })[0];
      if (!row) throw new ApiError_('NOT_FOUND', '找不到這一題，請重新整理');
      updateRow_(SHEETS.FAQ, row, fields);
    } else {
      var max = rows.reduce(function (m, r) { return Math.max(m, Number(r['排序']) || 0); }, 0);
      appendRows_(SHEETS.FAQ, [Object.assign({ '問題ID': newId_('Q'), '排序': String(max + 10) }, fields)]);
    }
    invalidateTable_(SHEETS.FAQ);
    return adminFaq_();
  });
}

/** body = { id }：刪除一題 */
function adminFaqDelete_(body) {
  return withSignupLock_(function () {
    ensureFaqSeeded_();
    var row = readTable_(SHEETS.FAQ).filter(function (r) { return r['問題ID'] && r['問題ID'] === body.id; })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這一題，請重新整理');
    deleteRows_(SHEETS.FAQ, [row._row]);
    invalidateTable_(SHEETS.FAQ);
    return adminFaq_();
  });
}

/** body = { id, dir: -1 | 1 }：在同對象、同分類裡往上或往下移一格 */
function adminFaqMove_(body) {
  var dir = Number(body.dir) < 0 ? -1 : 1;
  return withSignupLock_(function () {
    ensureFaqSeeded_();
    var rows = readTable_(SHEETS.FAQ).filter(function (r) { return r['問題ID']; })
      .sort(function (a, b) { return (Number(a['排序']) || 0) - (Number(b['排序']) || 0); });
    var row = rows.filter(function (r) { return r['問題ID'] === body.id; })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這一題，請重新整理');
    var group = rows.filter(function (r) { return r['對象'] === row['對象'] && r['分類'] === row['分類']; });
    var i = group.indexOf(row);
    var other = group[i + dir];
    if (other) {
      var a = row['排序'];
      updateRow_(SHEETS.FAQ, row, { '排序': other['排序'] });
      updateRow_(SHEETS.FAQ, other, { '排序': a });
    }
    invalidateTable_(SHEETS.FAQ);
    return adminFaq_();
  });
}
