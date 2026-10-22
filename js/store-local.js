// LexManager 4 - iPhone / GitHub Pages 用のオフライン保存（DESIGN.md §5）
//
// 端末内（IndexedDB）に「状態」をひとまとまりで保存する:
//   { records: {clients:{id:rec}, cases:{...}, todos:{...}},
//     base:    同じ形（最後にPCデータを読み込んだ時点の内容。変更の書き出しに使う）,
//     snapshotStamp, snapshotAt, lastExportAt, lastExportSig, deviceName }
// パスワードを設定すると、状態全体（base を含む）を AES-GCM で暗号化して保存する。
// データ量は小さい（数十〜数百件）ため、保存のたびに全体を書き込む単純な方式にしている。
//
// 複数の画面（タブ）対策: 保存データ（envelope）の外側に「保存の世代」saveGen を持ち、保存のたびに1増やす。
// 保存の直前に IndexedDB 上の saveGen を読み、自分が最後に読んだ／書いた世代と違えば（別の画面が先に保存した）
// 保存せずに例外にする（古い内容で上書きしたり、作り替えた鍵を古い鍵で上書きしたりしないため）。
// 鍵の作り替え・保存は BroadcastChannel('lexmanager4') で他の画面へ知らせる（app.js が開き直しを促す）。

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

async function encryptJson(key, obj, ad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = ad ? { name: 'AES-GCM', iv, additionalData: ad } : { name: 'AES-GCM', iv };
  const data = await crypto.subtle.encrypt(params, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: toB64(iv), data: toB64(data) };
}

async function decryptJson(key, enc, ad) {
  const iv = fromB64(enc.iv);
  const params = ad ? { name: 'AES-GCM', iv, additionalData: ad } : { name: 'AES-GCM', iv };
  const plain = await crypto.subtle.decrypt(params, key, fromB64(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- 形式v2: データ鍵(DK)を「パスワード用」「復旧コード用」の2通りに包む（DESIGN.md §15） ----------
// envelope v2 = { v:2, gen, ascii, kdf:{pw:{salt,iter}, rc:{salt,iter}}, wrapPw, wrapRc, rcIssuedAt, enc }
// state は DK で暗号化。DK の生バイトは包む・開くときだけ一時的に使い、普段は取り出せない鍵（extractable=false）で持つ。

const KDF_ITER_PW = 600000;  // パスワード（総当たり対策。Codexの推奨値を出発点）
const KDF_ITER_RC = 100000;  // 復旧コード（128ビットの乱数なので少なくてよい）
const KDF_ITER_MAX = 2000000;
export const PASSWORD_MIN = 8;
const PASSWORD_RE = /^[\x21-\x7E]+$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 新しいパスワードの確認（8文字以上・半角の英数字と記号のみ） */
export function checkNewPassword(pw) {
  if (!pw || pw.length < PASSWORD_MIN) throw new Error(`パスワードは${PASSWORD_MIN}文字以上にしてください`);
  if (!PASSWORD_RE.test(pw)) throw new Error('パスワードは半角の英数字と記号だけ使えます（空白・全角は使えません）');
}

/** 復旧コード: 128ビットの乱数を Crockford Base32 で 26文字（4文字ずつ区切り） */
function newRecoveryCode() {
  const bytes = randBytes(16);
  let out = '';
  let value = 0;
  let bits = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join('-');
}

/** 入力された復旧コードをそろえる（大文字化、区切り・空白を除く、O→0、I/L→1） */
export function normalizeRecoveryCode(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

async function kekFrom(secret, kdf) {
  if (!kdf || !kdf.salt || !(kdf.iter > 0) || kdf.iter > KDF_ITER_MAX) throw new Error('保存データの形式が不正です');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(kdf.salt), iterations: kdf.iter, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

/** 暗号文の用途・世代を結び付ける（取り違え・差し替えの検出） */
function aad(purpose, gen) {
  return new TextEncoder().encode(`lexmanager4:v2:${purpose}:${gen}`);
}

async function sealBytes(key, bytes, ad) {
  const iv = randBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, bytes);
  return { iv: toB64(iv), data: toB64(data) };
}

async function openBytes(key, enc, ad) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv), additionalData: ad }, key, fromB64(enc.data)));
}

