// LexManager 4 - application bootstrap: storage init, hash router, shared ctx.

import { getStore } from './api.js';
import { showToast } from './ui/toast.js';
import { openDialog, confirmDialog } from './ui/dialog.js';
import { showLockScreen, isLockShown, IdleWatcher, asciiPasswordInput } from './lock.js';

const viewRoot = document.getElementById('view-root');

const ROUTES = [
  { pattern: /^#\/home\/?$/, view: 'home', params: () => ({}) },
  { pattern: /^#\/clients\/?$/, view: 'clients', params: () => ({}) },
  { pattern: /^#\/clients\/([^/]+)\/?$/, view: 'client-detail', params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { pattern: /^#\/cases\/?$/, view: 'cases', params: () => ({}) },
  { pattern: /^#\/cases\/([^/]+)\/?$/, view: 'case-detail', params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { pattern: /^#\/todos\/?$/, view: 'todos', params: () => ({}) },
  { pattern: /^#\/tools\/?$/, view: 'tools', params: () => ({}) },
  { pattern: /^#\/tools\/([^/]+)\/?$/, view: 'tools', params: (m) => ({ tool: decodeURIComponent(m[1]) }) },
  { pattern: /^#\/settings\/?$/, view: 'settings', params: () => ({}) },
  { pattern: /^#\/search(?:\?(.*))?$/, view: 'search', params: (m) => Object.fromEntries(new URLSearchParams(m[1] || '')) }
];

const state = {
  store: null,
  data: { clients: [], cases: [], todos: [] },
  currentView: null,
  currentUnsavedCheck: null
};

function isLocalMode() {
  const { protocol, hostname } = window.location;
  if (hostname === '127.0.0.1' || hostname === 'localhost') return false;
  return protocol === 'https:' || hostname.endsWith('.github.io');
}

function matchRoute(hash) {
  for (const route of ROUTES) {
    const m = hash.match(route.pattern);
    if (m) return { view: route.view, params: route.params(m) };
  }
  return null;
}

function setActiveNav(hash) {
  const base = '#/' + (hash.replace(/^#\//, '').split(/[/?]/)[0] || 'home');
  document.querySelectorAll('.nav-link, .tab-link').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('data-hash') === base);
  });
}

async function refreshData() {
  state.data = await state.store.all();
  return state.data;
}

// 画面内（ダイアログ以外）の編集フォームに入力があれば「未保存あり」とみなす
function hasDirtyForm() {
  return [...viewRoot.querySelectorAll('form')].some((f) => f.dataset.dirty === '1' && f.isConnected);
}
viewRoot.addEventListener('input', (e) => {
  const f = e.target.closest && e.target.closest('form');
  if (f) f.dataset.dirty = '1';
});
viewRoot.addEventListener('change', (e) => {
  const f = e.target.closest && e.target.closest('form');
  if (f) f.dataset.dirty = '1';
});
window.addEventListener('beforeunload', (e) => {
  if (hasDirtyForm()) { e.preventDefault(); e.returnValue = ''; }
});

function buildCtx() {
  return {
    store: state.store,
    caps: state.store.capabilities,
    toast: (msg, type) => showToast(msg, type),
    confirm: (msg) => confirmDialog(msg),
    navigate: (hash) => {
      if (location.hash === hash) {
        render();
      } else {
        location.hash = hash;
      }
    },
    openDialog: (opts) => openDialog(opts),
    getData: () => state.data,
    // iPhone版のOneDrive自動同期（未接続・PC版では null）
    get autosync() { return state.autosync || null; },
    // 画面ロック: 設定を変えたら呼ぶ（自動ロックの時間を反映）／今すぐロック
    lockConfigChanged: () => setupLock(),
    lockNow: () => lockNow(),
    refresh: async () => {
      await refreshData();
      return state.data;
    },
    // 現在の画面（一覧｜詳細の両ペイン）を描き直す。保存後に一覧側の表示も更新するため。
    rerender: () => render({ force: true }),
    unsavedGuard: {
      set(checkFn) {
        state.currentUnsavedCheck = checkFn;
      },
      clear() {
        state.currentUnsavedCheck = null;
      },
      async check() {
        const custom = typeof state.currentUnsavedCheck === 'function' && state.currentUnsavedCheck();
        if (!custom && !hasDirtyForm()) return true;
        return confirmDialog('保存されていない変更があります。移動しますか？');
      }
    }
  };
}

// 一覧｜詳細の2ペイン表示（幅が狭いときはCSSでどちらか一方だけ表示）
const PANES = {
  'clients': { list: 'clients', detail: null, label: '顧客', hash: '#/clients' },
  'client-detail': { list: 'clients', detail: 'client-detail', label: '顧客', hash: '#/clients' },
  'cases': { list: 'cases', detail: null, label: '案件', hash: '#/cases' },
  'case-detail': { list: 'cases', detail: 'case-detail', label: '案件', hash: '#/cases' }
};

// 「戻る」の表示名（直前の画面の種類 → 名前）
const BACK_LABELS = {
  home: 'ホーム', todos: 'ToDo', clients: '顧客一覧', cases: '案件一覧', 'client-detail': '顧客',
  'case-detail': '案件', search: '検索結果', tools: 'ツール', settings: '設定'
};

/**
 * 詳細画面の戻るボタン。別の画面（ToDo・ホーム・別の詳細等）から来たときは「← ○○に戻る」で直前の画面へ
 * （ホーム画面に追加したiPhoneアプリにはブラウザの戻るボタンがないため）。同じ一覧から来たときは一覧へのリンク（狭い画面のみ表示）。
 */
function buildBackLink(pane, fromHash) {
  const from = fromHash ? matchRoute(fromHash) : null;
  if (from && from.view !== pane.list && PANES[from.view] !== pane) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-small back-link back-link-return';
    btn.textContent = `← ${BACK_LABELS[from.view] || '前の画面'}に戻る`;
    btn.addEventListener('click', () => history.back());
    return btn;
  }
  const back = document.createElement('a');
  back.className = 'btn btn-small back-link';
  back.href = pane.hash;
  back.textContent = `← ${pane.label}一覧`;
  return back;
}

async function renderTwoPane(pane, match, ctx, fromHash) {
  const wrap = document.createElement('div');
  wrap.className = 'two-pane' + (pane.detail ? ' has-detail' : '');
  const left = document.createElement('div');
  left.className = 'pane-list';
  const right = document.createElement('div');
  right.className = 'pane-detail';
  wrap.append(left, right);
  viewRoot.appendChild(wrap);

  const listMod = await import(`./views/${pane.list}.js`);
  const jobs = [listMod.render(left, { activeId: match.params.id }, ctx)];
  if (pane.detail) {
    right.appendChild(buildBackLink(pane, fromHash));
    const body = document.createElement('div');
    right.appendChild(body);
    const detailMod = await import(`./views/${pane.detail}.js`);
    jobs.push(detailMod.render(body, match.params, ctx));
  } else {
    const ph = document.createElement('div');
    ph.className = 'pane-placeholder';
    ph.textContent = `左の一覧から${pane.label}を選んでください`;
    right.appendChild(ph);
  }
  await Promise.all(jobs);
}

let lastHash = null;

async function render({ force = false } = {}) {
  const hash = location.hash || '#/home';
  const match = matchRoute(hash) || matchRoute('#/home');

  const ctx = buildCtx();
  if (!force && hash !== lastHash) {
    const guardOk = await ctx.unsavedGuard.check();
    if (!guardOk) {
      // 移動を取り消して元の画面に留まる
      if (lastHash) history.replaceState(null, '', lastHash);
      return;
    }
  }
  ctx.unsavedGuard.clear();
  lastHash = hash;
  setActiveNav(hash);

  const scrollY = hash === lastRenderedHash ? window.scrollY : 0;
  // 直前の画面（同じ画面の再描画ではそのまま引き継ぐ）。詳細画面の「← ○○に戻る」に使う
  if (hash !== lastRenderedHash) fromHash = lastRenderedHash;
  lastRenderedHash = hash;
  viewRoot.innerHTML = '';
  try {
    state.currentView = match.view;
    const pane = PANES[match.view];
    if (pane) {
      await renderTwoPane(pane, match, ctx, fromHash);
    } else {
      const mod = await import(`./views/${match.view}.js`);
      await mod.render(viewRoot, match.params, ctx);
    }
    window.scrollTo(0, scrollY);
  } catch (err) {
    console.error('view load error', err);
    viewRoot.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'error-state';
    box.textContent = `画面の読み込みに失敗しました: ${(err && err.message) || err}`;
    // 更新直後に新旧のファイルが混ざった場合などは、保存済みの画面ファイルを捨てて読み直せば直る
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.style.marginTop = '12px';
    retry.textContent = '最新の画面を読み込み直す';
    retry.addEventListener('click', reloadFresh);
    box.appendChild(document.createElement('br'));
    box.appendChild(retry);
    viewRoot.appendChild(box);
  }
}

/** 保存済みの画面ファイル（Service Worker のキャッシュ）を消して読み直す。データ（IndexedDB）は消さない。 */
async function reloadFresh() {
  try {
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(() => {});
    }
  } catch (e) {
    console.warn('cache clear failed', e);
  }
  location.reload();
}
let lastRenderedHash = null;
let fromHash = null;

function wireNav() {
  document.querySelectorAll('.nav-link, .tab-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      // let default hash navigation happen; just close mobile sidebar if open
      document.body.classList.remove('sidebar-open');
    });
  });
  const toggle = document.getElementById('navToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });
  }
}

function wireSearch() {
  const input = document.getElementById('globalSearchInput');
  if (!input) return;
  // タッチ端末（iPhone・iPad等）にはキーボードショートカットの案内を出さない
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) input.placeholder = '顧客・案件・ToDoを検索';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }
  });
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const q = input.value.trim();
      if (!location.hash.startsWith('#/search')) {
        location.hash = `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`;
      }
      setTimeout(() => input.focus(), 0);
    }
  });
}

