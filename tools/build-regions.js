// 分區（2026/11/19）：幫每一區產生
//   <代號>/index.html          轉址頁：…/duty-calendar/she/?x#y → …/duty-calendar/?r=she&x#y（分享用的網址比較好看）
//   <代號>/j/index.html        那一區的短報名網址（和 j/index.html 一樣，轉到 <代號>/ 再轉到報名頁）
//   manifests/<代號>.webmanifest 加到主畫面：這一區的名稱，打開這一區
// 區的清單在 worker/src/regions.js。改了 j/index.html 或 manifest.webmanifest 也要重新執行：node tools/build-regions.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function redirectPage(code, name) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}行事曆</title>
<script>
// 由 tools/build-regions.js 產生，不要直接改。轉到 ${name}的行事曆（網址後面的 ?… 和 #… 一起帶過去）
(function () {
  var q = location.search.replace(/^\\?/, '');
  location.replace('../?r=${code}' + (q ? '&' + q : '') + location.hash);
})();
</script>
</head>
<body><p style="font:18px sans-serif;text-align:center;margin-top:30vh">打開${name}行事曆中⋯</p></body>
</html>
`;
}

async function main() {
  const { REGIONS } = await import('../worker/src/regions.js');
  const jPage = fs.readFileSync(path.join(root, 'j', 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  for (const [code, name] of Object.entries(REGIONS)) {
    fs.mkdirSync(path.join(root, code, 'j'), { recursive: true });
    fs.writeFileSync(path.join(root, code, 'index.html'), redirectPage(code, name));
    fs.writeFileSync(path.join(root, code, 'j', 'index.html'), jPage);
    const m = Object.assign({}, manifest, {
      id: '../?r=' + code,
      name: name + '行事曆',
      short_name: name + '行事曆',
      description: name + '勤務報名與行事曆',
      start_url: '../?r=' + code,
      scope: '../',
      icons: manifest.icons.map((i) => Object.assign({}, i, { src: '../' + i.src }))
    });
    fs.writeFileSync(path.join(root, 'manifests', code + '.webmanifest'), JSON.stringify(m, null, 2) + '\n');
  }
  console.log('分區頁面：' + Object.keys(REGIONS).length + ' 區');
}

main().catch((e) => { console.error(e); process.exit(1); });
