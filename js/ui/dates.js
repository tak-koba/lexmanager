// web/js/ui/dates.js
// 日付表示・ローカル日付演算のユーティリティ。UTC変換によるズレを避けるため
// すべて年/月/日の数値コンポーネントで計算する。

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 'YYYY-MM-DD' または 'YYYY-MM-DDTHH:MM' → 'YYYY/MM/DD'
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso) {
  if (!iso) return '';
  const datePart = String(iso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return '';
  return `${m[1]}/${m[2]}/${m[3]}`;
}

/**
 * 'YYYY-MM-DDTHH:MM' → 'YYYY/MM/DD HH:MM'（時刻部が無ければ formatDate と同じ）
 * @param {string} iso
 * @returns {string}
 */
export function formatDateTime(iso) {
  if (!iso) return '';
  const datePart = formatDate(iso);
  if (!datePart) return '';
  const m = /T(\d{2}):(\d{2})/.exec(String(iso));
  if (!m) return datePart;
  return `${datePart} ${m[1]}:${m[2]}`;
}

/**
 * ローカル日付での今日を 'YYYY-MM-DD' で返す（UTCではない）。
 * @returns {string}
 */
export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * ローカル日付演算で n 日後（n が負なら前）の 'YYYY-MM-DD' を返す。
 * @param {string} iso 'YYYY-MM-DD'
 * @param {number} n
 * @returns {string}
 */
export function addDays(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
