/**
 * Stardy — IndexedDB 数据层
 *
 * 多 store 设计（教训来自前身 Vue 版：不要把全部数据塞成一个 JSON blob）：
 *   subjects / docs / nodes / links / cards / quiz / revlog / settings / meta
 * 文档全文独立存 docs，卡片调度状态直接长在 cards 记录上，复习日志单独入 revlog。
 */

const DB_NAME = 'stardy';
const DB_VERSION = 1;

const STORES = [
  { name: 'subjects', keyPath: 'id', indexes: [] },
  { name: 'docs', keyPath: 'id', indexes: ['subjectId'] },
  { name: 'nodes', keyPath: 'id', indexes: ['subjectId', 'pid'] },
  { name: 'links', keyPath: 'id', indexes: ['subjectId'] },
  { name: 'cards', keyPath: 'id', indexes: ['subjectId', 'noteId'] },
  { name: 'quiz', keyPath: 'id', indexes: ['subjectId'] },
  // revlog：每答一次写一行；day 是本地日期字符串，供热图 / 连击 / 配额统计
  { name: 'revlog', keyPath: 'id', indexes: ['cardId', 'subjectId', 'day'] },
  { name: 'settings', keyPath: 'key', indexes: [] },
  { name: 'meta', keyPath: 'key', indexes: [] },
];

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) {
        const store = d.objectStoreNames.contains(s.name)
          ? req.transaction.objectStore(s.name)
          : d.createObjectStore(s.name, { keyPath: s.keyPath });
        for (const idx of s.indexes) {
          if (!store.indexNames.contains(idx)) store.createIndex(idx, idx, { unique: false });
        }
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
}

/** 断言 IndexedDB 可用（隐私模式 / file:// 下可能没有） */
export const idbAvailable = typeof indexedDB !== 'undefined';

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 操作失败'));
  });
}

/** 在一个事务里跑一批操作：ops 接收事务对象，全部 async 完成后提交 */
async function run(stores, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('事务失败'));
    tx.onabort = () => reject(tx.error || new Error('事务中止'));
    Promise.resolve(fn(tx))
      .then((r) => { result = r; })
      .catch((e) => { try { tx.abort(); } catch {} reject(e); });
  });
}

export const db = {
  ready: open,
  available: idbAvailable,

  get(store, id) { return run([store], 'readonly', (tx) => promisify(tx.objectStore(store).get(id))); },

  all(store) { return run([store], 'readonly', (tx) => promisify(tx.objectStore(store).getAll())); },

  byIndex(store, index, value) {
    return run([store], 'readonly', (tx) => promisify(tx.objectStore(store).index(index).getAll(value)));
  },

  count(store, index, value) {
    return run([store], 'readonly', (tx) => promisify(
      index ? tx.objectStore(store).index(index).count(value) : tx.objectStore(store).count()
    ));
  },

  put(store, value) { return run([store], 'readwrite', (tx) => promisify(tx.objectStore(store).put(value))); },

  /** 一个事务里批量写入，保证原子性（备份恢复 / 导入用） */
  bulkPut(store, values) {
    if (!values.length) return Promise.resolve();
    return run([store], 'readwrite', (tx) => {
      const os = tx.objectStore(store);
      for (const v of values) os.put(v);
    });
  },

  del(store, id) { return run([store], 'readwrite', (tx) => promisify(tx.objectStore(store).delete(id))); },

  /** 删除某索引值下的全部记录（级联删除用） */
  delByIndex(store, index, value) {
    return run([store], 'readwrite', async (tx) => {
      const os = tx.objectStore(store).index(index);
      const keys = await promisify(os.getAllKeys(value));
      const target = tx.objectStore(store);
      for (const k of keys) target.delete(k);
      return keys.length;
    });
  },

  clear(store) { return run([store], 'readwrite', (tx) => promisify(tx.objectStore(store).clear())); },

  /** 跨 store 原子写（一次答题 = cards + revlog 两处更新） */
  multi(stores, fn) { return run(stores, 'readwrite', fn); },
};

export default db;
