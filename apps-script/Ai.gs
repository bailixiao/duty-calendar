/**
 * 從照片產生勤務草稿（管理後台「貼上草稿」→「從照片產生草稿」）。
 *   - 照片（前端已縮小成 JPEG）送到 Google Gemini API，請它照「貼上草稿」的格式整理成 JSON。
 *   - API 金鑰存在 Script Properties 的 GEMINI_API_KEY（不寫進程式碼）；要換模型可設 GEMINI_MODEL。
 *   - 只回傳草稿，不會寫入任何資料；管理者在畫面上預覽、確認後才新增。
 *   - 第一次請在 Apps Script 編輯器執行 testGemini：授權「連線到外部服務」並確認金鑰可用。
 */

var AI_MAX_IMAGES = 3;
// 只整理本區的勤務與人員：區名在 Config.gs 的 SITE.aiRegion／aiRegionShort（這個檔案排在 Config.gs 前面，只能在函式裡讀）
var AI_MAX_IMAGE_CHARS = 6000000; // 每張 base64 約 4.5MB 以內（前端縮小後通常 300KB 左右）
// 預設先用新版；不能用或太忙時，改用「最新 Flash」的別名，再不行就問 Google 目前有哪些 Flash 模型可用
var AI_DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-flash-latest'];
var AI_MAX_MODELS = 6; // 最多試幾個模型（避免等太久）

/** body = { images: [{ mime, data(base64) }], hint } */
function adminDraftFromImages_(body) {
  var images = Array.isArray(body.images) ? body.images : [];
  if (!images.length) throw new ApiError_('BAD_REQUEST', '請選擇照片');
  if (images.length > AI_MAX_IMAGES) throw new ApiError_('BAD_REQUEST', '一次最多 ' + AI_MAX_IMAGES + ' 張照片');
  var parts = [{ text: aiDraftPrompt_(cleanText_(body.hint)) }];
  images.forEach(function (img) {
    var mime = String(img && img.mime || '');
    var data = String(img && img.data || '');
    if (!/^image\/(jpeg|png|webp)$/.test(mime) || !data) throw new ApiError_('BAD_REQUEST', '照片格式只能是 jpg、png');
    if (data.length > AI_MAX_IMAGE_CHARS) throw new ApiError_('BAD_REQUEST', '照片太大，請換一張小一點的');
    parts.push({ inline_data: { mime_type: mime, data: data } });
  });
  var res = geminiGenerate_(parts);
  var duties;
  try {
    var parsed = JSON.parse(res.text);
    duties = Array.isArray(parsed) ? parsed : Array.isArray(parsed.duties) ? parsed.duties : [parsed];
  } catch (e) {
    throw new ApiError_('AI', '照片看不太懂，請換一張清楚一點的照片再試');
  }
  duties = duties.filter(function (d) { return d && typeof d === 'object' && d.name; });
  if (!duties.length) throw new ApiError_('AI', '照片裡找不到勤務資料，請確認照片內容');
  return { duties: duties, model: res.model };
}

/** 現有勤務的名稱與工作項目（給 AI 參考，同一種勤務沿用一樣的寫法）；名稱前面的農曆日期去掉合併 */
function aiKnownDuties_() {
  var since = (Number(todayString_().slice(0, 4)) - 1) + todayString_().slice(4); // 一年內的勤務
  var posByDuty = groupBy_(readTableCached_(SHEETS.POSITIONS), '勤務ID');
  var seen = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    if (!d['名稱'] || d['開始日'] < since) return;
    var name = String(d['名稱']).replace(/^(閏)?[正一二三四五六七八九十冬臘]+月(初[一二三四五六七八九十]|十[一二三四五六七八九]|二十[一二三四五六七八九]?|廿[一二三四五六七八九]|三十|十五|初十)/, '');
    if (seen[name]) return;
    seen[name] = (posByDuty[d['勤務ID']] || []).map(function (p) { return p['了愿項目名稱']; }).filter(String).join('／');
  });
  var list = Object.keys(seen).slice(0, 80).map(function (n) { return n + (seen[n] ? '（' + seen[n] + '）' : ''); });
  return list.length ? '現有勤務的名稱（括號裡是工作項目）；照片上是同一種勤務時，請沿用一樣的名稱與項目寫法：' + list.join('、') : '';
}

