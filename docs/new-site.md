# 複製給新團體：步驟清單

這套系統可以整份複製給其他團體使用（例如書槑子）。每個團體各自一份：自己的 GitHub 儲存庫、網址、Cloudflare 後端、Google 試算表，資料完全分開。

## 一、要改的設定

### 1. `js/site.js`（前端）＋ `apps-script/Config.gs` 最上面的 `SITE`（後端）

兩邊的共同欄位要一致，`tests/site-config.test.js` 會檢查。

| 欄位 | 用途 | 教全區的值 |
|---|---|---|
| `name` | 網站名稱（標題列、主畫面圖示名稱、通知、匯出的 Excel） | 教全區行事曆 |
| `org` | 團體名稱（名單開頭、照片草稿只整理這個團體） | 教全區 |
| `venue` | 可以借的場地 | 區中心 |
| `temple` | 「佛堂」這個用詞 | 佛堂 |
| `categoryLabels` | 三個類別顯示的名字（內部代號「勤務、道務、教育」不變） | 總務・勤務／道務／教育 |
| `locations` | 新增勤務時的地點選項 | 宏宗、區中心、⋯ |

只有前端有的：`eduTeacherClasses`（教育統計看哪幾個班）、`shortageTitle`／`inviteTitle`（缺人通知、邀請通知的標題）、`examples`（畫面上的範例字）、`features`（不需要的功能設成 false，會藏起入口，例如不借場地就把 `venue` 設成 false）。

只有後端有的：`siteUrl`（新網站的網址）、`aiRegion`／`aiRegionShort`（照片草稿只整理哪個區）。

### 2. 其他要換的檔案
- `manifest.webmanifest`：`name`、`short_name`、`description`（加到主畫面的名字）。
- `index.html`：`<title>`、`apple-mobile-web-app-title`（網頁會自動換成設定的名字，這裡改了比較不會閃一下）。
- `icons/`：App 圖示（換成新團體的標誌）。
- `css/app.css` 最上面的 `:root` 顏色：想換風格（例如青年團體更活潑的顏色）就改這幾個色碼。
- `js/config.js`：新的 Cloudflare 後端網址（`CF`），Google 版網址（`GAS`）。
- `worker/wrangler.toml`：Worker 名稱改成新的（例如 `shumeizi-api`）。

### 3. 要整份換掉的內容
- `apps-script/Seed.gs`：初始勤務資料（教全區的勤務），新團體從空的開始，或改成新團體的。
- `apps-script/FaqSeed.gs`：常見問題的預設題目（內容寫的是教全區的流程）。也可以上線後在後台「📖 教學」直接改。
- `apps-script/Ai.gs`：照片草稿的提示詞裡有教全區的例子，可以換成新團體的。
- `img/duty/`、`js/duty-images.js`：勤務頁的重點圖片（12人小組等）。
- `img/help/`：常見問題的截圖（截圖裡是教全區的畫面）。

## 二、建立新網站的步驟（請 Claude 照做）

1. 在 `D:\Projects\` 開新資料夾，把這個儲存庫複製過去（不要複製 `.git`、`.clasp.json`）。
2. 改上面「要改的設定」。
3. 建新的 GitHub 儲存庫（公開才能用 GitHub Pages 免費放網站），push，開 GitHub Pages。
4. 建新的 Cloudflare Worker（改 `wrangler.toml` 名稱後 `npx wrangler deploy`），把網址填進 `js/config.js`。
5. 建新的 Google 試算表與 Apps Script（clasp），設定管理密碼（Script Properties 的 `ADMIN_PASSWORD`）、管理者聯絡人（`ADMIN_CONTACT`），執行 `setupPush` 產生推播金鑰。
6. 用 `import` 把試算表搬到 Cloudflare，切換成正式（`LIVE`），設定每 10 分鐘同步。
7. `node --test` 全部通過，用測試版走一遍報名、後台，再給大家用。

## 三、書槑子的備註（2026/10/7）

- 也是道場，成員都是青年，氣氛要活潑生動。
- 建議：顏色換成比較明亮的色系；通知與說明的用詞更輕鬆（可以多一點表情符號）；常見問題重寫成青年的口吻。
- 用不到的功能（例如借場地、修繕、各佛堂道務目標）可以在 `features` 關掉入口；要不要用到「佛堂」「點傳師」等用詞，開始前再確認。
