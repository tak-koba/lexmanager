// LexManager 4 - ツール
// 最初の画面はツールの一覧だけを表示し、選んだツールを個別の画面（#/tools/<名前>）で開く。
import { el, clear } from '../ui/dom.js';
import { toWareki, toSeireki, calcAge } from '../util/gengo.js';
import { currentGrade, educationTimeline, SCHOOL_STAGES, countDays, calcInterest } from '../util/calc.js';
import { formatSlots, parseSlots } from '../util/slots.js';
import { todayIso, conflictResultList } from './_shared.js';
import { findConflicts } from '../util/conflict.js';

const ERA_NAMES = ['令和', '平成', '昭和', '大正', '明治'];

// ツールの一覧（表示順）。need はその端末で使える機能（PCのみ等）
const TOOLS = [
  { key: 'conflict', icon: '⚖️', title: 'コンフリクトチェック', desc: '相談者・関係者の名前等が、既存の顧客・相手方・相手方代理人と重ならないか確認（利益相反の確認）', build: buildConflictSection },
  { key: 'free', icon: '🕒', title: '空き日程の検索', desc: 'Googleカレンダーから空いている日時を探し、候補の文章を作って仮予定（TBD）として登録', need: 'gcalFree', build: buildFreeSection },
  { key: 'age', icon: '🎂', title: '年齢・学年・卒業年次', desc: '生年月日から満年齢、現在の学年、入学・卒業の年を表示', build: buildAgeSection },
  { key: 'days', icon: '📅', title: '日数計算', desc: '2つの日付の間の日数（初日算入・不算入、うるう日の指摘）', build: buildDaysSection },
  { key: 'interest', icon: '💴', title: '利息計算', desc: '元金・利率・期間から利息／遅延損害金を計算', build: buildInterestSection },
  { key: 'wareki', icon: '🗓', title: '和暦⇔西暦変換', desc: '日付の和暦表記、和暦の年から西暦', build: buildGengoSection },
  { key: 'hayami', icon: '📄', title: '年齢早見表', desc: '直近3年分の年齢早見表（PDF）', build: buildHayamiSection },
  { key: 'csv', icon: '📤', title: 'CSV出力', desc: '顧客・案件・ToDoをCSVで出力', need: 'csv', build: buildCsvSection },
  { key: 'trash', icon: '🗑', title: 'ごみ箱', desc: '削除したデータの確認と復元', need: 'trash', build: buildTrashSection }
];

export async function render(container, params, ctx) {
  clear(container);
  // need: その端末で使える機能（ctx.caps の項目、またはサーバー版だけにある store の機能）
  const tools = TOOLS.filter((t) => !t.need || ctx.caps[t.need] || typeof ctx.store[t.need] === 'function');
  const tool = params && params.tool ? tools.find((t) => t.key === params.tool) : null;

  if (!tool) {
    container.appendChild(el('h1', { class: 'view-title' }, 'ツール'));
    container.appendChild(el('div', { class: 'tool-menu' }, tools.map((t) =>
      el('a', { href: `#/tools/${t.key}`, class: 'tool-card' }, [
        el('span', { class: 'tool-card-icon', 'aria-hidden': 'true' }, t.icon),
        el('span', { class: 'tool-card-text' }, [
          el('span', { class: 'tool-card-title' }, t.title),
          el('span', { class: 'tool-card-desc text-muted' }, t.desc)
        ])
      ])
    )));
    return;
  }

  container.appendChild(el('a', { href: '#/tools', class: 'btn btn-small tool-back' }, '← ツール一覧'));
  container.appendChild(el('h1', { class: 'view-title' }, tool.title));
  container.appendChild(await tool.build(ctx));
}

