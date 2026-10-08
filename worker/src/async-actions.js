// 需要對外連線的功能（推播、AI 讀照片）：Apps Script 是同步的 UrlFetchApp，Worker 只能用非同步的 fetch，
// 所以這幾個函式照 apps-script/Push.gs、Ai.gs 的流程改寫成非同步版；其餘（檢查、簽章、提示文字）直接用 .gs 裡的函式。

/** 和 Code.gs 的 respond_ 相同的回應格式 */
export async function respondAsync(gs, fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof gs.ApiError_) {
      return { ok: false, error: { code: err.code, message: gs.withContact_(err.message), details: err.details } };
    }
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'INTERNAL', message: '系統發生錯誤，請稍後再試' } };
  }
}

// ---------- 推播（Push.gs） ----------

/** 一次送出（並行）；回傳 [{ endpoint, ok, gone, code }] */
export async function sendPushTo(gs, endpoints) {
  const keys = gs.pushKeys_();
  if (!keys) throw new gs.ApiError_('CONFIG', '推播尚未設定，請管理者在 Apps Script 執行 setupPush');
  const nowSec = Math.floor(Date.now() / 1000);
  const jwts = {};
  return Promise.all(endpoints.map(async (ep) => {
    const aud = ep.match(/^https:\/\/[^/]+/)[0];
    if (!jwts[aud]) jwts[aud] = gs.vapidJwt_(aud, keys.d, nowSec);
    let code = 0;
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { Authorization: 'vapid t=' + jwts[aud] + ', k=' + keys.pub, TTL: '43200', Urgency: 'high', 'Content-Length': '0' },
        body: ''
      });
      code = res.status;
    } catch (e) {
      code = 0;
    }
    return { endpoint: ep, ok: code >= 200 && code < 300, gone: code === 404 || code === 410, code };
  }));
}

export async function pushTest(gs, body) {
  if (!gs.validEndpoint_(body.endpoint)) throw new gs.ApiError_('BAD_REQUEST', '推播網址格式不對');
  const id = gs.pushIdOf_(body.endpoint);
  const cache = gs.cacheForAsync_();
  if (cache.get('pushtest-wait:' + id)) throw new gs.ApiError_('BUSY', '剛剛才傳過，請等 30 秒再試');
  cache.put('pushtest-wait:' + id, '1', 30);
  cache.put('pushtest:' + id, '1', 300);
  const res = (await sendPushTo(gs, [body.endpoint]))[0];
  if (!res.ok) throw new gs.ApiError_('PUSH', res.gone ? '這支手機的提醒已失效，請關閉後重新開啟' : '推播服務暫時無法使用（' + res.code + '），請稍後再試');
  return {};
}

