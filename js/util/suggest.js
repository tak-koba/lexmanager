// web/js/util/suggest.js
// メモ本文からのToDo候補抽出（キーワード方式）。日付解決はUI側に任せる簡易版。

export const TODO_KEYWORDS = [
  '提出', '準備', '確認', '連絡', '送付', '作成', '取得', '申立', '手配', '整理', '対応', '期限', '締切', 'まで',
];

const DATE_HINT_RE = /(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2})|(\d{1,2}月\d{1,2}日)/;

/**
 * @param {string} text
 * @returns {Array<{title:string, deadlineHint:string}>}
 */
export function extractTodoCandidates(text) {
  if (!text) return [];

  const candidates = [];
  const lines = String(text).split(/\r?\n/);

  for (const line of lines) {
    const sentences = line.split('。');
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;

      const hasKeyword = TODO_KEYWORDS.some((kw) => sentence.includes(kw));
      if (!hasKeyword) continue;

      const m = DATE_HINT_RE.exec(sentence);
      const deadlineHint = m ? m[0] : '';

      candidates.push({ title: sentence, deadlineHint });
    }
  }

  return candidates;
}

/**
 * '6/20' や '6月20日' のような簡易な日付らしき文字列を 'YYYY-MM-DD' に変換する。
 * 解釈できない場合は空文字を返す。
 * @param {string} hint
 * @param {number} referenceYear
 * @returns {string}
 */
export function hintToIsoDate(hint, referenceYear) {
  if (!hint) return '';

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hint);
  if (isoMatch) return hint;

  const slashMatch = /^(\d{1,2})\/(\d{1,2})$/.exec(hint);
  if (slashMatch) {
    const mo = String(slashMatch[1]).padStart(2, '0');
    const d = String(slashMatch[2]).padStart(2, '0');
    return `${referenceYear}-${mo}-${d}`;
  }

  const kanjiMatch = /^(\d{1,2})月(\d{1,2})日$/.exec(hint);
  if (kanjiMatch) {
    const mo = String(kanjiMatch[1]).padStart(2, '0');
    const d = String(kanjiMatch[2]).padStart(2, '0');
    return `${referenceYear}-${mo}-${d}`;
  }

  return '';
}