// ---------------- コンフリクトチェック（利益相反の確認。DESIGN.md §17） ----------------
function buildConflictSection(ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('p', { class: 'text-muted' }, '相談を受ける前などに、相談者・相手方・関係者の名前（個人名・会社名・かな）、電話番号、メールアドレスを入れて、既存の顧客・各案件の相手方・相手方代理人と照合します。全角/半角・空白・カタカナ/ひらがな・「株式会社」等の違いは無視して比べます。'));
  const names = el('textarea', { class: 'field', rows: 4, placeholder: '名前（1行に1人・1社。例: 山田 太郎／株式会社サンプル商事／やまだ たろう）', 'aria-label': '照合する名前' });
  const phones = el('input', { type: 'text', class: 'field', placeholder: '電話番号（任意。複数はカンマ区切り）', 'aria-label': '照合する電話番号' });
  const emails = el('input', { type: 'text', class: 'field', placeholder: 'メールアドレス（任意。複数はカンマ区切り）', 'aria-label': '照合するメールアドレス' });
  const out = el('div', { 'aria-live': 'polite' });
  const split = (s) => String(s || '').split(/[\n,、，]/).map((x) => x.trim()).filter(Boolean);
  section.appendChild(el('label', {}, ['名前', names]));
  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['電話番号', phones]), el('label', {}, ['メールアドレス', emails])]));
  section.appendChild(el('div', { class: 'toolbar' }, [el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    const query = { names: split(names.value), phones: split(phones.value), emails: split(emails.value) };
    if (!query.names.length && !query.phones.length && !query.emails.length) { clear(out); out.appendChild(el('p', { class: 'text-error' }, '名前・電話番号・メールアドレスのどれかを入れてください')); return; }
    const hits = findConflicts(query, await ctx.store.all());
    clear(out);
    out.appendChild(el('h3', {}, `照合結果（${new Date().toLocaleString('ja-JP')}）`));
    out.appendChild(conflictResultList(hits));
  } }, '照合する')]));
  section.appendChild(out);
  return section;
}

/** 'YYYY'年と月 → 「2019年4月（平成31年4月）」 */
function ymLabel(y, m) {
  const w = toWareki(`${y}-${String(m).padStart(2, '0')}-01`).replace(/\d+日$/, '');
  return `${y}年${m}月（${w}）`;
}

const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;

// ---------------- 空き日程の検索（PCのみ・Googleカレンダー連携が必要） ----------------
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日']; // 0=月（Pythonの weekday と同じ）

/** 分 → 「30分」「1時間」「1時間30分」 */
function durationLabel(m) {
  const h = Math.floor(m / 60);
  return h ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  }
}