/** 有勤務才送；送給所有啟用中的手機，失效的（404／410）自動停用 */
export async function sendPushAll(gs, when) {
  if (!gs.pushItems_(when).items.length) return { sent: 0, skipped: 'no-duty' };
  gs.ensureLeaderCodes_(when); // 有組長的勤務先產生點名碼（提醒裡附給組長）
  const PUSH = gs.SHEETS.PUSH;
  const eps = gs.dailyPushEndpoints_(when); // 填了「我是誰」的手機：沒報名也沒缺人就不送
  if (!eps.length) return { sent: 0 };
  const results = await sendPushTo(gs, eps);
  const now = gs.nowString_();
  const fresh = gs.readTable_(PUSH); // 送出期間可能有人開啟／關閉，重新讀
  results.forEach((res) => {
    const row = fresh.find((r) => r['端點'] === res.endpoint);
    if (!row) return;
    if (res.ok) gs.updateRow_(PUSH, row, { '最後成功': now });
    else if (res.gone) gs.updateRow_(PUSH, row, { '啟用': '否' });
  });
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

// ---------- AI 讀照片（Ai.gs） ----------

async function geminiGenerate(gs, parts) {
  const props = gs.propsForAsync_();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new gs.ApiError_('CONFIG', '尚未設定 Gemini 金鑰，請依部署說明在「指令碼屬性」設定 GEMINI_API_KEY');
  const custom = props.getProperty('GEMINI_MODEL');
  const models = (custom ? [custom] : []).concat(gs.aiDefaultModels_().filter((m) => m !== custom));
  const payload = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
  const call = (model) => fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: payload
  });
  let busy = false;
  let limited = ''; // 429 的內容（判斷是每分鐘還是每天的額度）
  let listed = false;
  for (let i = 0; i < 6; i++) {
    if (i >= models.length && !listed) {
      listed = true;
      try {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
        if (r.ok) {
          ((await r.json()).models || [])
            .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
            .map((m) => String(m.name).replace(/^models\//, ''))
            .filter((n) => /flash/.test(n) && !/image|tts|audio|live|thinking|embed/.test(n))
            .sort((a, b) => (/lite/.test(a) - /lite/.test(b)) || (b < a ? -1 : b > a ? 1 : 0))
            .forEach((m) => { if (!models.includes(m)) models.push(m); });
        }
      } catch (e) { /* 查不到就算了 */ }
    }
    if (i >= models.length) break;
    let res = await call(models[i]);
    if (res.status === 500 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await call(models[i]);
      if (res.status === 500 || res.status === 503) { busy = true; continue; }
    }
    if (res.status === 404) continue;
    const text = await res.text();
    if (res.status === 400 && /API key/i.test(text)) throw new gs.ApiError_('CONFIG', 'Gemini 金鑰不正確，請重新設定 GEMINI_API_KEY');
    if (res.status === 403) throw new gs.ApiError_('CONFIG', 'Gemini 金鑰沒有權限，請確認金鑰是在 Google AI Studio 建立的');
    if (res.status === 429) { limited += text; continue; } // 這個模型的免費額度用完：換下一個（每個模型分開算）
    if (res.status !== 200) throw new gs.ApiError_('AI', 'AI 暫時無法使用（' + res.status + '），請稍後再試');
    const json = JSON.parse(text);
    const cand = json.candidates && json.candidates[0];
    const out = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
    if (!out) throw new gs.ApiError_('AI', 'AI 沒有回覆內容，請換一張照片再試');
    return { text: out, model: models[i] };
  }
  if (limited) throw new gs.ApiError_('AI_LIMIT', /PerDay|per day|daily/i.test(limited) ? '今天的 AI 免費額度用完了，請明天再試（常用的話可以在 Google AI Studio 開啟付費，每張照片大約不到 1 元台幣）' : 'AI 使用次數太多，請等一分鐘再試');
  if (busy) throw new gs.ApiError_('AI', 'Google 的 AI 現在太忙，請過一兩分鐘再試');
  throw new gs.ApiError_('AI', '找不到可用的 Gemini 模型，請在指令碼屬性設定 GEMINI_MODEL');
}

export async function adminDraftFromImages(gs, body) {
  gs.requireAdmin_(body);
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length) throw new gs.ApiError_('BAD_REQUEST', '請選擇照片');
  if (images.length > 3) throw new gs.ApiError_('BAD_REQUEST', '一次最多 3 張照片');
  const parts = [{ text: gs.aiDraftPrompt_(gs.cleanText_(body.hint)) }];
  images.forEach((img) => {
    const mime = String((img && img.mime) || '');
    const data = String((img && img.data) || '');
    if (!/^image\/(jpeg|png|webp)$/.test(mime) || !data) throw new gs.ApiError_('BAD_REQUEST', '照片格式只能是 jpg、png');
    if (data.length > 6000000) throw new gs.ApiError_('BAD_REQUEST', '照片太大，請換一張小一點的');
    parts.push({ inline_data: { mime_type: mime, data } });
  });
  const res = await geminiGenerate(gs, parts);
  let duties;
  try {
    const parsed = JSON.parse(res.text);
    duties = Array.isArray(parsed) ? parsed : Array.isArray(parsed.duties) ? parsed.duties : [parsed];
  } catch (e) {
    throw new gs.ApiError_('AI', '照片看不太懂，請換一張清楚一點的照片再試');
  }
  duties = duties.filter((d) => d && typeof d === 'object' && d.name);
  if (!duties.length) throw new gs.ApiError_('AI', '照片裡找不到勤務資料，請確認照片內容');
  return { duties, model: res.model };
}