function importDk(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
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

export const STALE_MESSAGE = '別の画面で更新されました。開き直してください';

/** 保存データの世代（saveGen）。この仕組みより前に保存したデータは 0 */
function genOf(envelope) {
  return (envelope && Number(envelope.saveGen)) || 0;
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
    this._key = null;       // 形式v1: パスワードから直接作った鍵（ロック解除後のみ）
    this._dk = null;        // 形式v2: データ鍵（取り出せない鍵。ロック解除後のみ）
    this._env = null;       // 形式v2: 鍵の包み等（暗号文を除く）。保存のたびにそのまま書く
    this._salt = null;      // パスワードが設定されていれば salt（設定の有無の判定に使う）
    this._asciiPw = false;  // 半角英数字・記号だけのパスワードか（2026.10.22.14 以降に設定したもの）
    this._state = null;     // ロック中は null
    this._changeCbs = [];
    this._chain = Promise.resolve(); // 保存・鍵の作り替えを1つずつ順に行う（途中で混ざらないように）
    this._gen = 0;          // 最後に読んだ／書いた保存データの世代（saveGen）
    this._stale = false;    // 別の画面に先に保存され、この画面の内容が古くなった
    this._channel = null;   // 他の画面への通知（BroadcastChannel）
    this._externalCbs = [];
  }

  // ---------- 起動・ロック ----------

  async init() {
    this._db = await openDb();
    const envelope = await kvGet(this._db, 'state');
    this._gen = genOf(envelope);
    this._openChannel();
    if (envelope && envelope.v === 2) {
      const { enc, saveGen, ...env } = envelope;
      this._env = env;
      this._salt = (env.kdf && env.kdf.pw && env.kdf.pw.salt) || 'v2';
      this._asciiPw = !!env.ascii;
      this._state = null; // パスワード入力待ち
    } else if (envelope && (envelope.enc || envelope.v)) {
      // 形式v1（または未知の新しい形式）。未知の形式を空データとして扱わない
      this._salt = envelope.salt || 'unknown';
      this._asciiPw = !!envelope.ascii;
      this._state = null; // パスワード入力待ち
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

  /** パスワードでロック解除。成功で true。 */
  async unlock(pass) {
    const envelope = await kvGet(this._db, 'state');
    if (!envelope || !(envelope.enc || envelope.v)) return true;
    try {
      if (envelope.v === 2) {
        const { enc, saveGen, ...env } = envelope;
        const dk = await this._openDk(env, 'pw', pass);
        const state = await decryptJson(dk, enc, aad('state', env.gen));
        this._dk = dk;
        this._env = env;
        this._key = null;
        this._state = Object.assign(emptyState(), state);
        this._gen = genOf(envelope);
        this._stale = false; // 最新の保存データを読んだ
        return true;
      }
      if (envelope.v) return false; // 未知の新しい形式（新しい版のアプリで開いてください）
      const key = await deriveKey(pass, envelope.salt);
      const state = await decryptJson(key, envelope.enc);
      this._key = key;
      this._state = Object.assign(emptyState(), state);
      this._gen = genOf(envelope);
      this._stale = false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /** v2: パスワード（purpose='pw'）または復旧コード（'rc'）でデータ鍵を開く。生バイトはすぐ消す */
  async _openDk(env, purpose, secret) {
    const raw = await this._openDkRaw(env, purpose, secret);
    try { return await importDk(raw); } finally { raw.fill(0); }
  }

  async _openDkRaw(env, purpose, secret) {
    const wrap = purpose === 'pw' ? env.wrapPw : env.wrapRc;
    const kdf = env.kdf && (purpose === 'pw' ? env.kdf.pw : env.kdf.rc);
    if (!wrap || !kdf) throw new Error('復旧コードが発行されていません');
    const value = purpose === 'rc' ? normalizeRecoveryCode(secret) : secret;
    return openBytes(await kekFrom(value, kdf), wrap, aad(purpose, env.gen));
  }

  /** 今のパスワードが正しいか（v1・v2とも）。正しくなければ例外 */
  async _checkCurrent(pass) {
    const envelope = await kvGet(this._db, 'state');
    if (!envelope || !(envelope.enc || envelope.v)) return;
    try {
      if (envelope.v === 2) {
        const raw = await this._openDkRaw(envelope, 'pw', pass);
        raw.fill(0);
        return;
      }
      await decryptJson(await deriveKey(pass, envelope.salt), envelope.enc);
    } catch (e) {
      throw new Error('今のパスワードが違います');
    }
  }

  // ---------- パスワード・復旧コード（DESIGN.md §15） ----------
  // 鍵を作り替える処理は「新しい包みを作る → 新しい鍵で開けるか確かめる → 1回で保存 → 保存完了後に切り替え」の順。
  // 復旧コードを伴うものは、利用者がコードを控えた（貼り付けて照合した）あとで commit() する。それまで何も変わらない。

  hasRecovery() {
    return !!(this._env && this._env.wrapRc);
  }

  recoveryIssuedAt() {
    return (this._env && this._env.rcIssuedAt) || '';
  }

  /**
   * 新しいデータ鍵・パスワード・復旧コードで作り直す準備。戻り値 {code, commit()}。
   * stateFn: 保存する内容（commit 時点の値を使う）。password: 新しい（または今の）パスワード。
   */
  _prepareNewDk(password, stateFn, onCommitted) {
    const code = newRecoveryCode();
    const commit = () => this._serial(async () => {
      const gen = toB64(randBytes(9));
      const raw = randBytes(32);
      try {
        const env = {
          v: 2, gen, ascii: PASSWORD_RE.test(password), rcIssuedAt: nowIso(),
          kdf: { pw: { salt: toB64(randBytes(16)), iter: KDF_ITER_PW }, rc: { salt: toB64(randBytes(16)), iter: KDF_ITER_RC } }
        };
        env.wrapPw = await sealBytes(await kekFrom(password, env.kdf.pw), raw, aad('pw', gen));
        env.wrapRc = await sealBytes(await kekFrom(normalizeRecoveryCode(code), env.kdf.rc), raw, aad('rc', gen));
        // 新しい包みから同じ鍵が取り出せるか確かめる
        const back1 = await this._openDkRaw(env, 'pw', password);
        const back2 = await this._openDkRaw(env, 'rc', code);
        const ok = sameBytes(back1, raw) && sameBytes(back2, raw);
        back1.fill(0); back2.fill(0);
        if (!ok) throw new Error('鍵の確認に失敗しました（何も変更していません）');
        const dk = await importDk(raw);
        const state = stateFn();
        const enc = await encryptJson(dk, state, aad('state', gen));
        await decryptJson(dk, enc, aad('state', gen)); // 暗号文が開けることを確かめてから保存
        await this._write({ ...env, enc }); // 別の画面が先に保存していたら、ここで止まる（何も変わらない）
        // 保存が完了してから切り替える
        this._dk = dk; this._env = env; this._key = null; this._salt = env.kdf.pw.salt; this._asciiPw = env.ascii;
        this._state = state;
        this._broadcast('key-changed');
        if (onCommitted) onCommitted();
      } finally {
        raw.fill(0);
      }
    });
    return { code, commit };
  }

  /** パスワードを初めて設定する（暗号化していない端末）。{code, commit()} を返す */
  async setupPassword(newPw) {
    this._requireUnlocked();
    if (await this.hasPassphrase()) throw new Error('パスワードは設定済みです');
    checkNewPassword(newPw);
    return this._prepareNewDk(newPw, () => this._state);
  }

  /**
   * パスワードを変える。v2 はデータ鍵・復旧コードをそのままに包みだけ作り替える（{code:null, commit()}）。
   * 古い形式（v1）は新しい形式へ移すため、復旧コードも発行する（{code, commit()}）。
   */
  async changePassword(currentPw, newPw) {
    this._requireUnlocked();
    checkNewPassword(newPw);
    await this._checkCurrent(currentPw);
    if (!this._env) return this._prepareNewDk(newPw, () => this._state);
    const commit = () => this._serial(async () => {
      const raw = await this._openDkRaw(this._env, 'pw', currentPw);
      try {
        const env = { ...this._env, ascii: true, kdf: { ...this._env.kdf, pw: { salt: toB64(randBytes(16)), iter: KDF_ITER_PW } } };
        env.wrapPw = await sealBytes(await kekFrom(newPw, env.kdf.pw), raw, aad('pw', env.gen));
        const back = await this._openDkRaw(env, 'pw', newPw);
        const ok = sameBytes(back, raw);
        back.fill(0);
        if (!ok) throw new Error('鍵の確認に失敗しました（何も変更していません）');
        const enc = await encryptJson(this._dk, this._state, aad('state', env.gen));
        await this._write({ ...env, enc });
        this._env = env; this._salt = env.kdf.pw.salt; this._asciiPw = true;
        this._broadcast('key-changed');
      } finally {
        raw.fill(0);
      }
    });
    return { code: null, commit };
  }

  /** 復旧コードを発行（再発行）する。データ鍵ごと作り替え、古い復旧コードは使えなくなる。{code, commit()} */
  async issueRecoveryCode(currentPw) {
    this._requireUnlocked();
    await this._checkCurrent(currentPw);
    return this._prepareNewDk(currentPw, () => this._state);
  }

  /** 暗号化をやめる（今のパスワードが必要） */
  async disableEncryption(currentPw) {
    this._requireUnlocked();
    await this._checkCurrent(currentPw);
    await this._serial(async () => {
      await this._write({ plain: this._state });
      this._dk = null; this._env = null; this._key = null; this._salt = null; this._asciiPw = false;
      this._broadcast('key-changed');
    });
  }

  /**
   * パスワードを忘れたとき: 復旧コードでデータを開く。成功したら finish(新しいパスワード) で
   * 新しいデータ鍵・パスワード・復旧コードを準備する（{code, commit()}。commit するとロック解除状態になる）。
   */
  async beginRecovery(code) {
    const envelope = await kvGet(this._db, 'state');
    if (!envelope || envelope.v !== 2 || !envelope.wrapRc) throw new Error('この端末では復旧コードが発行されていません');
    let state;
    try {
      const { enc, ...env } = envelope;
      const dk = await this._openDk(env, 'rc', code);
      state = Object.assign(emptyState(), await decryptJson(dk, enc, aad('state', env.gen)));
      this._gen = genOf(envelope); // この内容を元に作り直す（その後に別の画面が保存していれば commit で止まる）
      this._stale = false;
    } catch (e) {
      throw new Error('復旧コードが違います');
    }
    return {
      finish: (newPw) => {
        checkNewPassword(newPw);
        return this._prepareNewDk(newPw, () => state);
      }
    };
  }

  /**
   * パスワードを忘れたとき: この端末のLexManagerデータをすべて消して初期状態に戻す。
   * PC（OneDrive上のデータ）は消えない。PCにまだ送っていない変更とOneDriveの接続設定は失われる。
   */
  async resetDevice() {
    if (this._db) this._db.close();
    this._db = null;
    this._state = null;
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onblocked = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** 入力欄を半角英数字・記号に制限してよいか（以前に全角を含む「合言葉」を設定した端末では制限しない） */
  passwordIsAscii() {
    return this._asciiPw;
  }

  /** パスワードが正しいか（自動ロックの解除用。データは読み込み済みのまま） */
  async verifyPassphrase(pass) {
    try {
      await this._checkCurrent(pass);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 自動ロックまでの分数（0=しない）。パスワードを設定しているときだけ有効 */
  getAutoLockMinutes() {
    const m = this._state && this._state.autoLockMinutes;
    return typeof m === 'number' ? m : 10;
  }

  async setAutoLockMinutes(m) {
    this._requireUnlocked();
    this._state.autoLockMinutes = Number(m) || 0;
    await this._persist();
  }

  /** 保存・鍵の作り替えを1つずつ順に実行する（前の処理が失敗しても次は動く） */
  _serial(fn) {
    const p = this._chain.then(fn, fn);
    this._chain = p.catch(() => {});
    return p;
  }

  async _persist() {
    return this._serial(() => this._persistNow());
  }

  /** 今の状態を保存する（_serial の内側から呼ぶ） */
  async _persistNow() {
    if (!this._state) throw new Error('パスワードを入力してロックを解除してください');
    if (this._dk && this._env) {
      await this._write({ ...this._env, enc: await encryptJson(this._dk, this._state, aad('state', this._env.gen)) });
    } else if (this._key) {
      await this._write({ salt: this._salt, ascii: this._asciiPw, enc: await encryptJson(this._key, this._state) });
    } else if (this._salt) {
      throw new Error('保存できません（暗号化の鍵がありません）'); // 暗号化している端末に平文で書かない
    } else {
      await this._write({ plain: this._state });
    }
    this._broadcast('saved');
  }

  /**
   * 保存データを書き込む（_serial の内側から呼ぶ）。直前に IndexedDB 上の世代を確かめ、
   * 自分が最後に読んだ／書いた世代と違えば（別の画面が先に保存した）書かずに例外にする。
   */
  async _write(envelope) {
    const onDisk = genOf(await kvGet(this._db, 'state'));
    if (onDisk !== this._gen) { this._stale = true; throw new Error(STALE_MESSAGE); }
    const next = this._gen + 1;
    await kvPut(this._db, 'state', { ...envelope, saveGen: next });
    this._gen = next; // 書き込みが完了してから進める（失敗したら元のまま）
  }

  // ---------- 他の画面（タブ）との連絡 ----------

  _openChannel() {
    if (this._channel || typeof BroadcastChannel !== 'function') return;
    try {
      this._channel = new BroadcastChannel(DB_NAME);
      if (this._channel.unref) this._channel.unref(); // Node（テスト）で終了を妨げない。ブラウザには無い
      this._channel.onmessage = (ev) => {
        const msg = ev && ev.data;
        if (!msg || !msg.type) return;
        // 別の画面が保存した（世代が自分と違う）→ この画面の内容は古い。以後の保存は止める
        if (msg.gen !== this._gen) this._stale = true;
        for (const cb of this._externalCbs) {
          try { cb(msg); } catch (e) { /* ignore */ }
        }
      };
    } catch (e) {
      this._channel = null; // 使えない環境では通知なし（保存時の世代確認は働く）
    }
  }

  _broadcast(type) {
    try { if (this._channel) this._channel.postMessage({ type, gen: this._gen }); } catch (e) { /* ignore */ }
  }

  /** 別の画面で保存（type:'saved'）・鍵の作り替え（type:'key-changed'）があったときに cb(msg) を呼ぶ */
  onExternalChange(cb) {
    this._externalCbs.push(cb);
    return () => { this._externalCbs = this._externalCbs.filter((c) => c !== cb); };
  }

  /** 書き込む前の確認: ロック解除済みで、別の画面に先を越されていない（古い内容のまま変更しない） */
  _requireUnlocked() {
    this._requireReadable();
    if (this._stale) throw new Error(STALE_MESSAGE);
  }

  /** 読むだけの確認（別の画面で更新されていても、表示はできるようにする） */
  _requireReadable() {
    if (!this._state) throw new Error('パスワードを入力してロックを解除してください');
  }

  /** 別の画面で更新され、この画面の内容が古くなったか（自動同期はこの間止める） */
  isStale() {
    return !!this._stale;
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
    this._requireReadable();
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

  /**
   * PCが作った mobile/snapshot.json を読み込み、端末内を置き換える。
   * onlyIfNoUnexported: true なら（自動同期）、置き換える直前に未送信の変更を確かめ、あれば読み込まずに
   * {ok:false, skipped:true} を返す（確かめてから置き換えるまでの間に保存が割り込まないよう、_serial の内側で行う）。
   */
  async importSnapshot(file, { onlyIfNoUnexported = false } = {}) {
    this._requireUnlocked();
    let snap;
    try {
      snap = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('ファイルを読み取れません（JSON形式ではありません）');
    }
    if (!snap || snap.format !== 'lexmanager-snapshot') {
      throw new Error('PCのデータのファイル（OneDriveの「LexManagerData」フォルダの「mobile」にある snapshot.json）を選んでください（形式が違います）');
    }
    const next = { clients: {}, cases: {}, todos: {} };
    for (const coll of COLLS) for (const rec of snap[coll] || []) if (rec && rec.id) next[coll][rec.id] = rec;
    const KEYS = ['records', 'base', 'snapshotStamp', 'snapshotAt', 'gcalStatus', 'lastExportSig'];
    const done = await this._serial(async () => {
      this._requireUnlocked();
      if (onlyIfNoUnexported && await this.hasUnexportedChanges()) return false; // 直前に変更が入った: 読み込まない
      const prev = Object.fromEntries(KEYS.map((k) => [k, this._state[k]]));
      this._state.records = clone(next);
      this._state.base = clone(next);
      this._state.snapshotStamp = snap.stamp || '';
      this._state.snapshotAt = snap.exportedAt || nowIso();
      this._state.gcalStatus = snap.gcal || null; // PCのGoogleカレンダー連携の状態（表示用）
      this._state.lastExportSig = '';
      try {
        await this._persistNow();
      } catch (e) {
        Object.assign(this._state, prev); // 保存できなければ元に戻す（画面と保存データを食い違わせない）
        throw e;
      }
      return true;
    });
    if (!done) return { ok: false, skipped: true };
    this._notifyChange();
    return { ok: true, counts: { clients: (snap.clients || []).length, cases: (snap.cases || []).length, todos: (snap.todos || []).length } };
  }

  /** 前回PCデータを読み込んで以降の変更一覧。 */
  _computeChanges() {
    this._requireReadable();
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

  /** まだ書き出していない変更があるか（書き出し後にさらに変えた場合も true）。 */
  async hasUnexportedChanges() {
    const changes = this._computeChanges();
    if (!changes.length) return false;
    return JSON.stringify(changes) !== this._state.lastExportSig;
  }

  /** PCのGoogleカレンダー連携の状態（OneDriveから直接読んだもの → なければPCデータに含まれていたもの） */
  getGcalStatus() {
    const od = this.getOd();
    return od.gcal || (this._state && this._state.gcalStatus) || null;
  }

  getSyncInfo() {
    return this._state
      ? { snapshotAt: this._state.snapshotAt, lastExportAt: this._state.lastExportAt }
      : { snapshotAt: '', lastExportAt: '' };
  }

  // ---------- OneDrive自動同期の設定・状態（端末内に保存。パスワードがあれば暗号化される） ----------
  // {clientId, root, accessToken, accessExpiresAt, refreshToken, uploads:[{name,at}], lastSentAt, snapshotModified,
  //  lastSync, lastError, needLogin, waiting}

  getOd() {
    return (this._state && this._state.od) || {};
  }

  async setOd(patch) {
    this._requireUnlocked();
    this._state.od = { ...(this._state.od || {}), ...patch };
    await this._persist();
  }

  async clearOd() {
    this._requireUnlocked();
    const keep = this._state.od || {};
    this._state.od = { clientId: keep.clientId, root: keep.root };
    await this._persist();
  }

  /** 前回PCデータを読み込んで以降の変更を、PCが取り込む形式にする（書き出しはしない）。 */
  exportPayload() {
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
    return { payload, filename, count: changes.length, sig: JSON.stringify(changes) };
  }

  /** exportPayload の内容を書き出し済みとして記録する */
  async markExported(ex) {
    this._state.lastExportAt = ex.payload.exportedAt;
    this._state.lastExportSig = ex.sig;
    await this._persist();
  }

  async exportChanges() {
    const ex = this.exportPayload();
    const { payload, filename } = ex;
    const changes = payload.changes;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });

    let method = 'download';
    const fileObj = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
      try {
        await navigator.share({ files: [fileObj], title: 'LexManager 変更データ' });
        method = 'share';
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('書き出しを取り消しました');
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
