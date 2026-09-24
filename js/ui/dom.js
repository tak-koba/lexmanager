// web/js/ui/dom.js
// 簡易ハイパースクリプト風 DOM ビルダー。ビルド不要・依存なし。

const EVENT_PROP_RE = /^on([A-Z][A-Za-z0-9]*)$/;

/**
 * @param {string} tag
 * @param {object} attrs
 * @param {Array|Node|string} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  attrs = attrs || {};

  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === null || value === undefined || value === false) continue;

    const m = EVENT_PROP_RE.exec(key);
    if (m) {
      const eventName = m[1].toLowerCase();
      node.addEventListener(eventName, value);
      continue;
    }

    if (key === 'class' || key === 'className') {
      node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
      continue;
    }

    if (key === 'style') {
      if (typeof value === 'string') {
        node.setAttribute('style', value);
      } else if (typeof value === 'object') {
        for (const prop of Object.keys(value)) {
          node.style[prop] = value[prop];
        }
      }
      continue;
    }

    if (key === 'dataset') {
      if (typeof value === 'object') {
        for (const dk of Object.keys(value)) {
          node.dataset[dk] = value[dk];
        }
      }
      continue;
    }

    if (key === 'html') {
      node.innerHTML = value;
      continue;
    }

    // value/checked/selected は属性ではなくプロパティで設定する（textarea の初期値が入らない問題の対策）
    if (key === 'value' || key === 'checked' || key === 'selected') {
      if (key === 'value') node.value = String(value);
      else node[key] = !!value;
      if (key !== 'value' || tag !== 'textarea') node.setAttribute(key, value === true ? '' : String(value));
      continue;
    }

    if (value === true) {
      node.setAttribute(key, '');
      continue;
    }

    node.setAttribute(key, String(value));
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(node, child);
    return;
  }
  if (children instanceof Node) {
    node.appendChild(children);
    return;
  }
  if (typeof children === 'string' || typeof children === 'number') {
    node.appendChild(document.createTextNode(String(children)));
    return;
  }
  // ignore booleans / null / undefined already handled above
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}
