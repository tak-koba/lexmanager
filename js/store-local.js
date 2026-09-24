// LexManager 4 - iPhone / GitHub Pages 用のオフライン保存（DESIGN.md §5）
//
// 端末内（IndexedDB）に「状態」をひとまとまりで保存する:
//   { records: {clients:{id:rec}, cases:{...}, todos:{...}},
//     base:    同じ形（最後にPCデータを読み込んだ時点の内容。変更の書出しに使う）,
//     snapshotStamp, snapshotAt, lastExportAt, lastExportSig, deviceName }
// 合言葉を設定すると、状態全体（base を含む）を AES-GCM で暗号化して保存する。
// データ量は小さい（数十〜数百件）ため、保存のたびに全体を書き込む単純な方式にしている。

import { newId } from './model.js';

const DB_NAME = 'lexmanager4';
const DB_VERSION = 1;
const COLLS = ['clients', 'cases', 'todos'];
const MANAGED = ['rev', 'updatedAt', 'updatedBy'];

// ---------- IndexedDB（キー・値だけの小さなラッパー） ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function kvGet(db, key) {
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function kvPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('保存が中断されました（端末の空き容量を確認してください）'));
  });
}

// ---------- 暗号化（AES-GCM / PBKDF2-SHA256 20万回） ----------

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase, saltB64) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: 200000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: toB64(iv), data: toB64(data) };
}