async function registerServiceWorkerIfNeeded() {
  if (!isLocalMode()) return;
  if (!('serviceWorker' in navigator)) return;
  // 新しい版が有効になったら、画面を1回だけ読み直す（読み込み済みの古いファイルと新しいファイルを混ぜないため）。
  // 未保存の入力があるときは読み直さず、次に開いたときに反映する。
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      const unsaved = hasDirtyForm() || (typeof state.currentUnsavedCheck === 'function' && state.currentUnsavedCheck());
      if (unsaved) { showToast('アプリが更新されました。保存後に開き直すと反映されます', 'info'); return; }
      reloaded = true;
      location.reload();
    });
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // ホーム画面のアプリは開きっぱなしになりやすいので、前面に戻ったときにも更新を確認する
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (e) {
    console.warn('service worker registration failed', e);
  }
}

// パスワードで保護されたiPhone内データのロック解除
async function unlockLoop(store) {
  viewRoot.innerHTML = '';
  const box = document.createElement('form');
  box.className = 'section quick-form';
  box.style.maxWidth = '420px';
  box.style.margin = '40px auto';
  box.innerHTML = '<h2>ロック解除</h2><p class="text-muted">この端末のLexManagerデータはパスワードで保護されています。</p>' +
    '<label>パスワード<input type="password" autocomplete="current-password" required></label>' +
    '<p class="text-error" aria-live="polite"></p><button class="btn btn-primary" type="submit">開く</button>' +
    '<button class="btn-link lock-forgot" type="button">パスワードを忘れた場合</button>';
  viewRoot.appendChild(box);
  box.querySelector('.lock-forgot').addEventListener('click', () => forgotIphonePassword(store));
  const input = box.querySelector('input');
  const msg = box.querySelector('.text-error');
  if (store.passwordIsAscii && store.passwordIsAscii()) asciiPasswordInput(input, msg);
  input.focus();
  await new Promise((resolve) => {
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '確認中...';
      if (await store.unlock(input.value)) {
        resolve();
      } else {
        msg.textContent = 'パスワードが違います';
        input.select();
      }
    });
  });
  viewRoot.innerHTML = '';
}