async function buildFreeSection(ctx) {
  const section = el('section', { class: 'section' });
  let st = null;
  try { st = await ctx.store.gcalStatus(); } catch (e) { /* 下で案内 */ }
  if (!st || !st.connected) {
    section.appendChild(el('p', {}, 'Googleカレンダーに接続すると使えます。'));
    section.appendChild(el('a', { href: '#/settings', class: 'btn' }, '設定 → Googleカレンダー連携'));
    return section;
  }

  const today = todayIso();
  const from = el('input', { type: 'date', class: 'field', value: today });
  const to = el('input', { type: 'date', class: 'field', value: addDays(today, 13) });
  const wdBoxes = WEEKDAY_LABELS.map((w, i) => el('input', { type: 'checkbox', value: i, checked: i < 5 }));
  const dayStart = el('input', { type: 'time', class: 'field', value: '10:00', step: 900 });
  const dayEnd = el('input', { type: 'time', class: 'field', value: '17:00', step: 900 });
  const minSel = el('select', { class: 'field' }, [30, 60, 90, 120, 180, 240].map((m) => el('option', { value: m, selected: m === 60 }, durationLabel(m))));
  const bufSel = el('select', { class: 'field' }, [0, 15, 30, 45, 60, 90, 120].map((m) => el('option', { value: m, selected: m === 60 }, m === 0 ? 'なし' : durationLabel(m))));
  // 初期値はGoogleカレンダー上のカレンダー名（外出の仕事・会食用。名前は英語のまま）
  const special = el('input', { type: 'text', class: 'field', value: 'Work (outside), Banquet' });
  const withYear = el('input', { type: 'checkbox', checked: true });

  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['期間（開始）', from]), el('label', {}, ['期間（終了）', to])]));
  section.appendChild(el('div', { class: 'tool-field' }, [el('span', { class: 'tool-label' }, '曜日'),
    el('div', { class: 'tool-radios' }, wdBoxes.map((b, i) => el('label', { class: 'tool-radio' }, [b, WEEKDAY_LABELS[i]])))]));
  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['時間（開始）', dayStart]), el('label', {}, ['時間（終了）', dayEnd])]));
  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['必要な空き時間', minSel]), el('label', {}, ['前後の間隔', bufSel])]));
  section.appendChild(el('label', {}, ['前後に必ず1時間以上空けるカレンダー（カンマ区切り）', special]));
  section.appendChild(el('p', { class: 'text-muted' }, '移動が必要な予定を入れているカレンダーの名前を、Googleカレンダーでの表示どおりに入力します（初期値の「Work (outside)」は外出の仕事、「Banquet」は会食のカレンダー）。'));
  section.appendChild(el('p', { class: 'text-muted' }, `対象: マイカレンダーの予定（「${st.calendarName || 'ToDo'}」は除く）。終日の予定がある日・祝日は除外します。`));

  const result = el('div', { class: 'tool-result' });
  const searchBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: search }, '検索');
  section.appendChild(searchBtn);
  section.appendChild(result);

  let last = null;      // 前回の検索結果（年の表示切替に使う）
  let edited = false;   // 候補テキストを手で直したか

  async function search() {
    clear(result);
    const weekdays = wdBoxes.filter((b) => b.checked).map((b) => Number(b.value));
    if (!weekdays.length) { ctx.toast('曜日を1つ以上選んでください', 'error'); return; }
    if (!from.value || !to.value || to.value < from.value) { ctx.toast('期間を正しく入力してください', 'error'); return; }
    if (!dayStart.value || !dayEnd.value || dayEnd.value <= dayStart.value) { ctx.toast('時間を正しく入力してください', 'error'); return; }
    searchBtn.disabled = true;
    result.appendChild(el('p', { class: 'text-muted' }, 'Googleカレンダーを確認しています…'));
    try {
      last = await ctx.store.gcalFree({
        start: from.value, end: to.value, weekdays, dayStart: dayStart.value, dayEnd: dayEnd.value,
        minMinutes: Number(minSel.value), bufferMinutes: Number(bufSel.value),
        specialNames: special.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean), specialMinMinutes: 60
      });
      last.minMinutes = Number(minSel.value);
      renderResult();
    } catch (e) {
      clear(result);
      result.appendChild(el('p', { class: 'text-error' }, '検索できませんでした: ' + e.message));
    } finally {
      searchBtn.disabled = false;
    }
  }

  function renderResult() {
    clear(result);
    for (const w of last.warnings || []) result.appendChild(el('p', { class: 'tool-warn' }, `⚠ ${w}`));
    if (!last.days.length) {
      result.appendChild(el('p', {}, '条件に合う空き時間はありませんでした。'));
      return;
    }
    edited = false;
    const text = el('textarea', { class: 'field free-text', rows: Math.min(14, last.days.length + 1) }, formatSlots(last.days, last.minMinutes, withYear.checked));
    text.addEventListener('input', () => { edited = true; });
    withYear.onchange = async () => {
      if (edited && !(await ctx.confirm('直した内容を破棄して、年の表示を切り替えますか？', { okLabel: '破棄する', danger: true }))) { withYear.checked = !withYear.checked; return; }
      text.value = formatSlots(last.days, last.minMinutes, withYear.checked);
      edited = false;
    };
    const title = el('input', { type: 'text', class: 'field', placeholder: '例: ○○社 打合せ' });
    const memo = el('textarea', { class: 'field', rows: 2, placeholder: '何の予定調整か（仮予定のメモ欄に入ります）' });

    result.appendChild(el('label', { class: 'field-row' }, [withYear, '年を記載する']));
    result.appendChild(el('label', {}, ['候補（直して使えます）', text]));
    result.appendChild(el('label', {}, ['件名（仮予定（TBD）の件名）', title]));
    result.appendChild(el('label', {}, ['メモ', memo]));
    result.appendChild(el('div', { class: 'field-row' }, [
      el('button', { type: 'button', class: 'btn', onClick: async () => {
        ctx.toast((await copyText(text.value)) ? 'コピーしました' : 'コピーできませんでした。手で選択してコピーしてください', 'info');
      } }, 'コピーだけ'),
      el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
        const parsed = parseSlots(text.value, today);
        if (!parsed.slots.length) { ctx.toast('候補の日時を読み取れませんでした', 'error'); return; }
        if (!title.value.trim()) { ctx.toast('件名を入力してください', 'error'); title.focus(); return; }
        if (!st.tbdCalendarId) { ctx.toast('設定でTBDカレンダーを選んでください', 'error'); return; }
        const skipped = parsed.errors.filter((l) => l.trim()).length;
        const ok = await ctx.confirm(`テキストをコピーし、${parsed.slots.length}件の候補を「${st.tbdCalendarName || 'TBD'}」カレンダーに登録します。` +
          (skipped ? `\n（日時を読み取れない行 ${skipped}行は登録しません）` : '') + '\nよろしいですか？', { okLabel: '登録する' });
        if (!ok) return;
        const copied = await copyText(text.value);
        try {
          const r = await ctx.store.gcalTbd({ title: title.value.trim(), memo: memo.value, slots: parsed.slots });
          ctx.toast(copied ? `コピーし、TBDに${r.created}件登録しました` : `TBDに${r.created}件登録しました（コピーはできなかったので、［コピーだけ］を押してください）`, copied ? 'success' : 'info');
        } catch (e) {
          ctx.toast('登録に失敗しました: ' + e.message, 'error');
        }
      } }, '確定（コピーしてTBDに登録）')
    ]));
  }
  return section;
}

