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

export function createHq({ gs, store, cross, openRegions }) {
  const err = (code, msg, details) => new gs.ApiError_(code, msg, details);
  const list = () => { try { const a = JSON.parse(store.getProp('HQ_CAMPAIGNS') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const save = (a) => store.setProp('HQ_CAMPAIGNS', JSON.stringify(a));
  function requireHqAdmin(body, curRegion) {
    if (curRegion !== HQ_CODE) throw err('FORBIDDEN', '這是宏教分壇才能用的功能');
    const who = gs.requireAdmin_(body);
    if (['總管理者'].concat(CATS).indexOf(who.role) === -1) throw err('FORBIDDEN', '這個帳號不能用分派（分壇的帳號只有總管理者、總務・勤務、道務、教育）');
    return who;
  }
  /** 這個帳號能不能管這一類（總管理者全部；勤務／道務／教育只管自己那一類） */
  const canCat = (who, cat) => who.role === '總管理者' || who.role === cat;
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
    const who = requireHqAdmin(body, curRegion);
    const open = await openSet();
    return { role: who.role, campaigns: list().filter((c) => canCat(who, c.category)).slice().sort((a, b) => b.start.localeCompare(a.start)), targets: TARGETS.map(([code, name]) => ({ code, name, open: open.has(code) })) };
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
    if (old && old.source) c.source = old.source;
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
        if (old && old.source) c.source = old.source;
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
    const who = requireHqAdmin(body, curRegion);
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
    const who = requireHqAdmin(body, curRegion);
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
    const who = requireHqAdmin(body, curRegion);
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
    if (method === 'hqAiKey') {
      const p = gs.propsForAsync_();
      return { key: p.getProperty('GEMINI_API_KEY') || '', model: p.getProperty('GEMINI_MODEL') || '' };
    }
    throw new Error('不認得的分派動作：' + method);
  }

  return { special, rpc };
}
