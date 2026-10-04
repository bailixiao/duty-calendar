// 資料存放：Durable Object 內建的 SQLite（正式）或記憶體（測試）。
//   sheets：每個分頁存成 JSON（太大時切成多段）；props：指令碼屬性；cache：有到期時間的快取；
//   files：DM 等上傳的檔案（照片、PDF），切成 1MB 一段存（SQLite 一列最多 2MB）。
const CHUNK = 500000;
const FILE_CHUNK = 1024 * 1024;

function base() {
  const dirty = new Set();
  return { sheets: {}, dirty, markDirty: (name) => dirty.add(name) };
}

/** 測試用：全部放記憶體 */
export function createMemoryStore() {
  const s = base();
  const props = new Map();
  const cache = new Map();
  const files = new Map();
  return Object.assign(s, {
    getProp: (k) => (props.has(k) ? props.get(k) : null),
    setProp: (k, v) => props.set(k, v),
    deleteProp: (k) => props.delete(k),
    cacheGet: (k) => { const e = cache.get(k); return e && e.exp > Date.now() ? e.v : null; },
    cachePut: (k, v, ttl) => cache.set(k, { v, exp: Date.now() + ttl * 1000 }),
    cacheRemove: (k) => cache.delete(k),
    cacheClear: () => cache.clear(),
    putFile: (id, mime, name, bytes) => files.set(id, { mime, name, bytes }),
    getFile: (id) => files.get(id) || null,
    persist: () => s.dirty.clear()
  });
}

/** 正式：Durable Object 的 SQLite（ctx.storage.sql、transactionSync） */
export function createSqlStore(storage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS sheets (name TEXT, chunk INTEGER, data TEXT, PRIMARY KEY (name, chunk))');
  sql.exec('CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT)');
  sql.exec('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)');
  sql.exec('CREATE TABLE IF NOT EXISTS files (id TEXT, chunk INTEGER, mime TEXT, name TEXT, data BLOB, PRIMARY KEY (id, chunk))');
  const s = base();
  const parts = {};
  for (const row of sql.exec('SELECT name, chunk, data FROM sheets ORDER BY name, chunk')) {
    (parts[row.name] = parts[row.name] || []).push(row.data);
  }
  Object.keys(parts).forEach((name) => { s.sheets[name] = JSON.parse(parts[name].join('')); });
  const one = (cursor) => { const r = cursor.toArray(); return r.length ? r[0] : null; };

  return Object.assign(s, {
    getProp: (k) => { const r = one(sql.exec('SELECT v FROM props WHERE k = ?', k)); return r ? r.v : null; },
    setProp: (k, v) => { sql.exec('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v); },
    deleteProp: (k) => { sql.exec('DELETE FROM props WHERE k = ?', k); },
    cacheGet: (k) => { const r = one(sql.exec('SELECT v FROM cache WHERE k = ? AND exp > ?', k, Date.now())); return r ? r.v : null; },
    cachePut: (k, v, ttl) => { sql.exec('INSERT INTO cache (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp', k, v, Date.now() + ttl * 1000); },
    cacheRemove: (k) => { sql.exec('DELETE FROM cache WHERE k = ?', k); },
    cacheClear: () => { sql.exec('DELETE FROM cache'); },
    putFile(id, mime, name, bytes) {
      storage.transactionSync(() => {
        for (let i = 0, c = 0; i < bytes.length || c === 0; i += FILE_CHUNK, c++) {
          sql.exec('INSERT INTO files (id, chunk, mime, name, data) VALUES (?, ?, ?, ?, ?)', id, c, mime, name, bytes.slice(i, i + FILE_CHUNK));
        }
      });
    },
    getFile(id) {
      const rows = sql.exec('SELECT mime, name, data FROM files WHERE id = ? ORDER BY chunk', id).toArray();
      if (!rows.length) return null;
      const parts = rows.map((r) => new Uint8Array(r.data));
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      parts.forEach((p) => { out.set(p, o); o += p.length; });
      return { mime: rows[0].mime, name: rows[0].name, bytes: out };
    },
    /** 請求結束時：改過的分頁整個寫回（同一個交易，要嘛全寫要嘛全不寫） */
    persist() {
      if (!s.dirty.size) return;
      storage.transactionSync(() => {
        s.dirty.forEach((name) => {
          sql.exec('DELETE FROM sheets WHERE name = ?', name);
          const text = JSON.stringify(s.sheets[name] || []);
          for (let i = 0, c = 0; i < text.length || c === 0; i += CHUNK, c++) {
            sql.exec('INSERT INTO sheets (name, chunk, data) VALUES (?, ?, ?)', name, c, text.slice(i, i + CHUNK));
          }
        });
        sql.exec('DELETE FROM cache WHERE exp < ?', Date.now());
      });
      s.dirty.clear();
    }
  });
}