// ---------------- 年齢・学年・卒業年次 ----------------
function buildAgeSection() {
  const section = el('section', { class: 'section' });
  const birthdayInput = el('input', { type: 'date', class: 'field' });
  const result = el('div', { class: 'tool-result' });
  section.appendChild(el('label', {}, ['生年月日', birthdayInput]));
  section.appendChild(result);

  // 各学校の「遅れて入学した年数」と「修業年数」（留年・浪人・短大等の調整用）
  const delays = {};
  const years = {};

  function update() {
    clear(result);
    const b = birthdayInput.value;
    if (!b) return;
    const today = todayIso();
    const age = calcAge(b, today);
    result.appendChild(el('div', { class: 'tool-big' }, `満${age}歳`));
    result.appendChild(el('div', {}, `${toWareki(b)}生まれ`));
    result.appendChild(el('div', { class: 'tool-big' }, currentGrade(b, today)));
    result.appendChild(el('div', { class: 'text-muted' }, '学年は、遅れなく進学した場合の目安です（4月2日〜翌年4月1日生まれが同じ学年）。'));

    const rows = educationTimeline(b, delays, years);
    const table = el('div', { class: 'edu-table' });
    for (const r of rows) {
      const stage = SCHOOL_STAGES.find((s) => s.key === r.key);
      const delaySel = el('select', { class: 'field', 'aria-label': `${r.label}の入学` },
        Array.from({ length: 10 }, (_, i) => el('option', { value: i, selected: (Number(delays[r.key]) || 0) === i }, i === 0 ? '現役入学' : `${i}年遅れて入学`)));
      delaySel.addEventListener('change', () => { delays[r.key] = Number(delaySel.value); update(); });
      const yearsSel = el('select', { class: 'field', 'aria-label': `${r.label}の修業年数` },
        Array.from({ length: 9 }, (_, i) => i + 1).map((n) => el('option', { value: n, selected: (Number(years[r.key]) || stage.years) === n }, `${n}年間`)));
      yearsSel.addEventListener('change', () => { years[r.key] = Number(yearsSel.value); update(); });
      table.appendChild(el('div', { class: 'edu-row' }, [
        el('div', { class: 'edu-name' }, r.label),
        el('div', {}, [el('span', { class: 'text-muted' }, '入学 '), ymLabel(r.entryYear, 4)]),
        el('div', {}, [el('span', { class: 'text-muted' }, '卒業 '), ymLabel(r.gradYear, 3)]),
        el('div', { class: 'edu-adjust' }, [delaySel, yearsSel])
      ]));
    }
    result.appendChild(el('h3', { class: 'tool-sub' }, '入学・卒業の年'));
    result.appendChild(table);
    result.appendChild(el('p', { class: 'text-muted' }, '浪人・留年・短大（2年）などは、各学校の選択欄で調整できます。「卒業年度」で書く場合は卒業年から1を引きます（例: 2020年3月卒業＝2019年度卒業）。'));
  }
  birthdayInput.addEventListener('input', update);
  return section;
}

