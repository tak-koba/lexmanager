// web/js/lock.js
// 画面ロック（DESIGN.md §15）。ロック画面と、一定時間操作がないときの自動ロック。
// ロック画面は最前面のダイアログで画面全体を隠す（下の画面は消さないので、入力途中の内容は解除後も残る）。
import { el } from './ui/dom.js';

let current = null; // 表示中のロック画面 { promise }

/** パスワードに使える文字: 半角の英数字と記号（空白・全角は不可） */
export const PASSWORD_RE = /^[\x21-\x7E]+$/;
export const PASSWORD_RULE = '半角の英数字と記号だけ使えます';

/** パスワード欄を「半角英数字・記号だけ入力できる」ようにする（それ以外の文字は入力した時点で取り除く） */
export function asciiPasswordInput(input, hintEl) {
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.addEventListener('input', () => {
    const cleaned = input.value.replace(/[^\x21-\x7E]/g, '');
    if (cleaned !== input.value) {
      input.value = cleaned;
      if (hintEl) hintEl.textContent = `パスワードは${PASSWORD_RULE}`;
    }
  });
  return input;
}

/**
 * 復旧コードを表示し、控えたことを確かめる（コード全体を貼り付けて照合）。照合できたら true、やめたら false。
 * まだ有効になっていない（呼び出し側が true を受けてから保存する）ことを画面で明示する。
 */
export function showRecoveryCodeDialog(code, { normalize, deviceLabel = 'このiPhone' } = {}) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'lm-dialog recovery-dialog', 'aria-labelledby': 'lm-recovery-title' });
    dlg.addEventListener('cancel', (e) => e.preventDefault());
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const body = el('div', { class: 'lm-dialog-body' });
    const footer = el('div', { class: 'lm-dialog-footer' });
    dlg.appendChild(el('div', { class: 'lm-dialog-header' }, [el('div', { class: 'lm-dialog-title', id: 'lm-recovery-title' }, '復旧コード（まだ有効になっていません）')]));
    dlg.appendChild(body);
    dlg.appendChild(footer);

    function step1() {
      body.replaceChildren(
        el('p', {}, `パスワードを忘れたときに、${deviceLabel}のデータを消さずに開き直すためのコードです。印刷するか、パスワード管理アプリ（iPhoneの「パスワード」アプリ等）に保存してください。`),
        el('div', { class: 'recovery-code', 'aria-label': '復旧コード' }, code),
        el('p', { class: 'text-muted' }, `${deviceLabel}専用のコードです（発行日: ${new Date().toLocaleDateString('ja-JP')}）。この画面を閉じると二度と表示できません。`)
      );
      const copyBtn = el('button', { type: 'button', class: 'btn', onClick: async () => {
        try { await navigator.clipboard.writeText(code); copyBtn.textContent = 'コピーしました'; } catch (e) { copyBtn.textContent = 'コピーできませんでした（手で書き写してください）'; }
        setTimeout(() => { copyBtn.textContent = 'コピー'; }, 3000); // 数秒で元の表示に戻す（もう一度押せると分かるように）
      } }, 'コピー');
      footer.replaceChildren(
        el('button', { type: 'button', class: 'btn', onClick: () => done(false) }, 'やめる（何も変更しない）'),
        copyBtn,
        el('button', { type: 'button', class: 'btn btn-primary', onClick: step2 }, '控えました → 確認へ')
      );
    }

    function step2() {
      const input = el('input', { type: 'text', class: 'field', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: '控えた復旧コードを貼り付け（または入力）' });
      const err = el('p', { class: 'text-error', 'aria-live': 'polite' });
      body.replaceChildren(
        el('p', {}, '控えた復旧コードを、保存先から貼り付けてください（正しく控えられたかの確認です）。'),
        input, err
      );
      footer.replaceChildren(
        el('button', { type: 'button', class: 'btn', onClick: step1 }, '← コードをもう一度見る'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: () => {
          if (normalize(input.value) === normalize(code)) done(true);
          else err.textContent = '一致しません。保存したコードを確かめてください。';
        } }, '一致を確認して有効にする')
      );
      input.focus();
    }

    document.body.appendChild(dlg);
    dlg.showModal();
    step1();
  });
}

export function isLockShown() {
  return !!current;
}

/**
 * ロック画面を出し、解除されたら resolve する。
 * verify(入力値) は true（解除）か、エラー文（文字列）を返す。
 */
export function showLockScreen({ label = 'パスワード', message = '', verify, asciiOnly = true, onForgot = null }) {
  if (current) return current.promise;
  const input = el('input', { type: 'password', class: 'field', autocomplete: 'current-password', 'aria-label': label });
  const err = el('p', { class: 'text-error', 'aria-live': 'polite' });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'ロック解除');
  if (asciiOnly) asciiPasswordInput(input, err);
  const form = el('form', { class: 'lock-form' }, [
    el('div', { class: 'lock-icon', 'aria-hidden': 'true' }, '🔒'),
    el('h2', { id: 'lm-lock-title' }, 'LexManagerはロック中です'),
    message ? el('p', { class: 'text-muted' }, message) : null,
    el('label', {}, [label, input]),
    err,
    submit,
    // onForgot が true を返したら（復旧コードで開き直せたら）ロック画面を閉じる
    onForgot ? el('button', { type: 'button', class: 'btn-link lock-forgot', onClick: async () => { if ((await onForgot()) === true) finish(); } }, 'パスワードを忘れた場合') : null
  ]);
  let finish = () => {};
  const dlg = el('dialog', { class: 'lm-dialog lock-dialog', 'aria-labelledby': 'lm-lock-title' }, form);
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Escで閉じない
  document.body.appendChild(dlg);
  dlg.showModal();
  input.focus();
  const promise = new Promise((resolve) => {
    finish = () => {
      dlg.close();
      dlg.remove();
      current = null;
      resolve();
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value) { err.textContent = `${label}を入力してください`; return; }
      submit.disabled = true;
      err.textContent = '確認しています…';
      let r;
      try { r = await verify(input.value); } catch (ex) { r = String(ex.message || ex); }
      submit.disabled = false;
      if (r === true) {
        finish();
      } else {
        err.textContent = typeof r === 'string' ? r : `${label}が違います`;
        input.select();
      }
    });
  });
  current = { promise };
  return promise;
}

/**
 * 一定時間操作がなければ onIdle を呼ぶ。操作があれば（最短 activityEveryMs ごとに）onActivity を呼ぶ。
 * スリープ・アプリ切替から戻ったときも経過時間で判定する（タイマーは止まることがあるため）。
 */
export class IdleWatcher {
  constructor({ minutes, onIdle, onActivity, activityEveryMs = 60000 }) {
    this.minutes = minutes;
    this.onIdle = onIdle;
    this.onActivity = onActivity || (() => {});
    this.activityEveryMs = activityEveryMs;
    this.last = Date.now();
    this.lastReported = 0;
    this._mark = () => {
      if (isLockShown()) return;
      this.last = Date.now();
      if (this.last - this.lastReported >= this.activityEveryMs) {
        this.lastReported = this.last;
        this.onActivity();
      }
    };
    this._check = () => {
      if (!this.minutes || isLockShown()) return;
      if (Date.now() - this.last >= this.minutes * 60000) this.onIdle();
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input']) {
      window.addEventListener(ev, this._mark, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this._check(); });
    this.timer = setInterval(this._check, 15000);
  }

  setMinutes(m) {
    this.minutes = m;
    this.last = Date.now();
  }

  /** ロック解除の直後に呼ぶ（経過時間を数え直す） */
  reset() {
    this.last = Date.now();
    this.lastReported = this.last;
  }
}