// ---------------- 画面ロック（DESIGN.md §15） ----------------
// PC: パスワード（サーバーで確認。ロック中はサーバーがデータを出さない）。iPhone: パスワード（画面だけ隠し、同期は続ける）。
let idleWatcher = null;

/** PC版でパスワードを忘れたとき: このPCで解除用のファイルを実行してもらう（データには触れない） */
function forgotPcPassword() {
  const body = document.createElement('div');
  body.innerHTML = '<p>このPCで、LexManagerのフォルダにある<strong>「LexManager-lock-reset.bat」</strong>をダブルクリックしてください。ロックが外れます（データは消えません）。</p>' +
    '<p class="text-muted">フォルダ: C:\\Users\\（ユーザー名）\\ClaudeSessions\\DX\\lexmanager-app<br>（コマンドで行う場合: python -m lexmanager lock-reset）</p>' +
    '<p>実行後、LexManagerの画面を開き直すと、パスワードなしで開けます。新しいパスワードは設定画面の「画面ロック」で設定してください。</p>';
  openDialog({ title: 'パスワードを忘れた場合', bodyNode: body, actions: [{ label: '閉じる', primary: true }] });
}

/** iPhone版でパスワードを忘れたとき: この端末のデータを消して初期状態に戻す（PCのデータは残る） */
async function forgotIphonePassword(store) {
  const ok1 = await confirmDialog('パスワードは元に戻せないため、この端末のLexManagerのデータを消して初期状態に戻します。\n\n・PC（事務所PC）のデータは消えません。\n・初期化のあと、設定でOneDriveに接続し直すと、PCの最新データが読み込まれます（アプリケーションIDの入力からやり直しになります）。\n・この端末からPCにまだ送っていない変更は失われます。\n\n初期化しますか？', { okLabel: '初期化へ進む', danger: true });
  if (!ok1) return;
  const ok2 = await confirmDialog('本当に、この端末のLexManagerのデータを消しますか？（元に戻せません）', { okLabel: '消して初期化する', danger: true });
  if (!ok2) return;
  await store.resetDevice();
  location.reload();
}

