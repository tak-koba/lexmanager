// web/js/ui/toast.js
// 画面右下にスタック表示するトースト通知。依存なし。

function getRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.style.position = 'fixed';
    root.style.right = '16px';
    root.style.bottom = '16px';
    root.style.zIndex = '9999';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '8px';
    root.style.pointerEvents = 'none';
    document.body.appendChild(root);
  }
  return root;
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 */
export function showToast(message, type = 'info') {
  const root = getRoot();
  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  toastEl.textContent = message;
  toastEl.style.pointerEvents = 'auto';
  toastEl.style.opacity = '0';
  toastEl.style.transition = 'opacity 0.2s ease';

  root.appendChild(toastEl);

  // フェードイン
  requestAnimationFrame(() => {
    toastEl.style.opacity = '1';
  });

  const REMOVE_AFTER_MS = 3000;
  const FADE_MS = 200;

  setTimeout(() => {
    toastEl.style.opacity = '0';
    setTimeout(() => {
      toastEl.remove();
    }, FADE_MS);
  }, REMOVE_AFTER_MS);
}
