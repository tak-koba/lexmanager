// web/js/ui/dialog.js
// ネイティブ <dialog> を使ったモーダル。依存なし。

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {Node} opts.bodyNode
 * @param {Array<{label:string, onClick?:Function, primary?:boolean, danger?:boolean}>} opts.actions
 * @param {Function} [opts.onClose]
 * @returns {HTMLDialogElement}
 */
export function openDialog({ title, bodyNode, actions = [], onClose } = {}) {
  const root = document.getElementById('dialog-root') || document.body;

  const dialogEl = document.createElement('dialog');
  dialogEl.className = 'lm-dialog';

  const header = document.createElement('header');
  header.className = 'lm-dialog-header';
  const titleEl = document.createElement('h2');
  titleEl.className = 'lm-dialog-title';
  titleEl.textContent = title || '';
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'lm-dialog-close';
  closeBtn.setAttribute('aria-label', '閉じる');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    dialogEl.close();
  });
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'lm-dialog-body';
  if (bodyNode) body.appendChild(bodyNode);

  const footer = document.createElement('footer');
  footer.className = 'lm-dialog-footer';

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.className = 'lm-btn' + (action.primary ? ' lm-btn-primary' : '') + (action.danger ? ' lm-btn-danger' : '');
    btn.addEventListener('click', async () => {
      let result;
      if (typeof action.onClick === 'function') {
        result = await action.onClick();
      }
      if (result !== 'keep-open') {
        dialogEl.close();
        // close イベントが発火しない環境でも確実に片付ける
        setTimeout(() => { if (!closed) dialogEl.dispatchEvent(new Event('close')); }, 50);
      }
    });
    footer.appendChild(btn);
  }

  dialogEl.appendChild(header);
  dialogEl.appendChild(body);
  dialogEl.appendChild(footer);

  let closed = false;
  dialogEl.addEventListener('close', () => {
    if (closed) return;
    closed = true;
    if (typeof onClose === 'function') onClose();
    dialogEl.remove();
  });

  dialogEl.addEventListener('cancel', () => {
    // Escape キー押下時のデフォルトの close イベントに任せる
  });

  dialogEl.addEventListener('click', (ev) => {
    // バックドロップクリック判定（dialog要素自身がクリックされ、かつ内側の矩形外）
    if (ev.target === dialogEl) {
      const rect = dialogEl.getBoundingClientRect();
      const inside =
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom;
      if (!inside) {
        dialogEl.close();
      }
    }
  });

  root.appendChild(dialogEl);
  dialogEl.showModal();

  return dialogEl;
}

/**
 * @param {string} message
 * @param {{okLabel?:string, cancelLabel?:string, danger?:boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    const bodyNode = document.createElement('p');
    bodyNode.textContent = message;

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    openDialog({
      title: '確認',
      bodyNode,
      actions: [
        {
          label: cancelLabel,
          onClick: () => finish(false),
        },
        {
          label: okLabel,
          primary: !danger,
          danger,
          onClick: () => finish(true),
        },
      ],
      onClose: () => finish(false),
    });
  });
}

/**
 * forms.js 側の guardNavigation で代替可能なため、必要になった場合のみ実装する簡易版。
 * @param {Function} navigateAwayFn
 */
export function promptUnsavedGuard(navigateAwayFn) {
  if (typeof navigateAwayFn === 'function') navigateAwayFn();
}