// ---------------- 日数計算 ----------------
function buildDaysSection() {
  const section = el('section', { class: 'section' });
  const from = el('input', { type: 'date', class: 'field' });
  const to = el('input', { type: 'date', class: 'field', value: todayIso() });
  const firstSel = radioGroup('days-first', [
    { value: 'exclude', label: '初日不算入（民法140条）', checked: true },
    { value: 'include', label: '初日算入' }
  ]);
  const result = el('div', { class: 'tool-result' });
  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['開始日', from]), el('label', {}, ['終了日', to])]));
  section.appendChild(firstSel.node);
  section.appendChild(result);

  function update() {
    clear(result);
    if (!from.value || !to.value) return;
    const r = countDays(from.value, to.value, firstSel.value() === 'include');
    if (r.error) { result.appendChild(el('p', { class: 'text-error' }, r.error)); return; }
    result.appendChild(el('div', { class: 'tool-big' }, `${r.days.toLocaleString('ja-JP')}日`));
    if (r.days >= 7) result.appendChild(el('div', { class: 'text-muted' }, `（${Math.floor(r.days / 7)}週${r.days % 7 ? `${r.days % 7}日` : ''}）`));
    result.appendChild(leapNotice(r.leapDays));
    if (r.segments.length > 1) {
      result.appendChild(el('div', { class: 'text-muted' }, `年ごとの内訳: ${r.segments.map((s) => `${s.year}年 ${s.days}日${s.leap ? '（うるう年）' : ''}`).join('、')}`));
    }
  }
  for (const n of [from, to]) n.addEventListener('input', update);
  firstSel.onChange(update);
  return section;
}

function leapNotice(leapDays) {
  if (!leapDays || !leapDays.length) return el('div', { class: 'text-muted' }, 'うるう日（2月29日）は含まれていません。');
  const list = leapDays.map((d) => `${d.slice(0, 4)}年2月29日`).join('、');
  return el('div', { class: 'tool-warn' }, `⚠ うるう日（${list}）を含みます。年365日の日割計算では、うるう年の扱いに注意してください。`);
}

// ---------------- 利息計算 ----------------
// 参考: 年365日の日割計算・初日算入・小数点以下切捨てを既定とする方式（実務の友「利息計算」と同じ既定）。
const RATE_PRESETS = [
  { v: '3', label: '3%（法定利率・2020年4月1日以降。3年ごとに見直し）' },
  { v: '5', label: '5%（改正前民法の法定利率）' },
  { v: '6', label: '6%（改正前商法の法定利率）' },
  { v: '14.6', label: '14.6%（日歩4銭相当）' },
  { v: '15', label: '15%' },
  { v: '18', label: '18%' },
  { v: '20', label: '20%' },
  { v: '21.9', label: '21.9%' },
  { v: '26.28', label: '26.28%' },
  { v: '29.2', label: '29.2%' }
];

