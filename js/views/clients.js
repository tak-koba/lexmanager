// LexManager 4 - 顧客一覧
import { el, clear } from '../ui/dom.js';
import { displayName, kanaName, sortByKana, quickCreateClientDialog } from './_shared.js';

const persisted = { q: '', typeFilter: 'all', archFilter: 'active', sort: 'kana' };

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, '顧客'));

  // 絞込条件は画面移動しても保持する（モジュール変数）
  const state = persisted;

  const toolbar = el('div', { class: 'toolbar' });
  const searchInput = el('input', { type: 'search', placeholder: '氏名・かな・会社名・電話・メールで検索', class: 'field', value: state.q });
  searchInput.addEventListener('input', () => { state.q = searchInput.value; renderList(); });
  toolbar.appendChild(searchInput);

  const chipRow = el('div', { class: 'chip-row' });
  const typeChips = makeChipGroup(chipRow, [
    { value: 'all', label: 'すべて' },
    { value: 'individual', label: '個人' },
    { value: 'corporate', label: '法人' }
  ], state.typeFilter, (v) => { state.typeFilter = v; renderList(); });

  const archChips = makeChipGroup(chipRow, [
    { value: 'active', label: '進行中' },
    { value: 'archived', label: 'アーカイブ' },
    { value: 'all', label: 'すべて' }
  ], state.archFilter, (v) => { state.archFilter = v; renderList(); });

  const sortSelect = el('select', { class: 'field' }, [
    el('option', { value: 'kana' }, '五十音'),
    el('option', { value: 'registeredAt' }, '登録日'),
    el('option', { value: 'updatedAt' }, '更新日')
  ]);
  sortSelect.value = state.sort;
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; renderList(); });

  const newBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    const created = await quickCreateClientDialog(ctx);
    if (created) ctx.navigate(`#/clients/${created.id}`);
  } }, '＋新規顧客');

  container.appendChild(toolbar);
  container.appendChild(chipRow);
  container.appendChild(el('div', { class: 'toolbar' }, [sortSelect, newBtn]));

  const listBox = el('div', { class: 'list-box' });
  listBox.appendChild(el('p', { class: 'text-muted' }, '読み込み中...'));
  container.appendChild(listBox);

  let clients = [];
  let todos = [];
  try {
    const all = await ctx.store.all();
    clients = all.clients || [];
    todos = all.todos || [];
  } catch (e) {
    clear(listBox);
    listBox.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
    return;
  }

  function openTodoCountByCase() {
    // caseId -> clientIds を持たないので、簡易に「顧客の案件」経由の集計は省く（コスト重視）
    return new Map();
  }
  void openTodoCountByCase; void todos;

  function renderList() {
    clear(listBox);
    let filtered = clients.filter((c) => {
      if (state.typeFilter !== 'all' && c.type !== state.typeFilter) return false;
      if (state.archFilter === 'active' && c.isArchived) return false;
      if (state.archFilter === 'archived' && !c.isArchived) return false;
      return true;
    });
    const q = state.q.trim();
    if (q) {
      const qDigits = q.replace(/[^0-9]/g, '');
      filtered = filtered.filter((c) => {
        const name = displayName(c).toLowerCase();
        const kana = kanaName(c).toLowerCase();
        const company = (c.companyName || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        const phones = (c.phones || []).map((p) => (p.number || '').replace(/[^0-9]/g, ''));
        const ql = q.toLowerCase();
        if (name.includes(ql) || kana.includes(ql) || company.includes(ql) || email.includes(ql)) return true;
        if (qDigits && phones.some((p) => p.includes(qDigits))) return true;
        return false;
      });
    }

    if (state.sort === 'kana') {
      filtered = sortByKana(filtered, kanaName);
    } else if (state.sort === 'registeredAt') {
      filtered = filtered.slice().sort((a, b) => (b.registeredAt || '').localeCompare(a.registeredAt || ''));
    } else {
      filtered = filtered.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    }

    if (!filtered.length) {
      listBox.appendChild(el('p', { class: 'text-muted' }, '該当する顧客はいません'));
      return;
    }

    const list = el('ul', { class: 'list' });
    for (const c of filtered) {
      const phone = (c.phones && c.phones[0] && c.phones[0].number) || '';
      list.appendChild(el('li', { class: ['list-row', c.id === params.activeId ? 'active' : ''], tabindex: '0', role: 'link', onClick: () => ctx.navigate(`#/clients/${c.id}`), onKeydown: (e) => { if (e.key === 'Enter') ctx.navigate(`#/clients/${c.id}`); } }, [
        el('span', { class: 'chip' }, c.type === 'corporate' ? '法人' : '個人'),
        el('span', { class: 'list-row-name' }, displayName(c) || '(名称未設定)'),
        el('span', { class: 'text-muted' }, phone),
        c.isArchived ? el('span', { class: 'chip' }, 'アーカイブ') : null
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
        buttons.forEach((b, i) => b.el.classList.toggle('chip-active', options[i].value === current));
        onChange(current);
      }
    }, opt.label);
    wrap.appendChild(btn);
    return { el: btn, value: opt.value };
  });
  container.appendChild(wrap);
  return wrap;
}
