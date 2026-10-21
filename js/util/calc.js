// web/js/util/calc.js
// ツール画面の計算（学年・卒業年次、日数計算、利息計算）。画面から切り離した純粋な計算のみ。
// 日付は 'YYYY-MM-DD'。時差の影響を受けないよう、内部では UTC の日付として扱う。

const DAY_MS = 86400000;

function parse(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d, t };
}

function isoOf(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// ---------------- 学年・卒業年次 ----------------
// 日本の学年は「4月2日〜翌年4月1日生まれ」が同じ学年。小学校入学は満6歳になった後の最初の4月。

/** 小学校に（遅れなく）入学する年。 */
export function elementaryEntryYear(birthIso) {
  const b = parse(birthIso);
  if (!b) return NaN;
  return (b.m < 4 || (b.m === 4 && b.d === 1)) ? b.y + 6 : b.y + 7;
}

/** その日が属する年度（4月始まり）。 */
export function schoolYearOf(iso) {
  const d = parse(iso);
  if (!d) return NaN;
  return d.m >= 4 ? d.y : d.y - 1;
}

/** 現在の学年（遅れ・留年なしで進んだ場合）。 */
export function currentGrade(birthIso, todayIso) {
  const entry = elementaryEntryYear(birthIso);
  const sy = schoolYearOf(todayIso);
  if (Number.isNaN(entry) || Number.isNaN(sy)) return '';
  const n = sy - entry + 1; // 小1 = 1
  if (n <= -3) return '未就学';
  if (n === -2) return '未就学（幼稚園なら年少の学年）';
  if (n === -1) return '未就学（幼稚園なら年中の学年）';
  if (n === 0) return '未就学（幼稚園なら年長の学年）';
  if (n <= 6) return `小学${n}年生`;
  if (n <= 9) return `中学${n - 6}年生`;
  if (n <= 12) return `高校${n - 9}年生`;
  if (n <= 16) return `大学${n - 12}年生（4年制大学に現役で進学した場合）`;
  return '大学卒業の年齢以降（4年制大学に現役で進学・卒業した場合の目安）';
}

export const SCHOOL_STAGES = [
  { key: 'elem', label: '小学校', years: 6 },
  { key: 'mid', label: '中学校', years: 3 },
  { key: 'high', label: '高等学校', years: 3 },
  { key: 'univ', label: '大学／専門学校', years: 4 }
];

/**
 * 入学（4月）・卒業（3月）の年の一覧。delays[key] は遅れて入学した年数、years[key] は修業年数。
 * 返り値: [{ key, label, entryYear, gradYear }]
 */
export function educationTimeline(birthIso, delays = {}, years = {}) {
  let y = elementaryEntryYear(birthIso);
  if (Number.isNaN(y)) return [];
  const out = [];
  for (const s of SCHOOL_STAGES) {
    const entry = y + (Number(delays[s.key]) || 0);
    const grad = entry + (Number(years[s.key]) || s.years);
    out.push({ key: s.key, label: s.label, entryYear: entry, gradYear: grad });
    y = grad; // 次の学校は卒業した年の4月に入学
  }
  return out;
}

// ---------------- 日数計算 ----------------

/**
 * from〜to の日数。includeFirst=true で初日算入（両端を含む）、false で初日不算入（民法140条）。
 * 返り値: { days, leapDays: ['YYYY-02-29', ...], segments: [{ year, days }] } / エラー時 { error }
 * segments は数えた日を暦年ごとに分けたもの（利息のうるう年按分に使う）。
 */
export function countDays(fromIso, toIso, includeFirst) {
  const a = parse(fromIso);
  const b = parse(toIso);
  if (!a || !b) return { error: '日付を正しく入力してください' };
  if (b.t < a.t) return { error: '終了日が開始日より前になっています' };
  // 数える最初の日（不算入なら翌日から）
  const start = includeFirst ? a.t : a.t + DAY_MS;
  const days = Math.round((b.t - start) / DAY_MS) + 1;
  if (days <= 0) return { days: 0, leapDays: [], segments: [] };
  const leapDays = [];
  for (let y = new Date(start).getUTCFullYear(); y <= b.y; y++) {
    if (!isLeapYear(y)) continue;
    const t = Date.UTC(y, 1, 29);
    if (t >= start && t <= b.t) leapDays.push(isoOf(t));
  }
  const segments = [];
  for (let y = new Date(start).getUTCFullYear(); y <= b.y; y++) {
    const s = Math.max(start, Date.UTC(y, 0, 1));
    const e = Math.min(b.t, Date.UTC(y, 11, 31));
    if (e >= s) segments.push({ year: y, days: Math.round((e - s) / DAY_MS) + 1, leap: isLeapYear(y) });
  }
  return { days, leapDays, segments };
}

// ---------------- 利息計算 ----------------

/**
 * 利息（遅延損害金）の計算。
 * opts: { principal, rateType: 'annual'|'daily', rate,  // 年利(%) または 日歩(銭)
 *         days?, from?, to?, includeFirst, basis: '365'|'366'|'actual', rounding: 'floor'|'round' }
 * basis: 365=年365日の日割, 366=年366日の日割, actual=うるう年の日は366日・それ以外は365日で按分
 * 返り値: { interest, total, days, leapDays, formula } / { error }
 */
export function calcInterest(opts) {
  const principal = Number(opts.principal);
  const rate = Number(opts.rate);
  if (!(principal >= 0)) return { error: '元金を入力してください' };
  if (!(rate >= 0)) return { error: '利率を入力してください' };

  let days;
  let leapDays = [];
  let segments = null;
  if (opts.days !== undefined && opts.days !== '' && opts.days !== null) {
    days = Number(opts.days);
    if (!(days >= 0) || !Number.isInteger(days)) return { error: '日数は0以上の整数で入力してください' };
  } else {
    const r = countDays(opts.from, opts.to, !!opts.includeFirst);
    if (r.error) return r;
    days = r.days;
    leapDays = r.leapDays;
    segments = r.segments;
  }

  const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;
  let raw;
  let formula;
  if (opts.rateType === 'daily') {
    // 日歩X銭 = 元金100円につき1日X銭（= X/10000）
    raw = principal * rate / 10000 * days;
    formula = `${yen(principal)} × 日歩${rate}銭（100円につき1日${rate}銭） × ${days}日`;
  } else if (opts.basis === 'actual' && segments) {
    raw = segments.reduce((sum, s) => sum + principal * rate / 100 * s.days / (s.leap ? 366 : 365), 0);
    formula = segments.map((s) => `${yen(principal)} × ${rate}% × ${s.days}日 ÷ ${s.leap ? 366 : 365}日（${s.year}年）`).join(' ＋ ');
  } else {
    const base = opts.basis === '366' ? 366 : 365;
    raw = principal * rate / 100 * days / base;
    formula = `${yen(principal)} × ${rate}% × ${days}日 ÷ ${base}日`;
  }
  // 浮動小数点の誤差（例: 29999.999999）で1円ずれないよう、ごく小さな値を足してから丸める
  const interest = opts.rounding === 'round' ? Math.round(raw + 1e-7) : Math.floor(raw + 1e-7);
  return { interest, total: principal + interest, days, leapDays, formula: `${formula} ＝ ${interest.toLocaleString('ja-JP')}円` };
}
