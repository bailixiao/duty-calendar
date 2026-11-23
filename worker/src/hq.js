// 宏教分壇分派（2026/11/22）：分壇這一邊（Durable Object「hq」）。
// 分壇的總管理者開「分派」→ 送給選的區（各區的 apps-script/Hq.gs hqDeliver_ 收進「📥 分壇分派」）
// → 各區組長看過、放到自己的行事曆或寫原因不參加 → 分壇的總表問每一區（hqReport_）：狀態、名額、報名人數與名字。
// 分派存在分壇的指令碼屬性 HQ_CAMPAIGNS（JSON 陣列）。各區之間用 Durable Object 互相呼叫（opts.cross）。
import { REGIONS } from './regions.js';
import { geminiGenerate } from './async-actions.js';

export const HQ_CODE = 'hq';
/** 分派可以送的區：教全區（main）＋ 12 區（不含分壇自己） */
export const TARGETS = [['main', '教全區']].concat(Object.entries(REGIONS).filter(([code]) => code !== HQ_CODE));
const TARGET_CODES = TARGETS.map(([c]) => c);
const CATS = ['勤務', '道務', '教育'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HQ_NAME_TEXT = '宏教分壇';
// 上下溝通（2026/11/23）：各區回覆分壇／申請調名額（hqAnswer）、截止前 3 天自動提醒（autoRemind，分壇每天早上 7 點的排程）、分壇公告（HQ_NOTICES）。

export function createHq({ gs, store, cross, openRegions }) {
  const err = (code, msg, details) => new gs.ApiError_(code, msg, details);
  const list = () => { try { const a = JSON.parse(store.getProp('HQ_CAMPAIGNS') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const save = (a) => store.setProp('HQ_CAMPAIGNS', JSON.stringify(a));
  /** read＝只看的功能（清單、總表、整組總覽、統計）：唯讀帳號也可以（2026/11/22） */
  function requireHqAdmin(body, curRegion, read) {
    if (curRegion !== HQ_CODE) throw err('FORBIDDEN', '這是宏教分壇才能用的功能');
    const who = gs.requireAdmin_(body);
    if (who.role === '唯讀') { if (read) return who; throw err('FORBIDDEN', '唯讀帳號只能看，不能修改'); }
    if (['總管理者'].concat(CATS).indexOf(who.role) === -1) throw err('FORBIDDEN', '這個帳號不能用分派（分壇的帳號只有總管理者、總務・勤務、道務、教育、唯讀）');
    return who;
  }
  /** 這個帳號能不能管這一類（總管理者全部；勤務／道務／教育只管自己那一類） */
  const canCat = (who, cat) => who.role === '總管理者' || who.role === '唯讀' || who.role === cat;
  const catName = (cat) => (cat === '勤務' ? '總務・勤務' : cat);
  function guardCat(who, c) {
    if (c && !canCat(who, c.category)) throw err('FORBIDDEN', '這個帳號只能管「' + catName(who.role) + '」的分派，「' + (c.title || '') + '」是「' + catName(c.category) + '」的');
  }
  /** 現在已經開通的區（教全區一直都在） */
  async function openSet() {
    let open = [];
    try { open = await openRegions(); } catch (e) { /* 問不到就當只有教全區 */ }
    return new Set(['main'].concat(open || []));
  }

  /** 檢查、整理分壇填的分派 */
  function clean(c, old, draft) {
    const s = (v, max, label, need) => {
      const t = String(v == null ? '' : v).replace(/\r/g, '').trim();
      if (need && !t) throw err('VALIDATION', '請填「' + label + '」');
      if (t.length > max) throw err('VALIDATION', '「' + label + '」太長了（最多 ' + max + ' 個字）');
      return t;
    };
    const out = {
      id: old ? old.id : 'H-' + gs.todayString_().replace(/-/g, '') + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 6),
      title: s(c.title, 40, '名稱', true),
      category: CATS.indexOf(c.category) !== -1 ? c.category : '',
      nature: s(c.nature, 10, '性質', false),
      start: s(c.start, 10, '日期', true),
      end: s(c.end || c.start, 10, '結束日', false),
      startTime: s(c.startTime, 5, '開始時間', false),
      endTime: s(c.endTime, 5, '結束時間', false),
      location: s(c.location, 40, '地點', false),
      attire: s(c.attire, 40, '服裝', false),
      description: s(c.description, 2000, '說明', false),
      deadline: s(c.deadline, 10, '報名截止日', false),
      quotaMode: ['none', 'assigned', 'self'].indexOf(c.quotaMode) !== -1 ? c.quotaMode : 'none',
      autoRemind: c.autoRemind !== false, // 截止前 3 天自動提醒沒處理、沒報滿的區（2026/11/23）
      positions: [],
      quotas: {},
      regions: []
    };
    if (!out.category) throw err('VALIDATION', '請選類別（總務・勤務／道務／教育）');
    if (!out.nature) out.nature = gs.hqNatures_()[out.category][0];
    const natures = gs.hqNatures_()[out.category] || null;
    if (out.nature && natures && natures.indexOf(out.nature) === -1) throw err('VALIDATION', '「' + out.category + '」的性質只能是' + natures.join('、'));
    if (!DATE.test(out.start)) throw err('VALIDATION', '日期格式不對');
    if (!DATE.test(out.end) || out.end < out.start) throw err('VALIDATION', '結束日不能早於開始日');
    if (out.startTime && !TIME.test(out.startTime)) throw err('VALIDATION', '開始時間請用 08:30 這種寫法');
    if (out.endTime && !TIME.test(out.endTime)) throw err('VALIDATION', '結束時間請用 08:30 這種寫法');
    if (out.deadline && (!DATE.test(out.deadline) || out.deadline > out.end)) throw err('VALIDATION', '報名截止日要在活動結束以前');
    const names = (Array.isArray(c.positions) ? c.positions : String(c.positions || '').split(/[\n、,，]+/))
      .map((p) => String(p && p.name !== undefined ? p.name : p).trim()).filter(Boolean);
    names.forEach((n) => { if (n.length > 20) throw err('VALIDATION', '了愿項目「' + n.slice(0, 10) + '⋯」太長了（最多 20 個字）'); });
    out.positions = names.filter((n, i) => names.indexOf(n) === i).slice(0, 10).map((name) => ({ name }));
    out.regions = (Array.isArray(c.regions) ? c.regions : []).filter((r, i, a) => TARGET_CODES.indexOf(r) !== -1 && a.indexOf(r) === i);
    if (!out.regions.length && !draft) throw err('VALIDATION', '請選要送給哪幾區');
    if (out.quotaMode === 'assigned') {
      out.regions.forEach((r) => {
        const q = String((c.quotas || {})[r] == null ? '' : c.quotas[r]).trim();
        if (q && (!/^\d{1,4}$/.test(q) || Number(q) < 1)) throw err('VALIDATION', '名額請填數字（' + (TARGETS.find(([x]) => x === r) || [r, r])[1] + '）');
        if (q) out.quotas[r] = Number(q);
      });
    }
    return out;
  }

  /** 修改分派時，原本的來源、各區回覆、提醒紀錄留著 */
  function keepExtra(c, old) {
    if (!old) return;
    ['source', 'replies', 'reminded'].forEach((k) => { if (old[k]) c[k] = old[k]; });
  }
  const regionName = (code) => (TARGETS.find(([x]) => x === code) || [code, code])[1];

  /** 給某一區的那一份（名額換成那一區的） */
  const forRegion = (c, r) => ({
    id: c.id, title: c.title, category: c.category, nature: c.nature, start: c.start, end: c.end, startTime: c.startTime, endTime: c.endTime,
    location: c.location, attire: c.attire, description: c.description, deadline: c.deadline, positions: c.positions,
    quotaMode: c.quotaMode, quota: c.quotaMode === 'assigned' ? (c.quotas[r] || '') : '', version: c.version
  });

  /** 送出去（新增、修改都一樣）；不送的區收回。回傳每一區的結果 */
  async function deliver(c, removed) {
    const open = await openSet();
    const result = {};
    await Promise.all(c.regions.map(async (r) => {
      if (!open.has(r)) { result[r] = 'not-open'; return; }
      try { await cross(r, 'hqDeliver', forRegion(c, r)); result[r] = 'ok'; } catch (e) { result[r] = 'error：' + ((e && e.message) || e); }
    }));
    await Promise.all((removed || []).filter((r) => open.has(r)).map(async (r) => {
      try { await cross(r, 'hqWithdraw', c.id); } catch (e) { /* 收不回就算了 */ }
    }));
    return result;
  }

  const special = {};
  /** 分派清單（新的排前面） */
  special.hqList = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion, true);
    const open = await openSet();
    return { role: who.role, campaigns: list().filter((c) => canCat(who, c.category) && !(who.role === '唯讀' && c.status === 'draft')).slice().sort((a, b) => b.start.localeCompare(a.start)), targets: TARGETS.map(([code, name]) => ({ code, name, open: open.has(code) })) };
  };
  /** 新增或修改分派（body.campaign；有 id＝修改），存好馬上送出去 */
  special.hqSave = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const all = list();
    const old = body.campaign && body.campaign.id ? all.find((x) => x.id === body.campaign.id) : null;
    if (body.campaign && body.campaign.id && !old) throw err('NOT_FOUND', '找不到這個分派，可能已經刪掉了');
    // 草稿（2026/11/22，從檔案匯入的先存草稿）：存起來不送；已經送出的不能再變回草稿
    const draft = !!body.draft && (!old || old.status === 'draft');
    guardCat(who, old);
    const c = clean(body.campaign || {}, old, draft);
    guardCat(who, c);
    c.version = (old ? old.version : 0) + 1;
    c.createdAt = old ? old.createdAt : gs.nowString_();
    c.updatedAt = gs.nowString_();
    c.by = who.account || '總管理者';
    c.status = draft ? 'draft' : 'sent';
    keepExtra(c, old);
    const removed = old && old.status !== 'draft' ? old.regions.filter((r) => c.regions.indexOf(r) === -1) : [];
    c.delivery = draft ? {} : await deliver(c, removed);
    const next = old ? all.map((x) => (x.id === c.id ? c : x)) : all.concat([c]);
    save(next);
    return { campaign: c };
  };
  /**
   * 同名草稿一起存／送出（2026/11/22）：body.items＝分派陣列（都要有 id），body.draft＝只存不送。
   * 先全部檢查，有一筆不對就都不存；送出時每一區只叫一次（那一區的好幾筆一起給），所以 30 幾筆也很快。
   */
  special.hqSaveMany = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw err('BAD_REQUEST', '沒有要送出的日期');
    if (items.length > 200) throw err('BAD_REQUEST', '一次最多 200 筆');
    const all = list();
    const errors = [];
    const made = items.map((it, i) => {
      const old = it && it.id ? all.find((x) => x.id === it.id) : null;
      if (it && it.id && !old) { errors.push({ message: '第 ' + (i + 1) + ' 筆找不到，可能已經刪掉了' }); return null; }
      const draft = !!body.draft && (!old || old.status === 'draft');
      try {
        guardCat(who, old);
        const c = clean(it || {}, old, draft);
        guardCat(who, c);
        Object.assign(c, { version: (old ? old.version : 0) + 1, createdAt: old ? old.createdAt : gs.nowString_(), updatedAt: gs.nowString_(), by: who.account || '總管理者', status: draft ? 'draft' : 'sent', delivery: {} });
        keepExtra(c, old);
        return { c, old, removed: old && old.status !== 'draft' ? old.regions.filter((r) => c.regions.indexOf(r) === -1) : [] };
      } catch (e) { errors.push({ message: '第 ' + (i + 1) + ' 筆（' + String((it && it.start) || '') + '）：' + e.message }); return null; }
    });
    if (errors.length) throw err('VALIDATION', '有幾筆資料不對，都沒有送出', errors);
    const send = made.filter((m) => m.c.status === 'sent');
    if (send.length) {
      const open = await openSet();
      const byRegion = {};
      send.forEach((m) => m.c.regions.forEach((r) => {
        if (!open.has(r)) { m.c.delivery[r] = 'not-open'; return; }
        (byRegion[r] = byRegion[r] || []).push(m);
      }));
      await Promise.all(Object.keys(byRegion).map(async (r) => {
        const ms = byRegion[r];
        try {
          const res = await cross(r, 'hqDeliverMany', ms.map((m) => forRegion(m.c, r)));
          ms.forEach((m, i) => { m.c.delivery[r] = (res && res[i]) || 'ok'; });
        } catch (e) { ms.forEach((m) => { m.c.delivery[r] = 'error：' + ((e && e.message) || e); }); }
      }));
      await Promise.all([].concat(...send.map((m) => m.removed.filter((r) => open.has(r)).map((r) => cross(r, 'hqWithdraw', m.c.id).catch(() => {})))));
    }
    const byId = {};
    made.forEach((m) => { byId[m.c.id] = m.c; });
    const next = all.map((x) => byId[x.id] || x).concat(made.filter((m) => !m.old).map((m) => m.c));
    save(next);
    return { saved: made.length, sent: send.length, campaigns: made.map((m) => m.c) };
  };
  /** 刪掉分派：各區收回（已經放上行事曆的留著，組長自己決定） */
  special.hqDelete = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const all = list();
    const c = all.find((x) => x.id === body.id);
    if (!c) throw err('NOT_FOUND', '找不到這個分派');
    guardCat(who, c);
    if (c.status !== 'draft') await deliver({ id: c.id, regions: [] }, c.regions);
    save(all.filter((x) => x.id !== c.id));
    return { deleted: c.id };
  };
  /** 一次刪好幾個草稿（同名草稿整組刪）；已經送出的不在這裡刪 */
  special.hqDeleteDrafts = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const all = list();
    const gone = all.filter((x) => ids.indexOf(x.id) !== -1 && x.status === 'draft' && canCat(who, x.category)).map((x) => x.id);
    save(all.filter((x) => gone.indexOf(x.id) === -1));
    return { deleted: gone.length };
  };
  /** 總表：每一區的狀態、名額、報名人數、名字 */
  special.hqSummary = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion, true);
    const c = list().find((x) => x.id === body.id);
    if (!c) throw err('NOT_FOUND', '找不到這個分派');
    guardCat(who, c);
    const open = await openSet();
    if (c.status === 'draft') return { campaign: c, regions: TARGETS.filter(([r]) => c.regions.indexOf(r) !== -1).map(([code, name]) => ({ code, name, status: 'draft', count: 0, people: [] })) };
    const rows = await Promise.all(TARGETS.filter(([r]) => c.regions.indexOf(r) !== -1).map(async ([code, name]) => {
      if (!open.has(code)) return { code, name, status: 'not-open', count: 0, people: [] };
      try { return Object.assign({ code, name }, await cross(code, 'hqReport', c.id)); } catch (e) { return { code, name, status: 'error', error: (e && e.message) || String(e), count: 0, people: [] }; }
    }));
    return { campaign: c, regions: rows };
  };

  /**
   * 整組總覽（2026/11/22）：同一個活動好幾個日期 × 各區的狀態、名額、人數、名字。body.ids＝分派代號。
   * 每一區只問一次（hqReportMany），回傳 { campaigns, regions: [{code,name,open}], cells: { 分派代號: { 區: 回報 } } }
   */
  special.hqGroupSummary = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion, true);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const cs = list().filter((x) => ids.indexOf(x.id) !== -1 && x.status !== 'draft' && canCat(who, x.category)).sort((a, b) => a.start.localeCompare(b.start));
    if (!cs.length) throw err('NOT_FOUND', '找不到這些分派，可能已經刪掉了');
    return collect(cs, 'hqReportMany');
  };
  /**
   * 分壇統計（2026/11/22）：body = { from, to }（yyyy-MM-dd，看活動日期）。只算送出的、這個帳號看得到的類別。
   * 回傳和整組總覽一樣的格式，但不含名字（只要狀態、名額、人數）；畫面上再依區、類別、活動加總。
   */
  special.hqStats = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion, true);
    const from = DATE.test(String(body.from || '')) ? body.from : '0000-00-00';
    const to = DATE.test(String(body.to || '')) ? body.to : '9999-99-99';
    const cs = list().filter((x) => x.status !== 'draft' && canCat(who, x.category) && x.start >= from && x.start <= to).sort((a, b) => a.start.localeCompare(b.start));
    if (!cs.length) return { campaigns: [], regions: [], cells: {} };
    return collect(cs, 'hqCountMany');
  };
  async function collect(cs, method) {
    const open = await openSet();
    const regions = TARGETS.filter(([r]) => cs.some((c) => c.regions.indexOf(r) !== -1)).map(([code, name]) => ({ code, name, open: open.has(code) }));
    const cells = {};
    cs.forEach((c) => { cells[c.id] = {}; });
    await Promise.all(regions.map(async (g) => {
      const mine = cs.filter((c) => c.regions.indexOf(g.code) !== -1);
      if (!g.open) { mine.forEach((c) => { cells[c.id][g.code] = { status: 'not-open', count: 0, people: [] }; }); return; }
      try {
        const res = await cross(g.code, method, mine.map((c) => c.id));
        mine.forEach((c, i) => { cells[c.id][g.code] = (res && res[i]) || { status: 'none', count: 0, people: [] }; });
      } catch (e) { mine.forEach((c) => { cells[c.id][g.code] = { status: 'error', error: (e && e.message) || String(e), count: 0, people: [] }; }); }
    }));
    return { campaigns: cs, regions, cells };
  }

  /** 從檔案匯入：勾好的活動一次存成草稿。body.items＝分派陣列（同 hqSave 的 campaign） */
  special.hqSaveDrafts = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw err('BAD_REQUEST', '沒有要存的活動');
    if (items.length > 200) throw err('BAD_REQUEST', '一次最多 200 筆');
    const errors = [];
    const made = items.map((it, i) => {
      try {
        const c = clean(it || {}, null, true);
        guardCat(who, c);
        return Object.assign(c, { version: 1, status: 'draft', createdAt: gs.nowString_(), updatedAt: gs.nowString_(), by: who.account || '總管理者', delivery: {}, source: String(it.source || '').slice(0, 60) });
      } catch (e) { errors.push({ message: '第 ' + (i + 1) + ' 筆（' + String((it && it.title) || '') .slice(0, 20) + '）：' + e.message }); return null; }
    });
    if (errors.length) throw err('VALIDATION', '有幾筆資料不對，都沒有存', errors);
    // 同一批的代號不要撞到
    made.forEach((c, i) => { c.id = c.id + String(i).padStart(3, '0'); });
    save(list().concat(made));
    return { saved: made.length };
  };
  /**
   * AI 讀行事曆：body = { images: [{ mime, data(base64) }]（最多 6 張）, text（Word／Excel／PDF 文字）, hint, part }
   * 用教全區的 Gemini 金鑰（分壇自己沒有），回傳 { items: [...] }
   */
  special.hqImportAi = async (body, curRegion) => {
    requireHqAdmin(body, curRegion);
    const images = Array.isArray(body.images) ? body.images : [];
    const text = String(body.text || '').slice(0, 60000);
    if (!images.length && !text.trim()) throw err('BAD_REQUEST', '沒有要讀的內容');
    if (images.length > 6) throw err('BAD_REQUEST', '一次最多 6 頁');
    const parts = [{ text: gs.hqImportPrompt_(gs.cleanText_(body.hint || ''), gs.cleanText_(body.part || '')) }];
    if (text.trim()) parts.push({ text: '以下是檔案的文字：\n' + text });
    images.forEach((img) => {
      const mime = String((img && img.mime) || '');
      const data = String((img && img.data) || '');
      if (!/^image\/(jpeg|png|webp)$/.test(mime) || !data) throw err('BAD_REQUEST', '圖片格式只能是 jpg、png');
      if (data.length > 6000000) throw err('BAD_REQUEST', '有一頁太大了，請稍後再試');
      parts.push({ inline_data: { mime_type: mime, data } });
    });
    let key = null;
    try { key = await cross('main', 'hqAiKey'); } catch (e) { /* 問不到就用自己的 */ }
    const res = await geminiGenerate(gs, parts, key && key.key ? key : null);
    let items;
    try {
      const parsed = JSON.parse(res.text);
      items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [parsed];
    } catch (e) {
      throw err('AI', '這幾頁看不太懂，可以跳過或換清楚一點的檔案再試');
    }
    items = items.filter((x) => x && typeof x === 'object' && x.title).slice(0, 150);
    return { items, model: res.model };
  };

  // =====================================================================
  // 上下溝通（2026/11/23）：各區回覆／申請調名額、截止前提醒、分壇公告
  // =====================================================================

  /** 各區那一邊先驗登入、存在自己的收件匣，再轉給分壇 */
  function regionAdmin(body, curRegion) {
    if (curRegion === HQ_CODE) throw err('FORBIDDEN', '這是各區用的功能');
    return gs.requireAdmin_(body);
  }
  /** 各區：回覆分壇（可以申請調名額）。body = { ids, text, quotaAsk } */
  special.adminHqReply = async (body, curRegion) => {
    const who = regionAdmin(body, curRegion);
    const res = gs.hqAs_(who, () => gs.adminHqReplyLocal_(body));
    try { await cross(HQ_CODE, 'hqReplyIn', { region: curRegion, replies: res.replies }); } catch (e) { throw err('NETWORK', '分壇暫時收不到，請稍後再按一次'); }
    return res.inbox;
  };
  /** 分壇那一邊：收到各區的回覆（記在分派上），通知分壇那一類的管理者 */
  function replyIn(p) {
    const all = list();
    const region = String((p && p.region) || '');
    let first = null;
    ((p && p.replies) || []).forEach((x) => {
      const c = all.find((y) => y.id === x.id);
      if (!c || !x.reply) return;
      c.replies = Object.assign({}, c.replies || {}, { [region]: x.reply });
      if (!first) first = { c, reply: x.reply };
    });
    save(all);
    if (first) {
      const n = ((p && p.replies) || []).length;
      const rp = first.reply;
      gs.hqNotifyAdmins_(first.c.category, '💬 ' + regionName(region) + '回覆分派',
        '「' + first.c.title + '」' + (n > 1 ? n + ' 個日期' : '') + '：' + (rp.quotaAsk ? '想把名額改成 ' + rp.quotaAsk + ' 位' + (rp.text ? '，' : '') : '') + (rp.text || ''), '#/admin');
    }
    return { ok: true };
  }
  /**
   * 分壇回覆各區：body = { ids, region, ok（false＝不同意）, answer }。
   * 同意調名額：名額改好、送給那一區（已放到行事曆的跟著改最多人數）。
   */
  special.hqAnswer = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const region = String(body.region || '');
    if (TARGET_CODES.indexOf(region) === -1) throw err('BAD_REQUEST', '不認得這一區');
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const all = list();
    const cs = all.filter((c) => ids.indexOf(c.id) !== -1 && c.replies && c.replies[region]);
    if (!cs.length) throw err('NOT_FOUND', '找不到這個回覆，可能已經處理過了');
    cs.forEach((c) => guardCat(who, c));
    const state = body.ok === false ? 'no' : 'ok';
    const answer = String(body.answer || '').replace(/\r/g, '').trim().slice(0, 300);
    if (state === 'no' && !answer) throw err('VALIDATION', '不同意的話，請寫一下原因（那一區看得到）');
    const now = gs.nowString_();
    const deliver = [];
    cs.forEach((c) => {
      const rp = c.replies[region];
      if (state === 'ok' && rp.quotaAsk && c.quotaMode === 'assigned') {
        c.quotas = Object.assign({}, c.quotas, { [region]: Number(rp.quotaAsk) });
        c.version += 1;
        c.updatedAt = now;
        deliver.push(forRegion(c, region));
      }
      Object.assign(rp, { state, answer, answerAt: now, answerBy: who.account || '總管理者' });
    });
    const open = await openSet();
    if (open.has(region)) {
      try { await cross(region, 'hqAnswer', { deliver, ids: cs.map((c) => c.id), state, answer, by: HQ_NAME_TEXT }); } catch (e) { throw err('NETWORK', '那一區暫時連不上，請稍後再按一次'); }
    }
    save(all);
    return { done: cs.length, campaigns: cs };
  };

  /** 還差什麼（提醒用）：還沒放到行事曆、或名額還沒報滿；都好了回傳 '' */
  function lackOf(x) {
    if (!x) return '';
    if (x.status === 'new' || x.status === 'seen') return '還沒放到行事曆';
    const q = Number(x.quota) || 0;
    if (x.status === 'published' && q && (x.count || 0) < q) return '還差 ' + (q - (x.count || 0)) + ' 位';
    return '';
  }
  const md = (d) => String(d || '').slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
  /** 問各區的狀況，還沒處理、沒報滿的區各送一則提醒；回傳 { regions: [{ code, name, n }] } */
  async function remindAll(cs, auto, by) {
    if (!cs.length) return { regions: [] };
    const d = await collect(cs, 'hqCountMany');
    const out = [];
    await Promise.all(d.regions.filter((g) => g.open).map(async (g) => {
      const items = cs.map((c) => ({ c, text: lackOf(d.cells[c.id][g.code]) })).filter((x) => x.text && d.cells[x.c.id][g.code]);
      if (!items.length) return;
      const lines = items.slice(0, 5).map((x) => md(x.c.start) + ' ' + x.c.title + '：' + x.text);
      const text = (auto ? '報名快截止了，' : '') + '這幾個分派還要麻煩看一下：\n' + lines.join('\n') + (items.length > 5 ? '\n⋯還有 ' + (items.length - 5) + ' 個' : '') + '\n請到後台「📥 分壇分派」處理 🙏';
      try {
        const res = await cross(g.code, 'hqRemind', { items: items.map((x) => ({ id: x.c.id, text: x.text })), body: text, auto });
        out.push({ code: g.code, name: g.name, n: items.length, phones: (res && res.phones) || 0 });
      } catch (e) { out.push({ code: g.code, name: g.name, n: items.length, error: (e && e.message) || String(e) }); }
    }));
    if (out.length) {
      const all = list();
      const at = gs.nowString_();
      cs.forEach((c0) => {
        const c = all.find((x) => x.id === c0.id);
        const rs = out.filter((o) => !o.error && lackOf(d.cells[c0.id][o.code])).map((o) => o.code);
        if (c && rs.length) c.reminded = { at, by: by || '自動', auto: !!auto, regions: rs };
      });
      save(all);
    }
    return { regions: TARGETS.map(([code]) => out.find((o) => o.code === code)).filter(Boolean) };
  }
  /** 分壇按「🔔 提醒沒處理、沒報滿的區」：body.ids＝分派代號（已經過的不提醒） */
  special.hqRemind = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const today = gs.todayString_();
    const cs = list().filter((c) => ids.indexOf(c.id) !== -1 && c.status !== 'draft' && c.end >= today);
    cs.forEach((c) => guardCat(who, c));
    return remindAll(cs, false, who.account || '總管理者');
  };
  /** 每天早上 7 點（分壇的排程）：報名截止（沒寫截止就用活動日期）前 3 天，自動提醒 */
  const REMIND_DAYS = 3;
  async function autoRemind() {
    const today = gs.todayString_();
    const day = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000;
    const cs = list().filter((c) => c.status !== 'draft' && c.autoRemind !== false && day(c.deadline || c.start) - day(today) === REMIND_DAYS);
    return remindAll(cs, true, '');
  }

  // ---- 📢 分壇公告：指令碼屬性 HQ_NOTICES（陣列）；每一區按「知道了」算已讀 ----
  const notices = () => { try { const a = JSON.parse(store.getProp('HQ_NOTICES') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const saveNotices = (a) => store.setProp('HQ_NOTICES', JSON.stringify(a));
  /** 看得到：總管理者、唯讀全部；類別帳號看「全部」和自己那一類。發／改：總管理者全部；類別帳號只能發自己那一類 */
  const seeNotice = (who, n) => who.role === '總管理者' || who.role === '唯讀' || !n.category || n.category === who.role;
  const editNotice = (who, cat) => who.role === '總管理者' || (!!cat && cat === who.role);
  const noticeFor = (n) => ({ id: n.id, title: n.title, body: n.body, category: n.category, version: n.version, createdAt: n.createdAt, updatedAt: n.updatedAt, by: HQ_NAME_TEXT });
  special.hqNoticeList = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion, true);
    const open = await openSet();
    return { role: who.role, notices: notices().filter((n) => seeNotice(who, n)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), targets: TARGETS.map(([code, name]) => ({ code, name, open: open.has(code) })) };
  };
  /** 發公告或修改：body.notice = { id?, title, body, category（''＝全部）, regions } */
  special.hqNoticeSave = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const x = body.notice || {};
    const all = notices();
    const old = x.id ? all.find((n) => n.id === x.id) : null;
    if (x.id && !old) throw err('NOT_FOUND', '找不到這則公告，可能已經刪掉了');
    const t = (v, max, label, need) => {
      const v2 = String(v == null ? '' : v).replace(/\r/g, '').trim();
      if (need && !v2) throw err('VALIDATION', '請填「' + label + '」');
      if (v2.length > max) throw err('VALIDATION', '「' + label + '」太長了（最多 ' + max + ' 個字）');
      return v2;
    };
    const n = {
      id: old ? old.id : 'N-' + gs.todayString_().replace(/-/g, '') + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 6),
      title: t(x.title, 40, '標題', true),
      body: t(x.body, 2000, '內容', false),
      category: CATS.indexOf(x.category) !== -1 ? x.category : '',
      regions: (Array.isArray(x.regions) ? x.regions : []).filter((r, i, a) => TARGET_CODES.indexOf(r) !== -1 && a.indexOf(r) === i)
    };
    if (!n.regions.length) throw err('VALIDATION', '請選要發給哪幾區');
    if (old && !editNotice(who, old.category)) throw err('FORBIDDEN', '這則公告是「' + (old.category ? catName(old.category) : '全部') + '」的，這個帳號不能改');
    if (!editNotice(who, n.category)) throw err('FORBIDDEN', '這個帳號只能發「' + catName(who.role) + '」的公告');
    const same = old && old.title === n.title && old.body === n.body && old.category === n.category;
    Object.assign(n, {
      version: old ? old.version + (same ? 0 : 1) : 1,
      createdAt: old ? old.createdAt : gs.nowString_(),
      updatedAt: same ? old.updatedAt : gs.nowString_(),
      by: who.account || '總管理者',
      reads: same ? Object.assign({}, old.reads) : {},
      delivery: {}
    });
    const open = await openSet();
    await Promise.all(n.regions.map(async (r) => {
      if (!open.has(r)) { n.delivery[r] = 'not-open'; return; }
      try { await cross(r, 'hqNoticeIn', noticeFor(n)); n.delivery[r] = 'ok'; } catch (e) { n.delivery[r] = 'error：' + ((e && e.message) || e); }
    }));
    const removed = old ? old.regions.filter((r) => n.regions.indexOf(r) === -1 && open.has(r)) : [];
    await Promise.all(removed.map((r) => cross(r, 'hqNoticeOut', n.id).catch(() => {})));
    removed.forEach((r) => { delete n.reads[r]; });
    const fresh = notices();
    saveNotices(old ? fresh.map((y) => (y.id === n.id ? n : y)) : fresh.concat([n]));
    return { notice: n };
  };
  special.hqNoticeDelete = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const n = notices().find((y) => y.id === body.id);
    if (!n) throw err('NOT_FOUND', '找不到這則公告');
    if (!editNotice(who, n.category)) throw err('FORBIDDEN', '這個帳號不能刪這則公告');
    const open = await openSet();
    await Promise.all(n.regions.filter((r) => open.has(r)).map((r) => cross(r, 'hqNoticeOut', n.id).catch(() => {})));
    saveNotices(notices().filter((y) => y.id !== n.id));
    return { deleted: n.id };
  };
  /** 各區：公告按「知道了」 */
  special.adminHqNoticeRead = async (body, curRegion) => {
    const who = regionAdmin(body, curRegion);
    const res = gs.hqAs_(who, () => gs.adminHqNoticeReadLocal_(body));
    if (res.read) { try { await cross(HQ_CODE, 'hqNoticeRead', Object.assign({ region: curRegion }, res.read)); } catch (e) { /* 分壇暫時收不到：這一區自己還是記著已讀 */ } }
    return res.inbox;
  };
  /** 分壇那一邊：某一區讀過了（版本對得上才算；公告改過要重新看） */
  function noticeRead(p) {
    const all = notices();
    const n = all.find((y) => y.id === (p && p.id));
    if (!n || n.version !== p.version || n.regions.indexOf(p.region) === -1) return { ok: false };
    n.reads = Object.assign({}, n.reads, { [p.region]: { at: String(p.at || gs.nowString_()), by: String(p.by || '').slice(0, 40) } });
    saveNotices(all);
    return { ok: true };
  }

  // ---- ⭐ 固定活動範本（2026/11/23）：指令碼屬性 HQ_TEMPLATES（陣列）；不含日期，開分派時帶入 ----
  const templates = () => { try { const a = JSON.parse(store.getProp('HQ_TEMPLATES') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  special.hqTemplateList = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion, true);
    return { templates: templates().filter((t) => canCat(who, t.category)).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')) };
  };
  /** 存範本（有 id＝修改）：body.template = 分派的欄位＋name（範本名稱）、deadlineDays（活動前幾天截止） */
  special.hqTemplateSave = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const x = body.template || {};
    const all = templates();
    const old = x.id ? all.find((t) => t.id === x.id) : null;
    if (x.id && !old) throw err('NOT_FOUND', '找不到這個範本，可能已經刪掉了');
    guardCat(who, old);
    // 借 clean() 檢查欄位（日期隨便給一個，存的時候拿掉）
    const c = clean(Object.assign({}, x, { start: '2000-01-01', end: '2000-01-01', deadline: '' }), null, true);
    guardCat(who, c);
    const name = String(x.name || c.title).trim().slice(0, 40);
    const dd = String(x.deadlineDays == null ? '' : x.deadlineDays).trim();
    if (dd && !/^\d{1,2}$/.test(dd)) throw err('VALIDATION', '報名截止「活動前幾天」請填 0～99 的數字');
    const days = Math.max(0, Math.round((Date.parse(x.end || x.start || '') - Date.parse(x.start || '')) / 86400000)) || 0;
    const t = {
      id: old ? old.id : 'T-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10),
      name, title: c.title, category: c.category, nature: c.nature, startTime: c.startTime, endTime: c.endTime, days,
      location: c.location, attire: c.attire, description: c.description, positions: c.positions,
      quotaMode: c.quotaMode, quotas: c.quotas, regions: c.regions, autoRemind: c.autoRemind, deadlineDays: dd === '' ? '' : Number(dd),
      createdAt: old ? old.createdAt : gs.nowString_(), updatedAt: gs.nowString_(), by: who.account || '總管理者'
    };
    if (all.some((y) => y.id !== t.id && y.name === t.name)) throw err('VALIDATION', '已經有叫「' + t.name + '」的範本，換個名稱或改原本那個');
    if (!old && all.length >= 100) throw err('VALIDATION', '範本最多 100 個，請先刪掉用不到的');
    store.setProp('HQ_TEMPLATES', JSON.stringify(old ? all.map((y) => (y.id === t.id ? t : y)) : all.concat([t])));
    return { template: t };
  };
  special.hqTemplateDelete = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const all = templates();
    const t = all.find((y) => y.id === body.id);
    if (!t) throw err('NOT_FOUND', '找不到這個範本');
    guardCat(who, t);
    store.setProp('HQ_TEMPLATES', JSON.stringify(all.filter((y) => y.id !== t.id)));
    return { deleted: t.id };
  };

  /** 各區這一邊：分壇叫過來（Durable Object 之間；不經過網路，不用登入） */
  function rpc(method, payload) {
    if (method === 'hqDeliver') return gs.hqDeliver_(payload);
    // 一次收好幾筆（同名草稿一起送出，2026/11/22）：一筆失敗不影響其他筆
    if (method === 'hqDeliverMany') return (Array.isArray(payload) ? payload : []).map((c) => { try { gs.hqDeliver_(c); return 'ok'; } catch (e) { return 'error：' + ((e && e.message) || e); } });
    if (method === 'hqWithdraw') return gs.hqWithdraw_(payload);
    if (method === 'hqReport') return gs.hqReport_(payload);
    if (method === 'hqReportMany') return (Array.isArray(payload) ? payload : []).map((id) => gs.hqReport_(id));
    // 統計用：不要名字，只要狀態、名額、人數
    if (method === 'hqCountMany') return (Array.isArray(payload) ? payload : []).map((id) => { const x = gs.hqReport_(id); delete x.people; return x; });
    // 教全區把 AI 金鑰借給分壇（只有 Durable Object 之間叫得到）
    // 上下溝通（2026/11/23）
    if (method === 'hqAnswer') { (Array.isArray(payload.deliver) ? payload.deliver : []).forEach((c) => gs.hqDeliver_(c)); return gs.hqAnswer_(payload); }
    if (method === 'hqRemind') return gs.hqRemind_(payload);
    if (method === 'hqNoticeIn') return gs.hqNoticeIn_(payload);
    if (method === 'hqNoticeOut') return gs.hqNoticeOut_(payload);
    if (method === 'hqReplyIn') return replyIn(payload);
    if (method === 'hqNoticeRead') return noticeRead(payload);
    if (method === 'hqAiKey') {
      const p = gs.propsForAsync_();
      return { key: p.getProperty('GEMINI_API_KEY') || '', model: p.getProperty('GEMINI_MODEL') || '' };
    }
    throw new Error('不認得的分派動作：' + method);
  }

  return { special, rpc, autoRemind };
}
