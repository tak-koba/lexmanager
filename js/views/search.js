// LexManager 4 - 全体検索（#/search?q=...）
import { el, clear } from '../ui/dom.js';
import { displayName, kanaName, renderDeadlineBadge, opponentName } from './_shared.js';

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, '検索'));

  const initialQ = (params && params.q) || parseQFromHash();

  const input = el('input', { type: 'search', class: 'field search-input', placeholder: '氏名・会社名・電話・メール・住所・案件名・相手方・裁判所・メモ本文で検索', value: initialQ || '' });
  container.appendChild(input);

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
    const newHash = `#/search?q=${encodeURIComponent(q)}`;
    if (location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }

  function runSearch() {
    const q = input.value.trim();
    updateHash(q);
    clear(resultsBox);
    if (!q) {
      resultsBox.appendChild(el('p', { class: 'text-muted' }, '検索語を入力してください'));
      return;
    }
    const ql = q.toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');

    const clientMatches = (all.clients || []).filter((c) => {
      const name = displayName(c).toLowerCase();
      const kana = kanaName(c).toLowerCase();
      const company = (c.companyName || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
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
      const title = (t.title || '').toLowerCase();
      const notes = (t.notes || '').toLowerCase();
      return title.includes(ql) || notes.includes(ql);
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
          renderDeadlineBadge(t.deadline),
          el('span', {}, t.title || '(無題)')
        ]));
      }
      resultsBox.appendChild(list);
    }
  }

  input.addEventListener('input', runSearch);
  runSearch();

  setTimeout(() => input.focus(), 0);
}

function parseQFromHash() {
  const hash = location.hash || '';
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return '';
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return params.get('q') || '';
}
