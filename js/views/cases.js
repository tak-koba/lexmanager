// LexManager 4 - 案件一覧
import { el, clear } from '../ui/dom.js';
import { displayName, renderDeadlineBadge, quickCreateCaseDialog } from './_shared.js';

const persisted = { q: '', typeFilter: 'all', statusFilter: 'active', sort: 'registeredAt' };

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, '案件'));

  // 絞込条件は画面移動しても保持する（モジュール変数）
  const state = persisted;

  const toolbar = el('div', { class: 'toolbar' });
  const searchInput = el('input', { type: 'search', placeholder: '案件名で検索', class: 'field', value: state.q });
  searchInput.addEventListener('input', () => { state.q = searchInput.value; renderList(); });
  toolbar.appendChild(searchInput);

  const chipRow = el('div', { class: 'chip-row' });
  makeChipGroup(chipRow, [
    { value: 'all', label: 'すべて' },
    { value: 'client', label: '顧客案件' },
    { value: 'court', label: '裁判所案件' }
  ], state.typeFilter, (v) => { state.typeFilter = v; renderList(); });
  makeChipGroup(chipRow, [
    { value: 'active', label: '進行中' },
    { value: 'archived', label: '終了' },
    { value: 'all', label: 'すべて' }
  ], state.statusFilter, (v) => { state.statusFilter = v; renderList(); });

  const sortSelect = el('select', { class: 'field' }, [
    el('option', { value: 'registeredAt' }, '登録日'),
    el('option', { value: 'nextDate' }, '次回期日'),
    el('option', { value: 'updatedAt' }, '更新日')
  ]);
  sortSelect.value = state.sort;
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; renderList(); });

  const newBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    const all = await ctx.store.all();
    const created = await quickCreateCaseDialog(ctx, all.clients);
    if (created) ctx.navigate(`#/cases/${created.id}`);
  } }, '＋新規案件');

  container.appendChild(toolbar);
  container.appendChild(chipRow);
  container.appendChild(el('div', { class: 'toolbar' }, [sortSelect, newBtn]));

  const listBox = el('div', { class: 'list-box' });
  listBox.appendChild(el('p', { class: 'text-muted' }, '読み込み中...'));
  container.appendChild(listBox);

  let cases = [];
  let clients = [];
  try {
    const all = await ctx.store.all();
    cases = all.cases || [];
    clients = all.clients || [];
  } catch (e) {
    clear(listBox);
    listBox.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
    return;
  }

  const clientById = new Map(clients.map((c) => [c.id, c]));

  function resolveClientNames(caseRec) {
    return (caseRec.clientIds || []).map((id) => {
      const c = clientById.get(id);
      return c ? displayName(c) : '(不明)';
    }).join('、');
  }

  function renderList() {
    clear(listBox);
    let filtered = cases.filter((c) => {
      if (state.typeFilter !== 'all' && c.caseType !== state.typeFilter) return false;
      if (state.statusFilter === 'active' && c.isArchived) return false;
      if (state.statusFilter === 'archived' && !c.isArchived) return false;
      return true;
    });
    const q = state.q.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((c) => (c.caseName || '').toLowerCase().includes(q) || resolveClientNames(c).toLowerCase().includes(q));
    }

    if (state.sort === 'nextDate') {
      filtered = filtered.slice().sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999'));
    } else if (state.sort === 'updatedAt') {
      filtered = filtered.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    } else {
      filtered = filtered.slice().sort((a, b) => (b.registeredAt || '').localeCompare(a.registeredAt || ''));
    }

    if (!filtered.length) {
      listBox.appendChild(el('p', { class: 'text-muted' }, '該当する案件はいません'));
      return;
    }

    const list = el('ul', { class: 'list' });
    for (const c of filtered) {
      list.appendChild(el('li', { class: ['list-row', c.id === params.activeId ? 'active' : ''], tabindex: '0', role: 'link', onClick: () => ctx.navigate(`#/cases/${c.id}`), onKeydown: (e) => { if (e.key === 'Enter') ctx.navigate(`#/cases/${c.id}`); } }, [
        el('span', { class: 'chip' }, c.caseType === 'court' ? '裁判所案件' : '顧客案件'),
        el('span', { class: 'list-row-name' }, c.caseName || '(無題の案件)'),
        el('span', { class: 'text-muted' }, resolveClientNames(c)),
        renderDeadlineBadge(c.nextDate)
      ]));
    }
    listBox.appendChild(list);
  }

  renderList();
}

function makeChipGroup(container, options, initial, onChange) {
  const wrap = el('div', { class: 'chip-group' });
  let current = initial;
  const buttons = options.map((opt) => {
    const btn = el('button', {
      type: 'button',
      class: ['chip', opt.value === initial ? 'chip-active' : ''],
      onClick: () => {
        current = opt.value;
        buttons.forEach((b, i) => b.classList.toggle('chip-active', options[i].value === current));
        onChange(current);
      }
    }, opt.label);
    wrap.appendChild(btn);
    return btn;
  });
  container.appendChild(wrap);
  return wrap;
}
