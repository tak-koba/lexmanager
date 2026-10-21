// LexManager 4 - application bootstrap: storage init, hash router, shared ctx.

import { getStore } from './api.js';
import { showToast } from './ui/toast.js';
import { openDialog, confirmDialog } from './ui/dialog.js';

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

// 合言葉で保護されたiPhone内データのロック解除
async function unlockLoop(store) {
  viewRoot.innerHTML = '';
  const box = document.createElement('form');
  box.className = 'section quick-form';
  box.style.maxWidth = '420px';
  box.style.margin = '40px auto';
  box.innerHTML = '<h2>ロック解除</h2><p class="text-muted">この端末のLexManagerデータは合言葉で保護されています。</p>' +
    '<label>合言葉<input type="password" autocomplete="current-password" required></label>' +
    '<p class="text-error" aria-live="polite"></p><button class="btn btn-primary" type="submit">開く</button>';
  viewRoot.appendChild(box);
  const input = box.querySelector('input');
  const msg = box.querySelector('.text-error');
  input.focus();
  await new Promise((resolve) => {
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '確認中...';
      if (await store.unlock(input.value)) {
        resolve();
      } else {
        msg.textContent = '合言葉が違います';
        input.select();
      }
    });
  });
  viewRoot.innerHTML = '';
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

  window.addEventListener('hashchange', render);
  if (!location.hash) {
    location.hash = '#/home';
  } else {
    render();
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