async function lockNow({ serverAlreadyLocked = false, rerender = serverAlreadyLocked } = {}) {
  if (isLockShown()) return;
  const store = state.store;
  if (store.lockStatus) {
    if (!serverAlreadyLocked) { try { await store.lockScreen(); } catch (e) { /* 既にロック中 */ } }
    await showLockScreen({
      label: 'パスワード',
      onForgot: forgotPcPassword,
      verify: async (pw) => {
        try { await store.unlockScreen(pw); return true; } catch (e) { return e.message; }
      }
    });
    if (rerender) render({ force: true }); // 読み込めなかった画面を読み直す
  } else {
    await showLockScreen({
      label: 'パスワード',
      asciiOnly: !!(store.passwordIsAscii && store.passwordIsAscii()),
      onForgot: () => forgotIphonePassword(store),
      verify: async (pw) => ((await store.verifyPassphrase(pw)) ? true : 'パスワードが違います')
    });
  }
  if (idleWatcher) idleWatcher.reset();
}

/** 自動ロックの準備（起動時と、設定を変えたとき） */
async function setupLock() {
  const store = state.store;
  let minutes = 0;
  if (store.lockStatus) {
    try {
      const st = await store.lockStatus();
      minutes = st.enabled ? st.autoLockMinutes : 0;
    } catch (e) { return; }
  } else if (store.verifyPassphrase && (await store.hasPassphrase())) {
    minutes = store.getAutoLockMinutes();
  }
  if (idleWatcher) { idleWatcher.setMinutes(minutes); return; }
  idleWatcher = new IdleWatcher({
    minutes,
    onIdle: () => lockNow(),
    // PC: 操作があったことをサーバーに伝える（サーバー側の自動ロックまでの時間を延ばす）
    onActivity: () => { if (store.pingLock && idleWatcher && idleWatcher.minutes) store.pingLock().catch(() => {}); }
  });
}

