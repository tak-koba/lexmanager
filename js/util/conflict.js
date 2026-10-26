// web/js/util/conflict.js
// コンフリクトチェック（利益相反の確認）。DESIGN.md §17
// 新しく登録する人・会社（または案件の相手方）を、既存の顧客・各案件の相手方・相手方代理人と照合する。
// 名前は全角/半角・空白・カタカナ/ひらがな・「株式会社」等の違いを無視して比べる。電話・メールも照合する。
import { displayName, opponentName, clientEmails, normalizePhone } from '../model.js';

// 法人の種類を表す語（NFKC で（株）→(株)、㈱→(株) になったあとの形）
const CORP_WORDS = /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|医療法人社団|医療法人財団|医療法人|学校法人|宗教法人|特定非営利活動法人|npo法人|弁護士法人|税理士法人|司法書士法人|行政書士法人|社会保険労務士法人|監査法人|\(株\)|\(有\)|\(合\)|\(同\)|\(社\)|\(財\)/g;

// 個人のフリーメール等（ドメインが同じでも同じ組織とは言えない）
const FREE_MAIL = new Set(['gmail.com', 'yahoo.co.jp', 'ymail.ne.jp', 'icloud.com', 'me.com', 'mac.com', 'outlook.jp', 'outlook.com',
  'hotmail.com', 'hotmail.co.jp', 'live.jp', 'msn.com', 'docomo.ne.jp', 'ezweb.ne.jp', 'au.com', 'softbank.ne.jp', 'i.softbank.jp', 'nifty.com', 'biglobe.ne.jp']);