function aiDraftPrompt_(hint) {
  var today = todayString_();
  return [
    '你是佛堂行事曆（' + SITE.name + '）的助理。請讀照片（勤務表、活動公告、分工表、LINE 截圖等），整理成勤務草稿 JSON。',
    '今天是 ' + today + '（台灣時間）。照片上的民國年請換成西元（民國 115 年 = 2026 年）；沒寫年份就取今天之後最近的那個日期。',
    '只輸出 JSON 陣列，每個元素是一個勤務：',
    '{',
    '  "name": 勤務名稱（照照片寫法，例如「宏宗大掃除」「重陽節敬老活動」）,',
    '  "nature": "勤務" | "支援" | "烹飪" | "活動"（一般勤務填勤務；廚房烹飪填烹飪；外出支援填支援；節慶、慶典、聯誼等只記錄參加者的填活動）,',
    '  "mode": "報名型"（有人要報名或分工）| "公告型"（只是公告輪值，不需報名）,',
    '  "start": "yyyy-MM-dd", "end": "yyyy-MM-dd"（一天就和 start 相同）,',
    '  "lunarDate": 照片只寫農曆日期時才填（例如「九月十五」「十月初一」，不要自己換算），這時 start、end 留空字串；照片有國曆日期就不用填,',
    '  "startTime": "HH:mm", "endTime": "HH:mm"（沒寫就空字串）,',
    '  "location": 地點（常見：' + OPTIONS.location.join('、') + '；照片寫別的就照寫）,',
    '  "attire": 服裝（常見：' + OPTIONS.attire.join('、') + '；照片寫別的就照寫，沒寫就空字串）,',
    '  "description": 其他注意事項、工作內容（照照片整理成幾行，沒有就空字串）,',
    '  "deadline": 報名截止日 "yyyy-MM-dd"（照片有寫才填，否則空字串）,',
    '  "multi": true 或 false（同一人可以同時兼任好幾個工作項目才填 true）,',
    '  "positions": [{ "name": 工作項目名稱, "min": 最少人數, "max": 最多人數 }]（照片沒分項目就一個項目叫「了愿」；人數沒寫就 min 填 2、max 填空字串）,',
    '  "assign": { 工作項目名稱: [已經排好的人的全名] }（照片上已分配好的人；名字照寫，不要加稱呼；沒有就 {}）,',
    '  "uncertain": [看不清楚、或你不確定的地方，用中文簡短說明]',
    '}',
    '規則：看不清楚或照片沒寫的欄位一律填空字串，不要猜；同一個活動有好幾天就一筆、用 start 和 end；不同活動分開成多筆。',
    '【只整理「' + SITE.aiRegion + '」】我們是「' + SITE.aiRegion + '」（照片上可能寫成「' + SITE.aiRegionShort + '」）。照片如果列了好幾個區（例如教真、教德、教善⋯），只整理' + SITE.aiRegion + '負責的部分：positions 只放' + SITE.aiRegion + '要做的工作項目，assign 只放' + SITE.aiRegion + '的人；其他區的工作和人一律不要。區名不是工作項目：照片只用區名分欄、沒寫工作內容時，項目叫「了愿」。整筆勤務都跟' + SITE.aiRegion + '無關就不要輸出。照片完全沒分區，就全部整理。',
    aiKnownDuties_(),
    hint ? '管理者補充說明：' + hint : ''
  ].join('\n');
}

