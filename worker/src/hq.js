// 宏教分壇分派（2026/11/22）：分壇這一邊（Durable Object「hq」）。
// 分壇的總管理者開「分派」→ 送給選的區（各區的 apps-script/Hq.gs hqDeliver_ 收進「📥 分壇分派」）
// → 各區組長看過、放到自己的行事曆或寫原因不參加 → 分壇的總表問每一區（hqReport_）：狀態、名額、報名人數與名字。
// 分派存在分壇的指令碼屬性 HQ_CAMPAIGNS（JSON 陣列）。各區之間用 Durable Object 互相呼叫（opts.cross）。
import { REGIONS } from './regions.js';

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
    if (who.role !== '總管理者') throw err('FORBIDDEN', '只有分壇的總管理者可以開分派');
    return who;
  }
  /** 現在已經開通的區（教全區一直都在） */
  async function openSet() {
    let open = [];
    try { open = await openRegions(); } catch (e) { /* 問不到就當只有教全區 */ }
    return new Set(['main'].concat(open || []));
  }

  /** 檢查、整理分壇填的分派 */
  function clean(c, old) {
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
    if (!out.regions.length) throw err('VALIDATION', '請選要送給哪幾區');
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
    requireHqAdmin(body, curRegion);
    const open = await openSet();
    return { campaigns: list().slice().sort((a, b) => b.start.localeCompare(a.start)), targets: TARGETS.map(([code, name]) => ({ code, name, open: open.has(code) })) };
  };
  /** 新增或修改分派（body.campaign；有 id＝修改），存好馬上送出去 */
  special.hqSave = async (body, curRegion) => {
    const who = requireHqAdmin(body, curRegion);
    const all = list();
    const old = body.campaign && body.campaign.id ? all.find((x) => x.id === body.campaign.id) : null;
    if (body.campaign && body.campaign.id && !old) throw err('NOT_FOUND', '找不到這個分派，可能已經刪掉了');
    const c = clean(body.campaign || {}, old);
    c.version = (old ? old.version : 0) + 1;
    c.createdAt = old ? old.createdAt : gs.nowString_();
    c.updatedAt = gs.nowString_();
    c.by = who.account || '總管理者';
    const removed = old ? old.regions.filter((r) => c.regions.indexOf(r) === -1) : [];
    c.delivery = await deliver(c, removed);
    const next = old ? all.map((x) => (x.id === c.id ? c : x)) : all.concat([c]);
    save(next);
    return { campaign: c };
  };
  /** 刪掉分派：各區收回（已經放上行事曆的留著，組長自己決定） */
  special.hqDelete = async (body, curRegion) => {
    requireHqAdmin(body, curRegion);
    const all = list();
    const c = all.find((x) => x.id === body.id);
    if (!c) throw err('NOT_FOUND', '找不到這個分派');
    await deliver({ id: c.id, regions: [] }, c.regions);
    save(all.filter((x) => x.id !== c.id));
    return { deleted: c.id };
  };
  /** 總表：每一區的狀態、名額、報名人數、名字 */
  special.hqSummary = async (body, curRegion) => {
    requireHqAdmin(body, curRegion);
    const c = list().find((x) => x.id === body.id);
    if (!c) throw err('NOT_FOUND', '找不到這個分派');
    const open = await openSet();
    const rows = await Promise.all(TARGETS.filter(([r]) => c.regions.indexOf(r) !== -1).map(async ([code, name]) => {
      if (!open.has(code)) return { code, name, status: 'not-open', count: 0, people: [] };
      try { return Object.assign({ code, name }, await cross(code, 'hqReport', c.id)); } catch (e) { return { code, name, status: 'error', error: (e && e.message) || String(e), count: 0, people: [] }; }
    }));
    return { campaign: c, regions: rows };
  };

  /** 各區這一邊：分壇叫過來（Durable Object 之間；不經過網路，不用登入） */
  function rpc(method, payload) {
    if (method === 'hqDeliver') return gs.hqDeliver_(payload);
    if (method === 'hqWithdraw') return gs.hqWithdraw_(payload);
    if (method === 'hqReport') return gs.hqReport_(payload);
    throw new Error('不認得的分派動作：' + method);
  }

  return { special, rpc };
}
