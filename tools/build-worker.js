// 把 apps-script/*.gs 原封不動包成 Worker 用的模組 worker/src/gs.generated.js（部署前執行：node tools/build-worker.js）。
// Worker 不允許 eval／new Function，所以在建置時就把程式碼包進一個函式，Google 專用的物件由參數（runtime.js）提供。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'apps-script');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
const source = files.map((f) => `// ----- ${f} -----\n` + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
const overrides = fs.readFileSync(path.join(root, 'worker', 'src', 'gs-overrides.js'), 'utf8');

// 所有最上層函式都回傳出去（非同步版的推播、AI 要用到裡面的函式）
const names = [...new Set([...(source + '\n' + overrides).matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]))];
const globals = ['SpreadsheetApp', 'LockService', 'Utilities', 'ContentService', 'Session', 'PropertiesService',
  'CacheService', 'UrlFetchApp', 'ScriptApp', 'DriveApp', 'Logger', 'console'];

const out = `// 自動產生（node tools/build-worker.js），請勿手動修改；要改請改 apps-script/*.gs
/* eslint-disable */
export function createGs(G) {
  const { ${globals.join(', ')} } = G;
${source}
;
${overrides}
  return { SHEETS, OPTIONS, ${names.join(', ')} };
}
`;
fs.writeFileSync(path.join(root, 'worker', 'src', 'gs.generated.js'), out);
console.log(`gs.generated.js：${files.length} 個檔案、${names.length} 個函式`);
