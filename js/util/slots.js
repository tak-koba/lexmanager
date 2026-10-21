// web/js/util/slots.js
// 空き日程の候補テキストの作成と読み取り（ツール「空き日程の検索」用）。画面から切り離した純粋な処理のみ。
// 例: 2026年10月22日(木)　10:00-14:00の間
//     10月23日(金)　10:00-11:00、13:00-15:00の間又は18:00-19:00

const WD = ['日', '月', '火', '水', '木', '金', '土'];

function minutes(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 「2026年10月21日(水)」（withYear=false なら「10月21日(水)」） */
export function formatDay(iso, withYear) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withYear ? `${y}年` : ''}${m}月${d}日(${wd})`;
}

/**
 * 検索結果 [{date, slots:[{start,end}]}] → 候補テキスト（1日1行）。
 * 必要な空き時間ちょうどの枠は「10:00-11:00」、それより長い枠は「10:00-14:00の間」。複数の枠は「、」でつなぎ、最後だけ「又は」。
 */
export function formatSlots(days, minMinutes, withYear) {
  return days.map((d) => {
    const items = d.slots.map((s) => {
      const range = `${s.start}-${s.end}`;
      return minutes(s.end) - minutes(s.start) > Number(minMinutes) ? `${range}の間` : range;
    });
    const joined = items.length > 1 ? `${items.slice(0, -1).join('、')}又は${items[items.length - 1]}` : items[0];
    return `${formatDay(d.date, withYear)}　${joined}`;
  }).join('\n');
}

/**
 * 候補テキスト（利用者が直したもの）を読み取り、登録する時間帯の一覧にする。
 * 年の書いていない日付は、今日より1か月以上前になる場合だけ翌年とみなす。
 * 返り値: { slots: [{date, start, end}], errors: ['読めなかった行', ...] }
 */
export function parseSlots(text, todayIso) {
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  const slots = [];
  const errors = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':').trim();
    if (!line) continue;
    const dm = /(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(line);
    const times = [...line.matchAll(/(\d{1,2}):(\d{2})\s*[-－–―〜~]\s*(\d{1,2}):(\d{2})/g)];
    if (!dm || !times.length) { errors.push(raw); continue; }
    const m = Number(dm[2]);
    const d = Number(dm[3]);
    let y = dm[1] ? Number(dm[1]) : new Date(todayIso).getUTCFullYear();
    if (!dm[1] && Date.UTC(y, m - 1, d) < today - 31 * 86400000) y += 1;
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const check = new Date(`${date}T00:00:00Z`);
    if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) { errors.push(raw); continue; }
    for (const t of times) {
      const start = `${pad(t[1])}:${t[2]}`;
      const end = `${pad(t[3])}:${t[4]}`;
      if (minutes(end) <= minutes(start)) { errors.push(raw); continue; }
      slots.push({ date, start, end });
    }
  }
  return { slots, errors };
}