function buildInterestSection() {
  const section = el('section', { class: 'section' });
  const principal = el('input', { type: 'text', inputmode: 'numeric', class: 'field', placeholder: '例: 1000000' });
  const principalView = el('span', { class: 'text-muted' });
  const rateType = radioGroup('int-ratetype', [
    { value: 'annual', label: '年利（%）', checked: true },
    { value: 'daily', label: '日歩（銭）' }
  ]);
  const listId = 'rate-presets';
  const rate = el('input', { type: 'text', inputmode: 'decimal', class: 'field', list: listId, placeholder: '例: 3' });
  const presets = el('datalist', { id: listId }, RATE_PRESETS.map((p) => el('option', { value: p.v }, p.label)));
  const from = el('input', { type: 'date', class: 'field' });
  const to = el('input', { type: 'date', class: 'field' });
  const daysDirect = el('input', { type: 'text', inputmode: 'numeric', class: 'field', placeholder: '空欄なら期間から自動計算' });
  const basis = radioGroup('int-basis', [
    { value: '365', label: '年365日', checked: true },
    { value: '366', label: '年366日' },
    { value: 'actual', label: 'うるう年は366日で按分' }
  ]);
  const first = radioGroup('int-first', [
    { value: 'include', label: '初日（借受日）算入', checked: true },
    { value: 'exclude', label: '初日不算入' }
  ]);
  const rounding = radioGroup('int-round', [
    { value: 'floor', label: '小数点以下切捨て', checked: true },
    { value: 'round', label: '四捨五入' }
  ]);
  const result = el('div', { class: 'tool-result' });

  section.appendChild(el('label', {}, ['元金（円）', principal, principalView]));
  section.appendChild(el('div', { class: 'tool-field' }, [el('span', { class: 'tool-label' }, '利率'), rateType.node, rate, presets]));
  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['始期', from]), el('label', {}, ['終期', to])]));
  section.appendChild(el('label', {}, ['日数（直接入力も可）', daysDirect]));
  section.appendChild(el('div', { class: 'tool-field' }, [el('span', { class: 'tool-label' }, '日割計算'), basis.node]));
  section.appendChild(el('div', { class: 'tool-field' }, [el('span', { class: 'tool-label' }, '初日'), first.node]));
  section.appendChild(el('div', { class: 'tool-field' }, [el('span', { class: 'tool-label' }, '端数'), rounding.node]));
  section.appendChild(result);

  const num = (s) => Number(String(s || '').replace(/[,，\s円%％]/g, '').replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));

  function update() {
    clear(result);
    const p = num(principal.value);
    principalView.textContent = principal.value && p >= 0 ? `＝ ${yen(p)}` : '';
    if (!principal.value || !rate.value) return;
    if (!daysDirect.value && (!from.value || !to.value)) return;
    const r = calcInterest({
      principal: p, rateType: rateType.value(), rate: num(rate.value),
      days: daysDirect.value ? num(daysDirect.value) : undefined,
      from: from.value, to: to.value, includeFirst: first.value() === 'include',
      basis: basis.value(), rounding: rounding.value()
    });
    if (r.error) { result.appendChild(el('p', { class: 'text-error' }, r.error)); return; }
    result.appendChild(el('div', { class: 'tool-lines' }, [
      el('div', {}, [el('span', { class: 'text-muted' }, '元金 '), yen(p)]),
      el('div', { class: 'tool-big' }, [el('span', { class: 'text-muted' }, '利息／遅延損害金 '), yen(r.interest)]),
      el('div', {}, [el('span', { class: 'text-muted' }, '合計 '), yen(r.total)]),
      el('div', {}, [el('span', { class: 'text-muted' }, '日数 '), `${r.days.toLocaleString('ja-JP')}日`]),
      el('div', { class: 'text-muted tool-formula' }, `計算式: ${r.formula}`)
    ]));
    if (!daysDirect.value) result.appendChild(leapNotice(r.leapDays));
  }
  for (const n of [principal, rate, from, to, daysDirect]) n.addEventListener('input', update);
  for (const g of [rateType, basis, first, rounding]) g.onChange(update);
  rateType.onChange(() => { rate.placeholder = rateType.value() === 'daily' ? '例: 4（日歩4銭）' : '例: 3'; });
  return section;
}

/** ラジオボタンのまとまり。value() で選択値、onChange(fn) で変更時の処理。 */
function radioGroup(name, options) {
  const node = el('div', { class: 'tool-radios', role: 'radiogroup' });
  const inputs = options.map((o) => {
    const input = el('input', { type: 'radio', name, value: o.value, checked: !!o.checked });
    node.appendChild(el('label', { class: 'tool-radio' }, [input, o.label]));
    return input;
  });
  return {
    node,
    value: () => (inputs.find((i) => i.checked) || inputs[0]).value,
    onChange: (fn) => inputs.forEach((i) => i.addEventListener('change', fn))
  };
}

// ---------------- 和暦⇔西暦 ----------------
function buildGengoSection() {
  const section = el('section', { class: 'section' });

  const westBox = el('div', { class: 'field-row' });
  const dateInput = el('input', { type: 'date', class: 'field' });
  const westResult = el('span', { class: 'result' }, '');
  dateInput.addEventListener('input', () => {
    westResult.textContent = dateInput.value ? toWareki(dateInput.value) : '';
  });
  westBox.appendChild(el('label', {}, ['西暦 → 和暦', dateInput]));
  westBox.appendChild(westResult);
  section.appendChild(westBox);

  const eraBox = el('div', { class: 'field-row' });
  const eraSelect = el('select', { class: 'field' }, ERA_NAMES.map((e) => el('option', { value: e }, e)));
  const kanenInput = el('input', { type: 'text', class: 'field', placeholder: '例: 7 または 元' });
  const eraResult = el('span', { class: 'result' }, '');
  function updateEra() {
    if (!kanenInput.value) { eraResult.textContent = ''; return; }
    const y = toSeireki(eraSelect.value, kanenInput.value);
    eraResult.textContent = Number.isNaN(y) ? '' : `${y}年`;
  }
  eraSelect.addEventListener('change', updateEra);
  kanenInput.addEventListener('input', updateEra);
  eraBox.appendChild(el('label', {}, ['和暦 → 西暦', el('span', {}, [eraSelect, kanenInput])]));
  eraBox.appendChild(eraResult);
  section.appendChild(eraBox);

  return section;
}

