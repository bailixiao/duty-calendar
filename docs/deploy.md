# 部署說明

本文件給管理者照著操作。程式碼都在本儲存庫的 `apps-script/` 資料夾，需手動複製貼到 Apps Script 編輯器。

> 本儲存庫是公開的：成員名單、電話等個資只填在 Google Sheet，不要貼進程式碼。

## 1. 建立 Google Sheet 與 Apps Script

1. 在 Google 雲端硬碟新增一份 Google 試算表，命名為「教全區勤務行事曆」。
2. 在試算表選單點「擴充功能 → Apps Script」，開啟綁定這份試算表的 Apps Script 專案。
3. 在 Apps Script 編輯器左側「專案設定」（齒輪圖示）勾選「在編輯器中顯示 appsscript.json 資訊清單檔案」。

## 2. 設定時區（重要）

所有「當天」「已過去」的判斷都以**台北時間**為準。請確認兩處時區都是 `Asia/Taipei`：

1. **Apps Script**：打開 `appsscript.json`，將內容整份換成本儲存庫 `apps-script/appsscript.json` 的內容，其中 `"timeZone": "Asia/Taipei"`。
2. **Google Sheet**：試算表選單「檔案 → 設定 → 時區」選「(GMT+08:00) 台北」。執行 `setupSheets` 時程式也會自動設定。

## 3. 貼上程式碼

在 Apps Script 編輯器中，依本儲存庫 `apps-script/` 資料夾的檔案，逐一新增同名的指令碼檔案（`+` → 指令碼），把內容整份貼上：

| 檔案 | 用途 |
|---|---|
| `Config.gs` | 分頁名稱、欄位、選項 |
| `Sheets.gs` | 讀寫分頁的共用函式 |
| `Setup.gs` | 建立分頁與欄位 |
| `Seed.gs` | 匯入初始勤務資料 |
| `Rules.gs` | 報名規則（名額、同日重複、日期檢查） |
| `Duties.gs` | 讀取 API：行事曆、勤務詳情、名字自動提示 |
| `Signup.gs` | 報名 API |
| `Changes.gs` | 取消、改期 API |
| `Admin.gs` | 管理後台 API（登入、近期勤務、名單管理、操作紀錄與還原、明日名單） |
| `Code.gs` | Web App 進入點（doGet / doPost） |

（預設的 `程式碼.gs` 可刪除。）

## 4. 建立分頁與匯入初始資料

1. 上方函式選單選 `setupSheets`，按「執行」。第一次執行會要求授權，依畫面同意即可。
   - 會建立「成員」「分組」「勤務」「了愿項目」「報名」「操作紀錄」「統計」七個分頁。
   - 可重複執行，不會清掉既有資料。
2. 函式選單選 `seedInitialDuties`，按「執行」。
   - 匯入 115/10/1 起的初始勤務（共 62 筆、了愿項目 57 筆）與分組組名 16 個。
   - 只能在「勤務」分頁沒有資料時執行，避免重複匯入。
3. 回到試算表，在「成員」「分組」分頁填入成員與各組組長、佐理、組員（組員以「、」分隔）、組長電話。
   - 「組長電話」只會在管理後台顯示，一般網頁與 API 都不會回傳。

## 4-1. 設定管理密碼

管理後台（網站頁尾的「管理者」）用一組管理密碼保護。密碼存在 Apps Script 的「指令碼屬性」，**不寫進程式碼**。

1. Apps Script 左側點齒輪「**專案設定**」，捲到最下面「**指令碼屬性**」。
2. 按「**新增指令碼屬性**」：
   - 屬性：`ADMIN_PASSWORD`
   - 值：自訂的管理密碼（建議 8 個字以上，不要跟其他帳號共用）
3. 按「**儲存指令碼屬性**」。

- 登入後 6 小時內不用再輸入；按「登出」或過期後要重新登入。
- 密碼連續錯 10 次，會暫停登入 10 分鐘。
- 要換密碼：直接修改這個屬性的值即可，不用重新部署。

