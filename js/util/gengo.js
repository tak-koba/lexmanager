// web/js/util/gengo.js
// 和暦変換。境界値はレガシーアプリ（docs/legacy/index_pc_v1.3.html）を正とする。

const ERAS = [
  { name: '令和', base: 2018, startY: 2019, startM: 5, startD: 1 },
  { name: '平成', base: 1988, startY: 1989, startM: 1, startD: 8 },
  { name: '昭和', base: 1925, startY: 1926, startM: 12, startD: 25 },
  { name: '大正', base: 1911, startY: 1912, startM: 7, startD: 30 },
  { name: '明治', base: 1867, startY: -Infinity, startM: 0, startD: 0 },
];

function parseIsoDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * 'YYYY-MM-DD' → '令和7年9月24日' 形式（元年は「令和元年」）
 * @param {string} isoDate
 * @returns {string}
 */
export function toWareki(isoDate) {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return '';
  const { y, m, d } = parsed;

  let era = null;
  for (const e of ERAS) {
    if (e.name === '明治') {
      era = e;
      break;
    }
    if (y > e.startY || (y === e.startY && (m > e.startM || (m === e.startM && d >= e.startD)))) {
      era = e;
      break;
    }
  }
  if (!era) era = ERAS[ERAS.length - 1];

  const warekiYear = y - era.base;
  const yearStr = warekiYear === 1 ? '元年' : `${warekiYear}年`;
  return `${era.name}${yearStr}${m}月${d}日`;
}

/**
 * 和暦→西暦。kanenStr は数値または '元'。
 * @param {string} era 元号名（令和/平成/昭和/大正/明治）
 * @param {number|string} kanenStr
 * @returns {number} 4桁の西暦年
 */
export function toSeireki(era, kanenStr) {
  const found = ERAS.find((e) => e.name === era);
  if (!found) return NaN;
  const kanen = kanenStr === '元' ? 1 : Number(kanenStr);
  return found.base + kanen;
}

/**
 * 満年齢の計算。atIso 省略時はローカルの今日。
 * @param {string} birthdayIso 'YYYY-MM-DD'
 * @param {string} [atIso]
 * @returns {number}
 */
export function calcAge(birthdayIso, atIso) {
  const b = parseIsoDate(birthdayIso);
  if (!b) return NaN;

  let at;
  if (atIso) {
    at = parseIsoDate(atIso);
  } else {
    const now = new Date();
    at = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }
  if (!at) return NaN;

  let age = at.y - b.y;
  const beforeBirthdayThisYear = at.m * 100 + at.d < b.m * 100 + b.d;
  if (beforeBirthdayThisYear) age--;
  return age;
}