async function decryptJson(key, enc) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) }, key, fromB64(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- 補助 ----------

function nowIso() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    records: { clients: {}, cases: {}, todos: {} },
    base: { clients: {}, cases: {}, todos: {} },
    snapshotStamp: '', snapshotAt: '', lastExportAt: '', lastExportSig: '', deviceName: 'iPhone'
  };
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function guessFileType(mime) {
  if (!mime) return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export class LocalStore {
  constructor() {
    this.capabilities = {
      ai: false, csv: false, update: false, migrate: false,
      trash: false, conflicts: false, mobileImport: false, local: true
    };
    this._db = null;
    this._key = null;       // 合言葉から作った鍵（ロック解除後のみ）
    this._salt = null;      // 合言葉が設定されていれば salt
    this._state = null;     // ロック中は null
    this._changeCbs = [];
  }

  // ---------- 起動・ロック ----------

  async init() {
    this._db = await openDb();
    const envelope = await kvGet(this._db, 'state');
    if (envelope && envelope.enc) {
      this._salt = envelope.salt;
      this._state = null; // 合言葉入力待ち
    } else {
      this._state = Object.assign(emptyState(), envelope && envelope.plain ? envelope.plain : {});
    }
    return this.meta();
  }

  isLocked() {
    return !this._state;
  }

  async hasPassphrase() {
    return !!this._salt;
  }

  /** 合言葉でロック解除。成功で true。 */
  async unlock(pass) {
    const envelope = await kvGet(this._db, 'state');
    if (!envelope || !envelope.enc) return true;
    try {
      const key = await deriveKey(pass, envelope.salt);
      const state = await decryptJson(key, envelope.enc);
      this._key = key;
      this._state = Object.assign(emptyState(), state);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 合言葉を設定・変更する。空文字なら暗号化を解除する。 */
  async setPassphrase(pass) {
    this._requireUnlocked();
    if (!pass) {
      this._key = null;
      this._salt = null;
    } else {
      if (pass.length < 6) throw new Error('合言葉は6文字以上にしてください');
      this._salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      this._key = await deriveKey(pass, this._salt);
    }
    await this._persist();
  }

  async _persist() {
    if (this._key) {
      await kvPut(this._db, 'state', { salt: this._salt, enc: await encryptJson(this._key, this._state) });
    } else {
      await kvPut(this._db, 'state', { plain: this._state });
    }
  }

  _requireUnlocked() {
    if (!this._state) throw new Error('合言葉を入力してロックを解除してください');
  }

  async meta() {
    return {
      appVersion: 'web', schema: 4, mode: 'local',
      device: (this._state && this._state.deviceName) || 'iPhone',
      aiAvailable: false, aiConfigured: false
    };
  }

  // ---------- アダプターの共通インターフェース ----------

  async all() {
    this._requireUnlocked();
    const out = {};
    for (const coll of COLLS) out[coll] = Object.values(this._state.records[coll]).map(clone);
    return out;
  }

  async create(coll, record) {
    this._requireUnlocked();
    const id = record.id || newId(coll === 'clients' ? 'c' : coll === 'cases' ? 'k' : 't');
    const now = nowIso();
    const saved = { ...clone(record), id, rev: 1, createdAt: now, updatedAt: now, updatedBy: this._state.deviceName };
    this._state.records[coll][id] = saved;
    await this._persist();
    this._notifyChange();
    return clone(saved);
  }

  // この端末だけの保存なので競合は起きない。PCへの反映時にPC側で3方向マージする。
  async update(coll, record, base) {
    this._requireUnlocked();
    const current = this._state.records[coll][record.id] || null;
    if (!current) throw new Error('対象のデータが見つかりません（削除された可能性があります）');
    const saved = {
      ...clone(record),
      rev: (current.rev || 0) + 1,
      createdAt: current.createdAt || record.createdAt || nowIso(),
      updatedAt: nowIso(),
      updatedBy: this._state.deviceName
    };
    this._state.records[coll][record.id] = saved;
    await this._persist();
    this._notifyChange();
    return { record: clone(saved), merged: false };
  }

  async remove(coll, record) {
    this._requireUnlocked();
    delete this._state.records[coll][record.id];
    await this._persist();
    this._notifyChange();
    return { ok: true };
  }

  async uploadFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return {
      id: newId('f'), label: '', filename: '', originalName: file.name,
      fileType: guessFileType(file.type), size: file.size, addedAt: nowIso(), dataUrl
    };
  }

  // iPhoneで追加したファイルは dataUrl で表示。PCから読み込んだファイル本体はiPhoneには無い。
  fileUrl(ref) {
    return (ref && ref.dataUrl) || '';
  }

  onChange(cb) {
    this._changeCbs.push(cb);
    return () => { this._changeCbs = this._changeCbs.filter((c) => c !== cb); };
  }

  _notifyChange() {
    for (const cb of this._changeCbs) {
      try { cb(); } catch (e) { /* ignore */ }
    }
  }

  // ---------- 設定 ----------

  async setDeviceName(name) {
    this._requireUnlocked();
    this._state.deviceName = (name || '').trim() || 'iPhone';
    await this._persist();
  }

  getDeviceName() {
    return (this._state && this._state.deviceName) || 'iPhone';
  }

  // ---------- PC ⇄ iPhone ----------

  /** PCが作った mobile/snapshot.json を読み込み、端末内を置き換える。 */
  async importSnapshot(file) {
    this._requireUnlocked();
    let snap;
    try {
      snap = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('ファイルを読み取れません（JSON形式ではありません）');
    }
    if (!snap || snap.format !== 'lexmanager-snapshot') {
      throw new Error('LexManagerData/mobile/snapshot.json を選んでください（形式が違います）');
    }
    const next = { clients: {}, cases: {}, todos: {} };
    for (const coll of COLLS) for (const rec of snap[coll] || []) if (rec && rec.id) next[coll][rec.id] = rec;
    this._state.records = clone(next);
    this._state.base = clone(next);
    this._state.snapshotStamp = snap.stamp || '';
    this._state.snapshotAt = snap.exportedAt || nowIso();
    this._state.lastExportSig = '';
    await this._persist();
    this._notifyChange();
    return { ok: true, counts: { clients: (snap.clients || []).length, cases: (snap.cases || []).length, todos: (snap.todos || []).length } };
  }

  /** 前回PCデータを読み込んで以降の変更一覧。 */
  _computeChanges() {
    this._requireUnlocked();
    const changes = [];
    for (const coll of COLLS) {
      const recs = this._state.records[coll];
      const base = this._state.base[coll];
      for (const [id, rec] of Object.entries(recs)) {
        const b = base[id] || null;
        if (!b) {
          changes.push({ coll, id, op: 'upsert', base: null, record: rec });
        } else {
          const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !MANAGED.includes(k)));
          if (!sameJson(strip(b), strip(rec))) changes.push({ coll, id, op: 'upsert', base: b, record: rec });
        }
      }
      for (const [id, b] of Object.entries(base)) {
        if (!recs[id]) changes.push({ coll, id, op: 'delete', base: b, record: null });
      }
    }
    return changes;
  }

  async pendingChangesCount() {
    return this._computeChanges().length;
  }

  async hasPendingChanges() {
    return this._computeChanges().length > 0;
  }

  /** まだ書き出していない変更があるか（書出し後にさらに変えた場合も true）。 */
  async hasUnexportedChanges() {
    const changes = this._computeChanges();
    if (!changes.length) return false;
    return JSON.stringify(changes) !== this._state.lastExportSig;
  }

  getSyncInfo() {
    return this._state
      ? { snapshotAt: this._state.snapshotAt, lastExportAt: this._state.lastExportAt }
      : { snapshotAt: '', lastExportAt: '' };
  }

  async exportChanges() {
    const changes = this._computeChanges();
    if (!changes.length) throw new Error('書き出す変更はありません');
    const payload = {
      format: 'lexmanager-changes', version: 1,
      device: this._state.deviceName, exportedAt: nowIso(),
      snapshotStamp: this._state.snapshotStamp || '', changes
    };
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const safeDevice = this._state.deviceName.replace(/[^A-Za-z0-9_-]/g, '') || 'iPhone';
    const filename = `lexmanager-changes-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${safeDevice}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });

    let method = 'download';
    const fileObj = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
      try {
        await navigator.share({ files: [fileObj], title: 'LexManager 変更データ' });
        method = 'share';
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('書出しを取り消しました');
        download(blob, filename);
      }
    } else {
      download(blob, filename);
    }
    this._state.lastExportAt = payload.exportedAt;
    this._state.lastExportSig = JSON.stringify(changes);
    await this._persist();
    return { ok: true, method, filename, count: changes.length };
  }

  // ---------- 旧iPhone版（localStorage）のデータ ----------

  getLegacyIphoneData() {
    try {
      const raw = window.localStorage.getItem('lexmanager_db');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  exportLegacyIphoneData() {
    const data = this.getLegacyIphoneData();
    if (!data) return { ok: false, error: '旧iPhone版のデータが見つかりません' };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `lexmanager-legacy-iphone-${nowIso().slice(0, 10)}.json`);
    return { ok: true };
  }
}
