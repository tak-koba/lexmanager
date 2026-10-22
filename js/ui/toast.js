// web/js/ui/toast.js
// 画面右下にスタック表示するトースト通知。依存なし。
// 表示時間: エラーは8秒、成功・情報は4秒。タップ（クリック）すると、すぐ閉じる。
// 読み上げ: 成功・情報は「区切りのよいところで」（polite）、エラーは「すぐに」（assertive）読み上げる。

const DURATION_MS = { error: 8000, success: 4000, info: 4000 };
const FADE_MS = 200;

/** 通知の置き場（polite 用・assertive 用の2つ。読み上げの優先度を分けるため） */
function getRoot(assertive) {
  const id = assertive ? 'toast-root-alert' : 'toast-root';
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement('div');
    root.id = id;
    document.body.appendChild(root);
  }
  // index.html に置いた空の置き場にも、読み上げの設定を付ける
  if (!root.classList.contains('toast-root')) {
    root.classList.add('toast-root');
    root.setAttribute('role', assertive ? 'alert' : 'status');
    root.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    // 位置は app.css（エラー用は通常の通知の上に積む。--toast-offset で重ならないようにする）
  }
  return root;
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 */
export function showToast(message, type = 'info') {
  const root = getRoot(type === 'error');
  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  toastEl.textContent = message;
  toastEl.title = 'タップで閉じる';
  toastEl.style.opacity = '0';
  toastEl.style.transition = `opacity ${FADE_MS / 1000}s ease`;

  root.appendChild(toastEl);
  syncOffset();

  // フェードイン
  requestAnimationFrame(() => {
    toastEl.style.opacity = '1';
  });

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    toastEl.style.opacity = '0';
    setTimeout(() => {
      toastEl.remove();
      syncOffset();
    }, FADE_MS);
  };
  const timer = setTimeout(close, DURATION_MS[type] || DURATION_MS.info);
  toastEl.addEventListener('click', close);
}

/** エラー用の置き場を、通常の通知の高さ分だけ上にずらす */
function syncOffset() {
  const normal = document.getElementById('toast-root');
  const h = normal && normal.childElementCount ? normal.offsetHeight + 8 : 0;
  document.documentElement.style.setProperty('--toast-offset', `${h}px`);
}
