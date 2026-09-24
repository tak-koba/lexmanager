// web/js/util/kana.js
// かな変換・よみがな入力補助。

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = 0x60; // カタカナ - ひらがな のコードポイント差

/**
 * ひらがな → カタカナ
 * @param {string} s
 * @returns {string}
 */
export function hiraganaToKatakana(s) {
  return String(s || '').replace(/[ぁ-ゖ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + KANA_OFFSET)
  );
}

/**
 * カタカナ → ひらがな
 * @param {string} s
 * @returns {string}
 */
export function katakanaToHiragana(s) {
  return String(s || '').replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - KANA_OFFSET)
  );
}

/**
 * 氏名・会社名入力欄(inputEl)からよみ欄(kanaEl)への「かな入力補助」。
 *
 * 制約事項（実装メモ）:
 * ブラウザはIME変換前の生の読み（かな）を確実な形では公開していない。
 * 実用上の近似として、IME確定時 (compositionend) の event.data
 * （多くの日本語IMEでは変換前後どちらのケースでも比較的読みに近い文字列が入る）
 * をひらがな化して補助入力する、ベストエフォートな方式を採る（レガシー版の
 * setupKanaInput と同等の割り切り）。漢字変換後は読みと一致しない場合がある。
 *
 * kanaEl が空、または直近の値がこの補助機能による自動入力であった場合のみ上書きする。
 * ユーザーがkanaElを手動編集した形跡があれば、以後は自動上書きしない。
 *
 * @param {HTMLInputElement} inputEl
 * @param {HTMLInputElement} kanaEl
 */
export function setupKanaAssist(inputEl, kanaEl) {
  if (!inputEl || !kanaEl) return;

  // 自動入力フラグ（このフラグが立っている間の値はユーザー手動編集ではないとみなす）
  kanaEl.dataset.kanaAuto = kanaEl.value ? kanaEl.dataset.kanaAuto || '' : '1';

  kanaEl.addEventListener('input', () => {
    // 自動入力による input イベント中は onCompositionEnd 側でフラグを制御する。
    // それ以外（ユーザーの直接編集）はフラグを外す。
    if (!kanaEl.dataset.settingAuto) {
      kanaEl.dataset.kanaAuto = '';
    }
  });

  inputEl.addEventListener('compositionend', (ev) => {
    const canAutoFill = kanaEl.value === '' || kanaEl.dataset.kanaAuto === '1';
    if (!canAutoFill) return;

    const raw = ev.data || '';
    if (!raw) return;

    const reading = katakanaToHiragana(raw);
    if (!reading) return;

    kanaEl.dataset.settingAuto = '1';
    kanaEl.value = reading;
    kanaEl.dataset.kanaAuto = '1';
    delete kanaEl.dataset.settingAuto;
  });
}
