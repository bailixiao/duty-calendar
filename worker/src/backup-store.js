// 分區（2026/11/19）：每週自動備份。13 區的資料各自備份一份，存在另一個 Durable Object「backup」（不是那一區自己的），
// 那一區的資料被誤刪、改壞時還能還原。每區留最近 8 份；太大的切成多段存（SQLite 一列最多 2MB）。
// 還原用 tools/region-backup.js（要 REGION_ADMIN_KEY），見 docs/multi-region.md 3.5。
const CHUNK = 1000000;
export const KEEP = 8;

/** 正式：Durable Object 的 SQLite */
export function createSqlBackups(storage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS backups (region TEXT, at TEXT, chunk INTEGER, data TEXT, PRIMARY KEY (region, at, chunk))');
  return {
    save(region, at, text) {
      storage.transactionSync(() => {
        sql.exec('DELETE FROM backups WHERE region = ? AND at = ?', region, at);
        for (let i = 0, c = 0; i < text.length || c === 0; i += CHUNK, c++) {
          sql.exec('INSERT INTO backups (region, at, chunk, data) VALUES (?, ?, ?, ?)', region, at, c, text.slice(i, i + CHUNK));
        }
        const old = sql.exec('SELECT DISTINCT at FROM backups WHERE region = ? ORDER BY at DESC', region).toArray().slice(KEEP);
        old.forEach((r) => sql.exec('DELETE FROM backups WHERE region = ? AND at = ?', region, r.at));
      });
    },
    list() {
      return sql.exec('SELECT region, at, SUM(LENGTH(data)) AS size FROM backups GROUP BY region, at ORDER BY region, at DESC').toArray()
        .map((r) => ({ region: r.region, at: r.at, size: r.size }));
    },
    get(region, at) {
      const rows = sql.exec('SELECT data FROM backups WHERE region = ? AND at = ? ORDER BY chunk', region, at).toArray();
      return rows.length ? rows.map((r) => r.data).join('') : null;
    }
  };
}

/** 測試、測試版：放記憶體 */
export function createMemoryBackups() {
  const all = new Map(); // region → Map(at → text)
  return {
    save(region, at, text) {
      const m = all.get(region) || new Map();
      m.set(at, text);
      [...m.keys()].sort().reverse().slice(KEEP).forEach((k) => m.delete(k));
      all.set(region, m);
    },
    list() {
      const out = [];
      [...all.keys()].sort().forEach((r) => [...all.get(r).keys()].sort().reverse().forEach((at) => out.push({ region: r, at, size: all.get(r).get(at).length })));
      return out;
    },
    get(region, at) {
      const m = all.get(region);
      return (m && m.get(at)) || null;
    }
  };
}