/** 名前をそろえる（全角/半角、大文字/小文字、空白・記号、カタカナ→ひらがな、法人の種類の語を除く） */
export function normName(s) {
  let v = String(s || '').normalize('NFKC').toLowerCase();
  v = v.replace(CORP_WORDS, '');
  v = v.replace(/[\s・.,、。'"’`\-‐－()（）「」]/g, ''); // 空白・記号を除く（長音「ー」は残す）
  v = v.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return v;
}

function normPhone(s) {
  const d = normalizePhone(String(s || '').normalize('NFKC')).replace(/[^0-9]/g, '');
  return d.length >= 10 ? d : '';
}

function normEmail(s) {
  const v = String(s || '').normalize('NFKC').trim().toLowerCase();
  return v.includes('@') ? v : '';
}

function domainOf(email) {
  const d = email.split('@')[1] || '';
  return d && !FREE_MAIL.has(d) ? d : '';
}

/** 照合のための「名前・電話・メール」の組を作る */
export function partyKeys({ names = [], phones = [], emails = [] }) {
  return {
    names: [...new Set(names.map(normName).filter((n) => n.length >= 2))],
    phones: [...new Set(phones.map(normPhone).filter(Boolean))],
    emails: [...new Set(emails.map(normEmail).filter(Boolean))]
  };
}

/** 顧客レコードから照合用の情報 */
export function clientParty(c) {
  const names = [displayName(c), `${c.lastNameKana || ''}${c.firstNameKana || ''}`, c.companyNameKana, c.representative];
  const phones = (c.phones || []).map((p) => p && p.number);
  return { names, phones, emails: clientEmails(c) };
}

/** 相手方1件から照合用の情報（本人・会社側と、代理人側を分ける） */
export function opponentParties(o) {
  const self = {
    names: [opponentName(o), o.name, `${o.lastNameKana || ''}${o.firstNameKana || ''}`, o.corpRep, o.contactName],
    phones: [o.tel], emails: [o.email]
  };
  const lawyer = { names: [o.lawyerName, o.lawyerOffice], phones: [o.lawyerTel, o.lawyerFax], emails: [o.lawyerEmail] };
  return { self, lawyer };
}

/** 2つの照合情報を比べ、一致の理由を返す（なければ null）。strong=同一の可能性が高い、possible=要確認 */
function compare(q, t) {
  const reasons = [];
  let strong = false;
  for (const a of q.names) {
    for (const b of t.names) {
      if (a === b) { reasons.push('名前が一致'); strong = true; }
      else if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) reasons.push('名前の一部が一致');
    }
  }
  if (q.phones.some((p) => t.phones.includes(p))) { reasons.push('電話番号が一致'); strong = true; }
  if (q.emails.some((e) => t.emails.includes(e))) { reasons.push('メールアドレスが一致'); strong = true; }
  else {
    const qd = q.emails.map(domainOf).filter(Boolean);
    if (qd.length && t.emails.map(domainOf).some((d) => qd.includes(d))) reasons.push('メールのドメインが一致');
  }
  if (!reasons.length) return null;
  return { level: strong ? 'strong' : 'possible', reasons: [...new Set(reasons)] };
}

/**
 * 照合する。query: {names, phones, emails}、data: {clients, cases}。
 * excludeClientId: 自分自身（既存顧客の再チェック時）。excludeCaseId: 相手方を照合するときの対象案件。
 * 戻り値: [{kind:'opponent'|'opponentLawyer'|'client'|'caseClient', level, reasons, label, href, caseName}]
 *   opponent       = 既存の案件の相手方（利益相反の可能性）
 *   opponentLawyer = 既存の案件の相手方代理人
 *   client         = 既存の顧客（同一人物・重複登録の可能性）
 */
export function findConflicts(query, data, { excludeClientId = '', excludeCaseId = '' } = {}) {
  const q = partyKeys(query);
  if (!q.names.length && !q.phones.length && !q.emails.length) return [];
  const hits = [];
  const clientById = new Map((data.clients || []).map((c) => [c.id, c]));
  for (const c of data.clients || []) {
    if (c.id === excludeClientId) continue;
    const m = compare(q, partyKeys(clientParty(c)));
    if (m) hits.push({ kind: 'client', ...m, label: displayName(c) || '(名称未設定)', href: `#/clients/${c.id}` });
  }
  for (const k of data.cases || []) {
    if (k.id === excludeCaseId) continue;
    const caseName = k.caseName || '(無題の案件)';
    const clientNames = (k.clientIds || []).map((id) => displayName(clientById.get(id))).filter(Boolean).join('、');
    for (const o of k.opponents || []) {
      const { self, lawyer } = opponentParties(o);
      const m1 = compare(q, partyKeys(self));
      if (m1) hits.push({ kind: 'opponent', ...m1, label: opponentName(o) || o.name || '(名称未設定)', caseName, clientNames, href: `#/cases/${k.id}` });
      const m2 = compare(q, partyKeys(lawyer));
      if (m2) hits.push({ kind: 'opponentLawyer', ...m2, label: [o.lawyerName, o.lawyerOffice].filter(Boolean).join('（') + (o.lawyerName && o.lawyerOffice ? '）' : ''), caseName, clientNames, href: `#/cases/${k.id}` });
    }
  }
  const order = { opponent: 0, opponentLawyer: 1, client: 2 };
  return hits.sort((a, b) => (a.level === b.level ? 0 : a.level === 'strong' ? -1 : 1) || order[a.kind] - order[b.kind]);
}

/** 相手方として入れる人・会社を、既存の顧客（＝依頼者側）と照合する（逆方向のチェック） */
export function findClientConflictsForOpponent(opponent, data, { excludeCaseId = '' } = {}) {
  const { self } = opponentParties(opponent);
  return findConflicts(self, { clients: data.clients || [], cases: (data.cases || []).filter((k) => k.id !== excludeCaseId) })
    .map((h) => (h.kind === 'client' ? { ...h, kind: 'caseClient' } : h));
}

export const CONFLICT_KIND_LABEL = {
  opponent: '相手方として登録あり',
  opponentLawyer: '相手方代理人として登録あり',
  client: '顧客として登録あり',
  caseClient: '顧客（依頼者側）として登録あり'
};

/** 結果の要約（顧客に記録する） */
export function summarizeConflicts(hits) {
  if (!hits.length) return '該当なし';
  const n = (k) => hits.filter((h) => h.kind === k).length;
  return [['opponent', '相手方'], ['opponentLawyer', '相手方代理人'], ['client', '既存顧客']]
    .filter(([k]) => n(k)).map(([k, t]) => `${t}${n(k)}件`).join('・') + 'に該当の可能性';
}