// ---------------- 年齢早見表（直近3年分） ----------------
function buildHayamiSection() {
  const section = el('section', { class: 'section' });
  const y = Number(todayIso().slice(0, 4));
  section.appendChild(el('div', { class: 'tool-menu' }, [y, y - 1, y - 2].map((yy) =>
    el('a', { href: `https://www.nenrei-hayami.net/${yy}.pdf`, target: '_blank', rel: 'noopener', class: 'tool-card' }, [
      el('span', { class: 'tool-card-icon', 'aria-hidden': 'true' }, '📄'),
      el('span', { class: 'tool-card-text' }, [
        el('span', { class: 'tool-card-title' }, `${yy}年（${toWareki(`${yy}-06-01`).replace(/\d+月\d+日$/, '')}）`),
        el('span', { class: 'tool-card-desc text-muted' }, yy === y ? '今年' : yy === y - 1 ? '昨年' : '一昨年')
      ])
    ])
  )));
  section.appendChild(el('p', { class: 'text-muted' }, 'nenrei-hayami.net のPDFを別のタブで開きます。'));
  return section;
}

// ---------------- CSV出力 ----------------
function buildCsvSection(ctx) {
  const section = el('section', { class: 'section' });
  const targetSelect = el('select', { class: 'field' }, [
    el('option', { value: 'clients' }, '顧客'),
    el('option', { value: 'cases' }, '案件'),
    el('option', { value: 'todos' }, 'ToDo')
  ]);
  // 全件を出力する（一部だけ選ぶ欄は、内部の番号を入力する必要があり分かりにくいため設けない）
  const exportBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: () => {
    const url = ctx.store.exportCsvUrl(targetSelect.value, []);
    window.open(url, '_blank', 'noopener');
  } }, 'CSVファイルを保存');
  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['出力するもの', targetSelect]), exportBtn]));
  section.appendChild(el('p', { class: 'text-muted' }, '選んだ種類のデータを全件、CSVファイル（Excelで開けます）として保存します。'));
  return section;
}

// ---------------- ごみ箱 ----------------
const TRASH_KIND = { clients: '顧客', cases: '案件', todos: 'ToDo' };

/** ごみ箱の項目の名前（サーバーが名前を付けていればそれ、なければレコードから作る） */
function trashName(item) {
  const r = item.record || {};
  const fromRecord = r.caseName || r.task || (r.title && String(r.title).split(/\r?\n/)[0]) || r.companyName ||
    [r.lastName, r.firstName].filter(Boolean).join(' ');
  return item.label || item.title || fromRecord || '（名前なし）';
}

/** 削除日時（ファイル名の末尾「__20261022T093000Z.json」から。サーバーが deletedAt を返せばそれ） */
function trashDeletedAt(item) {
  let iso = item.deletedAt || '';
  const m = !iso && /__(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(item.name || '');
  if (m) iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '不明';
}

async function buildTrashSection(ctx) {
  const section = el('section', { class: 'section' });
  const listBox = el('div', { class: 'list-box' });
  section.appendChild(listBox);

  async function reload() {
    clear(listBox);
    let items = [];
    try {
      const res = await ctx.store.getTrash();
      items = (res && res.items) || res || [];
    } catch (e) {
      listBox.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
      return;
    }
    if (!items.length) {
      listBox.appendChild(el('p', { class: 'text-muted' }, 'ごみ箱は空です'));
      return;
    }
    const list = el('ul', { class: 'list' });
    for (const item of items) {
      list.appendChild(el('li', { class: 'list-row' }, [
        el('span', { class: 'chip' }, TRASH_KIND[item.coll] || 'データ'),
        el('div', { class: 'row-main row-main-stack' }, [
          el('span', {}, trashName(item)),
          el('span', { class: 'text-muted' }, `削除: ${trashDeletedAt(item)}`)
        ]),
        el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
          try {
            await ctx.store.restoreTrash({ coll: item.coll, id: item.id, name: item.name });
            ctx.toast('復元しました', 'success');
            reload();
          } catch (e) {
            ctx.toast('復元に失敗しました: ' + e.message, 'error');
          }
        } }, '復元')
      ]));
    }
    listBox.appendChild(list);
  }

  await reload();
  return section;
}
