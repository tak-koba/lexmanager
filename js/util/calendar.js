// web/js/util/calendar.js
// Googleカレンダー追加URL・ICS生成。すべてローカル日付/時刻のコンポーネント演算で行い、
// `new Date(isoString).toISOString()` のようなUTC変換由来のズレを起こさない。

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateOnly(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function parseDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s));
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
  };
}

function isDateTime(dateOrDateTime) {
  return /T\d{2}:\d{2}/.test(String(dateOrDateTime));
}

function nextLocalDate({ y, mo, d }) {
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + 1);
  return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate() };
}

function toCompactDate({ y, mo, d }) {
  return `${y}${pad2(mo)}${pad2(d)}`;
}

function addOneHour({ y, mo, d, h, mi }) {
  const dt = new Date(y, mo - 1, d, h, mi);
  dt.setHours(dt.getHours() + 1);
  return {
    y: dt.getFullYear(),
    mo: dt.getMonth() + 1,
    d: dt.getDate(),
    h: dt.getHours(),
    mi: dt.getMinutes(),
  };
}

function toCompactDateTime({ y, mo, d, h, mi }) {
  return `${y}${pad2(mo)}${pad2(d)}T${pad2(h)}${pad2(mi)}00`;
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.dateOrDateTime 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'
 * @param {string} [opts.details]
 * @returns {string} Googleカレンダー追加URL
 */
export function googleCalendarUrl({ title, dateOrDateTime, details = '' }) {
  let datesParam;

  if (isDateTime(dateOrDateTime)) {
    const start = parseDateTime(dateOrDateTime);
    const end = addOneHour(start);
    datesParam = `${toCompactDateTime(start)}/${toCompactDateTime(end)}`;
  } else {
    const start = parseDateOnly(dateOrDateTime);
    const end = nextLocalDate(start);
    datesParam = `${toCompactDate(start)}/${toCompactDate(end)}`;
  }

  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(title || '')}`,
    `dates=${datesParam}`,
    `details=${encodeURIComponent(details || '')}`,
    'ctz=Asia/Tokyo',
  ].join('&');

  return `https://calendar.google.com/calendar/render?${params}`;
}

function nowUtcCompact() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  const h = now.getUTCHours();
  const mi = now.getUTCMinutes();
  const s = now.getUTCSeconds();
  return `${y}${pad2(mo)}${pad2(d)}T${pad2(h)}${pad2(mi)}${pad2(s)}`;
}

function genUid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@lexmanager`;
}

/**
 * @param {object} opts
 * @param {string} [opts.uid]
 * @param {string} opts.title
 * @param {string} opts.dateOrDateTime 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'
 * @param {string} [opts.description]
 * @returns {string} ICS本文（CRLF区切り）
 */
export function buildIcs({ uid, title, dateOrDateTime, description = '' }) {
  const finalUid = uid || genUid();
  const dtstamp = `${nowUtcCompact()}Z`;

  let dtstartLine;
  let dtendLine;

  if (isDateTime(dateOrDateTime)) {
    const start = parseDateTime(dateOrDateTime);
    const end = addOneHour(start);
    dtstartLine = `DTSTART;TZID=Asia/Tokyo:${toCompactDateTime(start)}`;
    dtendLine = `DTEND;TZID=Asia/Tokyo:${toCompactDateTime(end)}`;
  } else {
    const start = parseDateOnly(dateOrDateTime);
    const end = nextLocalDate(start);
    dtstartLine = `DTSTART;VALUE=DATE:${toCompactDate(start)}`;
    dtendLine = `DTEND;VALUE=DATE:${toCompactDate(end)}`;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LexManager//LexManager4//JA',
    'BEGIN:VEVENT',
    `UID:${finalUid}`,
    `DTSTAMP:${dtstamp}`,
    dtstartLine,
    dtendLine,
    `SUMMARY:${escapeIcsText(title || '')}`,
    `DESCRIPTION:${escapeIcsText(description || '')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

function escapeIcsText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * ICSファイルをダウンロードさせる。
 * @param {string} filename
 * @param {string} icsText
 */
export function downloadIcs(filename, icsText) {
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
