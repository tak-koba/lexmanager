// web/js/ui/forms.js
import { confirmDialog } from './dialog.js';

/**
 * フォーム要素の name 付き入力をプレーンオブジェクトへ変換する。
 * チェックボックスは bool、同名複数入力は配列にする。
 * @param {HTMLFormElement} formEl
 * @returns {object}
 */
export function formToObject(formEl) {
  const result = {};
  const elements = Array.from(formEl.elements || []);

  for (const field of elements) {
    const name = field.name;
    if (!name) continue;
    if (field.disabled) continue;

    let value;
    if (field.type === 'checkbox') {
      value = field.checked;
    } else if (field.type === 'radio') {
      if (!field.checked) continue;
      value = field.value;
    } else if (field.tagName === 'SELECT' && field.multiple) {
      value = Array.from(field.selectedOptions).map((o) => o.value);
    } else {
      value = field.value;
    }

    if (Object.prototype.hasOwnProperty.call(result, name)) {
      const existing = result[name];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[name] = [existing, value];
      }
    } else {
      result[name] = value;
    }
  }

  return result;
}

/**
 * beforeunload での離脱警告を付与する。
 * @param {HTMLElement} container 未使用だが将来のスコープ限定のために受け取る
 * @param {Function} isDirtyFn
 * @returns {{check: () => Promise<boolean>}}
 */
export function setUnsavedGuard(container, isDirtyFn) {
  const handler = (ev) => {
    if (typeof isDirtyFn === 'function' && isDirtyFn()) {
      ev.preventDefault();
      ev.returnValue = '';
      return '';
    }
  };
  window.addEventListener('beforeunload', handler);

  return {
    check: async () => guardNavigation(isDirtyFn),
  };
}

/**
 * ルーターが画面遷移前に呼ぶヘルパー。
 * @param {Function} isDirtyFn
 * @returns {Promise<boolean>} true = 遷移してよい
 */
export async function guardNavigation(isDirtyFn) {
  if (typeof isDirtyFn === 'function' && isDirtyFn()) {
    return confirmDialog('保存されていない変更があります。移動しますか？');
  }
  return true;
}