## 5. 部署 Web App

1. Apps Script 右上角點「**部署 → 新增部署作業**」。
2. 「選取類型」旁的齒輪選「**網頁應用程式**」。
3. 設定：
   - 說明：例如「第一版」
   - 執行身分：**我**
   - 誰可以存取：**所有人**（不需要登入；網址公開後任何人都能報名，這是規格要求）
4. 按「部署」，複製畫面上的「**網頁應用程式網址**」（結尾是 `/exec`）。
5. 驗證：在瀏覽器開啟 `網址?action=ping`，應看到類似：
   ```json
   {"ok":true,"data":{"now":"2026-10-01 10:00:00","today":"2026-10-01","timeZone":"Asia/Taipei"}}
   ```
   `timeZone` 必須是 `Asia/Taipei`，`now` 要是現在的台北時間。
6. 再開啟 `網址?action=getEvents&from=2026-11-01&to=2026-11-30`，應看到 11 月的勤務資料。

### 程式更新後重新部署

改了程式碼之後，原網址**不會**自動更新，要：「部署 → 管理部署作業 → 選原本的部署 → 鉛筆圖示（編輯）→ 版本選『新版本』→ 部署」。這樣網址不變，前端不用改。

- **不要**按「新增部署作業」，那會產生新網址，網站就連不到了。
- 如果這次更新也要執行改試算表的函式（例如改分頁名稱），請「先貼程式 → 執行函式 → **馬上**部署」連續做完；中間網站會暫時讀不到資料。
- `setupSheets` 補欄位（加在最後一欄）不影響舊版程式，可以先執行再部署。

### API 一覽

| 方法 | 參數 | 說明 |
|---|---|---|
| GET | `action=ping` | 檢查時區與連線 |
| GET | `action=getEvents&from=yyyy-MM-dd&to=yyyy-MM-dd` | 區間內勤務與每日人數（不含名字） |
| GET | `action=getDuty&id=勤務ID` | 勤務詳情、報名名單；公告型另含輪值組 |
| GET | `action=searchMembers&q=輸入的字[&groupType=…&group=…]` | 名字自動提示：至少一個字才回傳，只回相符者的姓名與組別（最多 10 筆，負責組組員優先），不提供整份名單 |
| GET | `action=getSiblings&id=勤務ID` | 改期可選的同名勤務（今天以後） |
| POST | `{"action":"signup","dutyId":…,"positionId":…,"dates":[…],"entries":[{"name":…,"identity":"道親","accompany":false}]}` | 報名；內容以 `text/plain` 送出 |
| POST | `{"action":"cancel","signupId":…}` | 取消（勤務當天含之後不能自己取消） |
| POST | `{"action":"reschedule","signupId":…,"dutyId":…,"date":…,"positionId":…}` | 改期到同名勤務的其他日期 |
| POST | `{"action":"admin…","token":…}` | 管理後台 API（見 `Admin.gs`）；通行碼放內容，不放網址 |

## 開發者：執行測試

在專案根目錄執行（需 Node 18 以上，不用安裝套件）：

```bash
node --test
```

## 6. 發布前端（GitHub Pages）

1. 確認 `js/config.js` 的 `API_URL` 是第 5 步部署得到的網址（結尾 `/exec`）。
2. 到 GitHub 儲存庫頁面 → **Settings → Pages**。
3. 「Build and deployment」的 Source 選 **Deploy from a branch**，Branch 選 **main**、資料夾選 **/ (root)**，按 Save。
4. 等一兩分鐘，頁面上方會出現網址（例如 `https://<帳號>.github.io/duty-calendar/`），開啟即可看到行事曆。
5. 之後每次 push 到 main，GitHub Pages 會自動更新（約一兩分鐘）。

## 開發者：本機預覽

```bash
node tools/dev-server.js
```

開啟 http://localhost:5173 。本機預覽也是連到 `js/config.js` 裡的正式 API，報名會寫入真的 Sheet，測試時請用假名並事後刪除。
