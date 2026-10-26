// LexManager 4 - 全体検索（#/search?q=...）
import { el, clear } from '../ui/dom.js';
import { displayName, kanaName, renderDeadlineBadge, opponentName, todoTaskText, calendarBadge, conflictResultList } from './_shared.js';
import { findConflicts } from '../util/conflict.js';
import { clientEmails } from '../model.js';

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, '検索'));

  const initialQ = (params && params.q) || parseQFromHash();
  const initialCc = (params && params.cc === '1') || parseQFromHash('cc') === '1';

  const input = el('input', { type: 'search', class: 'field search-input', placeholder: '氏名・会社名・電話・メール・住所・案件名・相手方・裁判所・メモ本文で検索', value: initialQ || '', 'aria-label': '検索する言葉' });
  container.appendChild(input);
  // オプション: コンフリクトチェック（利益相反の確認。DESIGN.md §17）
  const ccToggle = el('input', { type: 'checkbox', checked: initialCc });
  container.appendChild(el('label', { class: 'field-row search-option' }, [ccToggle,
    el('span', {}, ['コンフリクトチェック（利益相反の確認）', el('span', { class: 'text-muted' }, ' … 入れた名前・電話・メールを、既存の顧客・各案件の相手方・相手方代理人と照合します。全角/半角・カタカナ/ひらがな・「株式会社」等の違いは無視して比べます。複数は「、」区切り。')])]));

  const resultsBox = el('div', { class: 'list-box' });
  container.appendChild(resultsBox);

  let all;
  try {
    all = await ctx.store.all();
  } catch (e) {
    resultsBox.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
    return;
  }

  function updateHash(q) {
    const newHash = `#/search?q=${encodeURIComponent(q)}${ccToggle.checked ? '&cc=1' : ''}`;
    if (location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }

  function runSearch() {
    const q = input.value.trim();
    updateHash(q);
    clear(resultsBox);
    if (!q) {
      resultsBox.appendChild(el('p', { class: 'text-muted' }, ccToggle.checked ? '照合する名前・電話番号・メールアドレスを入力してください' : '検索語を入力してください'));
      return;
    }
    if (ccToggle.checked) {
      // 「、」「,」区切りで複数。@ を含むものはメール、数字が10桁以上のものは電話、それ以外は名前として照合
      const parts = q.split(/[,、，\n]/).map((s) => s.trim()).filter(Boolean);
      const query = { names: [], phones: [], emails: [] };
      for (const p of parts) {
        if (p.includes('@')) query.emails.push(p);
        else if (p.replace(/[^0-9０-９]/g, '').length >= 10) query.phones.push(p);
        else query.names.push(p);
      }
      resultsBox.appendChild(el('h3', {}, 'コンフリクトチェックの結果'));
      resultsBox.appendChild(conflictResultList(findConflicts(query, all)));
      return;
    }
    const ql = q.toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');

    const clientMatches = (all.clients || []).filter((c) => {
      const name = displayName(c).toLowerCase();
      const kana = kanaName(c).toLowerCase();
      const company = (c.companyName || '').toLowerCase();
      const email = clientEmails(c).join(' ').toLowerCase();
      const addr = `${c.mainAddr || ''}${c.prevAddr || ''}`.toLowerCase();
      const notes = (c.notes || '').toLowerCase();
      const phones = (c.phones || []).map((p) => (p.number || '').replace(/[^0-9]/g, ''));
      if (name.includes(ql) || kana.includes(ql) || company.includes(ql) || email.includes(ql) || addr.includes(ql) || notes.includes(ql)) return true;
      if (qDigits && phones.some((p) => p.includes(qDigits))) return true;
      return false;
    });

    const clientById = new Map((all.clients || []).map((c) => [c.id, c]));
    const caseMatches = (all.cases || []).filter((c) => {
      const name = (c.caseName || '').toLowerCase();
      const court = (c.trialCourt || '').toLowerCase();
      const notes = (c.notes || '').toLowerCase();
      const minutesText = (c.minutes || []).map((m) => m.content || '').join(' ').toLowerCase();
      const opponents = (c.opponents || []).map((o) => opponentName(o).toLowerCase()).join(' ');
      const clientNames = (c.clientIds || []).map((id) => {
        const cl = clientById.get(id);
        return cl ? displayName(cl).toLowerCase() : '';
      }).join(' ');
      return name.includes(ql) || court.includes(ql) || notes.includes(ql) || minutesText.includes(ql) || opponents.includes(ql) || clientNames.includes(ql);
    });

    const todoMatches = (all.todos || []).filter((t) => {
      const title = `${t.task || ''} ${t.title || ''}`.toLowerCase();
      const notes = (t.notes || '').toLowerCase();
      const extra = [t.caseLabel, t.requester, t.mail && t.mail.subject, t.mail && t.mail.from].filter(Boolean).join(' ').toLowerCase();
      return title.includes(ql) || notes.includes(ql) || extra.includes(ql);
    });

    if (!clientMatches.length && !caseMatches.length && !todoMatches.length) {
      resultsBox.appendChild(el('p', { class: 'text-muted' }, '該当する結果はありません'));
      return;
    }

    if (clientMatches.length) {
      resultsBox.appendChild(el('h3', {}, `顧客 (${clientMatches.length})`));
      const list = el('ul', { class: 'list' });
      for (const c of clientMatches) {
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate(`#/clients/${c.id}`) }, displayName(c) || '(名称未設定)'));
      }
      resultsBox.appendChild(list);
    }

    if (caseMatches.length) {
      resultsBox.appendChild(el('h3', {}, `案件 (${caseMatches.length})`));
      const list = el('ul', { class: 'list' });
      for (const c of caseMatches) {
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate(`#/cases/${c.id}`) }, [
          el('span', {}, c.caseName || '(無題の案件)'),
          renderDeadlineBadge(c.nextDate)
        ]));
      }
      resultsBox.appendChild(list);
    }

    if (todoMatches.length) {
      resultsBox.appendChild(el('h3', {}, `ToDo (${todoMatches.length})`));
      const list = el('ul', { class: 'list' });
      for (const t of todoMatches) {
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate(t.caseId ? `#/cases/${t.caseId}` : '#/todos') }, [
          el('div', { class: 'row-main' }, [
            t.done ? el('span', { class: 'chip' }, '完了') : renderDeadlineBadge(t.deadline),
            el('span', {}, todoTaskText(t)),
            calendarBadge(t),
            (t.requester || t.caseLabel) ? el('span', { class: 'text-muted' }, [t.caseLabel, t.requester].filter(Boolean).join(' ／ ')) : null
          ])
        ]));
      }
      resultsBox.appendChild(list);
    }
  }

  input.addEventListener('input', runSearch);
  ccToggle.addEventListener('change', runSearch);
  runSearch();

  setTimeout(() => input.focus(), 0);
}

function parseQFromHash(key = 'q') {
  const hash = location.hash || '';
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return '';
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return params.get(key) || '';
}
