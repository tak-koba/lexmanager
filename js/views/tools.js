// LexManager 4 - ツール
// 最初の画面はツールの一覧だけを表示し、選んだツールを個別の画面（#/tools/<名前>）で開く。
import { el, clear } from '../ui/dom.js';
import { toWareki, toSeireki, calcAge } from '../util/gengo.js';
import { currentGrade, educationTimeline, SCHOOL_STAGES, countDays, calcInterest } from '../util/calc.js';
import { todayIso } from './_shared.js';

const ERA_NAMES = ['令和', '平成', '昭和', '大正', '明治'];

// ツールの一覧（表示順）。need はその端末で使える機能（PCのみ等）
const TOOLS = [
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
  const tools = TOOLS.filter((t) => !t.need || ctx.caps[t.need]);
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

/** 'YYYY'年と月 → 「2019年4月（平成31年4月）」 */
function ymLabel(y, m) {
  const w = toWareki(`${y}-${String(m).padStart(2, '0')}-01`).replace(/\d+日$/, '');
  return `${y}年${m}月（${w}）`;
}

const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;

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
  const idsInput = el('input', { type: 'text', class: 'field', placeholder: 'IDをカンマ区切りで指定（空欄で全件）' });
  const exportBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: () => {
    const ids = idsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    const url = ctx.store.exportCsvUrl(targetSelect.value, ids);
    window.open(url, '_blank', 'noopener');
  } }, 'CSVダウンロード');
  section.appendChild(el('div', { class: 'field-row' }, [targetSelect, idsInput, exportBtn]));
  return section;
}

// ---------------- ごみ箱 ----------------
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
      const label = item.name || `${item.coll}/${item.id}`;
      list.appendChild(el('li', { class: 'list-row' }, [
        el('span', {}, label),
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
