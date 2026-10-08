# CLAUDE.md

## 每次工作前

- **每次工作前先讀 `docs/spec.md`，所有開發以它為準。**
- 需求有變動時，先更新 `docs/spec.md`，再改程式。

## 公開儲存庫規則

- **本儲存庫是公開的，不可放任何人名、電話。**
- 成員名單、分組名單、組長電話等個資一律只存在 Google Sheet，不得出現在程式碼、測試資料、範例、註解、文件或 commit 訊息中。
- 測試或範例需要名字時，使用明顯的假名（例如「測試甲」「測試乙」）。
- API 絕不回傳電話等個資。
- 管理密碼存在 Apps Script 的 Script Properties，不寫進程式碼。

## 開發流程

- 每完成一個段落就 commit 並 push 到 GitHub。
- **每次加新功能或畫面（行事曆排版）改變，都要同時更新常見問題**：apps-script/FaqSeed.gs 的題目（家人們與管理者）、img/help 截圖（先重開測試版再執行 node tools/help-shots.js）、圖解教學（img/tutorial、js/tutorial.js）要和畫面對得上。