/**
 * iPhone版のOneDrive自動同期を始める（DESIGN.md §14）。Microsoftのログイン画面から戻ったところなら、先にログインを仕上げる。
 * 同期するのは: 開いたとき・保存の数秒後・前面に戻ったとき・5分ごと。
 */
async function startAutoSync(store) {
  const [{ AutoSync }, od] = await Promise.all([import('./autosync.js'), import('./util/onedrive.js')]);
  const cb = od.pendingCallback();
  if (cb) {
    try {
      const tok = await od.finishLogin(cb);
      await store.setOd({ ...tok, needLogin: false, lastError: '' });
      showToast('OneDriveに接続しました。自動同期を始めます', 'success');
    } catch (e) {
      showToast(String(e.message || e), 'error');
    }
  }
  const sync = new AutoSync(store, {
    onStatus: (s, r) => {
      if (r && r.imported) showToast('PCの最新データを読み込みました', 'info');
      if (s.needLogin) document.dispatchEvent(new CustomEvent('lm-sync-status'));
    }
  });
  state.autosync = sync;
  store.onChange(() => sync.soon());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.soon(500); });
  setInterval(() => { if (document.visibilityState === 'visible') sync.run(); }, 5 * 60 * 1000);
  sync.soon(1000);
}

async function bootstrap() {
  viewRoot.innerHTML = '<div class="loading-state">読み込み中...</div>';
  wireNav();
  wireSearch();

  try {
    state.store = await getStore();
  } catch (err) {
    console.error('store init failed', err);
    viewRoot.innerHTML = `<div class="error-state">データの読み込みに失敗しました: ${(err && err.message) || err}</div>`;
    return;
  }

  if (typeof state.store.isLocked === 'function' && state.store.isLocked()) {
    await unlockLoop(state.store);
  }
  // PC版: 画面ロックが設定されていて未解除なら、先にパスワードを聞く
  if (state.store.lockStatus) {
    try {
      const st = await state.store.lockStatus();
      if (st.enabled && !st.unlocked) {
        viewRoot.innerHTML = '';
        await lockNow({ serverAlreadyLocked: true, rerender: false });
      }
    } catch (e) { /* 古いサーバー等: ロックなしとして続ける */ }
    window.addEventListener('lm-locked', () => { if (!isLockShown()) lockNow({ serverAlreadyLocked: true }); });
  }
  await setupLock();

  await refreshData();

  if (typeof state.store.onChange === 'function') {
    state.store.onChange(async () => {
      const prevStamp = JSON.stringify(state.data);
      await refreshData();
      if (JSON.stringify(state.data) !== prevStamp) {
        // 編集中なら画面を差し替えず知らせるだけ（入力内容を守る）
        if (hasDirtyForm() || (typeof state.currentUnsavedCheck === 'function' && state.currentUnsavedCheck())) {
          showToast('他の端末でデータが更新されました。保存時に自動で統合されます', 'info');
        } else {
          render({ force: true });
        }
      }
    });
  }

  await registerServiceWorkerIfNeeded();
  if (state.store.getOd) await startAutoSync(state.store);

  window.addEventListener('hashchange', render);
  if (!location.hash) {
    location.hash = '#/home';
  } else {
    render();
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