/** 呼叫 Gemini；parts 為 [{ text } | { inline_data }]。回傳 { text, model } */
function geminiGenerate_(parts) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new ApiError_('CONFIG', '尚未設定 Gemini 金鑰，請依部署說明在「指令碼屬性」設定 GEMINI_API_KEY');
  var custom = props.getProperty('GEMINI_MODEL');
  // 指定的模型優先，再接預設的（指定的不能用或太忙時還有備用）
  var models = (custom ? [custom] : []).concat(AI_DEFAULT_MODELS.filter(function (m) { return m !== custom; }));
  var busy = false;
  var limited = ''; // 429 的內容（判斷是每分鐘還是每天的額度）
  var payload = JSON.stringify({
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
  });
  var listed = false;
  // 清單試完還沒成功時，問 Google 目前可用的 Flash 模型補進來（只問一次）
  var more = function () {
    if (listed) return;
    listed = true;
    geminiListFlash_(key).forEach(function (m) { if (models.indexOf(m) === -1) models.push(m); });
  };
  for (var i = 0; i < AI_MAX_MODELS; i++) {
    if (i >= models.length) more();
    if (i >= models.length) break;
    var resp = geminiFetch_(models[i], key, payload);
    var code = resp.getResponseCode();
    // 500／503：Google 那邊太忙，等一下再試一次，還是忙就換下一個（通常比較不擠的）模型
    if (code === 500 || code === 503) {
      Utilities.sleep(2000);
      resp = geminiFetch_(models[i], key, payload);
      code = resp.getResponseCode();
      if (code === 500 || code === 503) { busy = true; continue; }
    }
    if (code === 404) continue; // 這個模型不存在（Google 改名或收掉了）：換下一個
    if (code === 400 && /API key/i.test(resp.getContentText())) throw new ApiError_('CONFIG', 'Gemini 金鑰不正確，請重新設定 GEMINI_API_KEY');
    if (code === 403) throw new ApiError_('CONFIG', 'Gemini 金鑰沒有權限，請確認金鑰是在 Google AI Studio 建立的');
    if (code === 429) { limited += resp.getContentText(); continue; } // 這個模型的免費額度用完：換下一個（每個模型分開算）
    if (code !== 200) throw new ApiError_('AI', 'AI 暫時無法使用（' + code + '），請稍後再試');
    var json = JSON.parse(resp.getContentText());
    var cand = json.candidates && json.candidates[0];
    var text = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
    if (!text) throw new ApiError_('AI', 'AI 沒有回覆內容，請換一張照片再試');
    return { text: text, model: models[i] };
  }
  if (limited) throw new ApiError_('AI_LIMIT', /PerDay|per day|daily/i.test(limited) ? '今天的 AI 免費額度用完了，請明天再試（常用的話可以在 Google AI Studio 開啟付費，每張照片大約不到 1 元台幣）' : 'AI 使用次數太多，請等一分鐘再試');
  if (busy) throw new ApiError_('AI', 'Google 的 AI 現在太忙，請過一兩分鐘再試');
  throw new ApiError_('AI', '找不到可用的 Gemini 模型，請在指令碼屬性設定 GEMINI_MODEL');
}

/** 目前金鑰可用、能產生內容的 Flash 模型（新的排前面；不含圖片、語音、即時等特殊版本） */
function geminiListFlash_(key) {
  try {
    var resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': key }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return [];
    return (JSON.parse(resp.getContentText()).models || [])
      .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; })
      .map(function (m) { return String(m.name).replace(/^models\//, ''); })
      .filter(function (n) { return /flash/.test(n) && !/image|tts|audio|live|thinking|embed/.test(n); })
      .sort(function (a, b) { return (/lite/.test(a) - /lite/.test(b)) || (b < a ? -1 : b > a ? 1 : 0); });
  } catch (e) {
    return [];
  }
}

function geminiFetch_(model, key, payload) {
  return UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: payload,
    muteHttpExceptions: true
  });
}

/** 在 Apps Script 編輯器執行：授權外部連線並測試金鑰（不會寫入任何資料） */
function testGemini() {
  var res = geminiGenerate_([{ text: '請只回傳 JSON：{"ok": true, "message": "Gemini 連線成功"}' }]);
  Logger.log('使用模型：' + res.model + '，回覆：' + res.text);
}

/** 在 Apps Script 編輯器執行：列出這把金鑰目前可用的 Flash 模型（要指定 GEMINI_MODEL 時參考） */
function listGeminiModels() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('可用的 Flash 模型：' + geminiListFlash_(key).join('、'));
}
