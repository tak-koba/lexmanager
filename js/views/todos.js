// LexManager 4 - ToDo一覧
import { el, clear } from '../ui/dom.js';
import { renderDeadlineBadge, sortByKana, quickCreateTodoDialog, editTodoDialog } from './_shared.js';

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, 'ToDo'));

  const state = { statusFilter: 'open', deadlineFilter: 'all', sort: 'deadline' };

  const chipRow = el('div', { class: 'chip-row' });
  makeChipGroup(chipRow, [
    { value: 'open', label: '未完了' },
    { value: 'done', label: '完了' },
    { value: 'all', label: 'すべて' }
  ], 'open', (v) => { state.statusFilter = v; renderList(); });
  makeChipGroup(chipRow, [
    { value: 'all', label: 'すべて' },
    { value: 'with', label: '期限あり' },
    { value: 'without', label: '期限なし' }
  ], 'all', (v) => { state.deadlineFilter = v; renderList(); });

  const sortSelect = el('select', { class: 'field' }, [
    el('option', { value: 'deadline' }, '期限'),
    el('option', { value: 'kana' }, '案件名'),
    el('option', { value: 'registeredAt' }, '登録順')
  ]);
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; renderList(); });

  container.appendChild(chipRow);
  container.appendChild(el('div', { class: 'toolbar' }, [sortSelect]));

  const addRow = el('div', { class: 'toolbar' });
  const titleInput = el('input', { type: 'text', class: 'field', placeholder: '新しいToDo' });
  const deadlineInput = el('input', { type: 'date', class: 'field' });
  addRow.appendChild(titleInput);
  addRow.appendChild(deadlineInput);
  container.appendChild(addRow);

  const listBox = el('div', { class: 'list-box' });
  listBox.appendChild(el('p', { class: 'text-muted' }, '読み込み中...'));
  container.appendChild(listBox);

  let todos = [];
  let cases = [];
  try {
    const all = await ctx.store.all();
    todos = all.todos || [];
    cases = all.cases || [];
  } catch (e) {
    clear(listBox);
    listBox.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
    return;
  }

  const addBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    if (titleInput.value) {
      try {
        await ctx.store.create('todos', { title: titleInput.value, deadline: deadlineInput.value, caseId: '', done: false, doneAt: '', notes: '' });
        ctx.toast('ToDoを追加しました', 'success');
        render(container, params, ctx);
      } catch (e) {
        ctx.toast('追加に失敗しました: ' + e.message, 'error');
      }
    } else {
      await quickCreateTodoDialog(ctx, cases);
      render(container, params, ctx);
    }
  } }, '追加');
  addRow.appendChild(addBtn);

  const caseById = new Map(cases.map((c) => [c.id, c]));

  function renderList() {
    clear(listBox);
    let filtered = todos.filter((t) => {
      if (state.statusFilter === 'open' && t.done) return false;
      if (state.statusFilter === 'done' && !t.done) return false;
      if (state.deadlineFilter === 'with' && !t.deadline) return false;
      if (state.deadlineFilter === 'without' && t.deadline) return false;
      return true;
    });

    if (state.sort === 'deadline') {
      filtered = filtered.slice().sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    } else if (state.sort === 'kana') {
      filtered = sortByKana(filtered.slice(), (t) => {
        const c = caseById.get(t.caseId);
        return c ? c.caseName : '';
      });
    } else {
      filtered = filtered.slice(); // 登録順（元の並び）
    }

    if (!filtered.length) {
      listBox.appendChild(el('p', { class: 'text-muted' }, '該当するToDoはいません'));
      return;
    }

    const list = el('ul', { class: 'list' });
    for (const t of filtered) {
      const c = caseById.get(t.caseId);
      const cb = el('input', { type: 'checkbox', checked: !!t.done, onChange: async () => {
        try {
          await ctx.store.update('todos', { ...t, done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : '' }, t);
          ctx.toast('更新しました', 'success');
          const all = await ctx.store.all();
          todos = all.todos || [];
          renderList();
        } catch (e) {
          ctx.toast('更新に失敗しました: ' + e.message, 'error');
        }
      } });
      const row = el('li', { class: 'list-row' }, [
        cb,
        renderDeadlineBadge(t.deadline),
        el('button', { type: 'button', class: 'list-row-name linklike', onClick: async () => {
          if (await editTodoDialog(ctx, t, cases)) { todos = (await ctx.store.all()).todos || []; renderList(); }
        } }, t.title || '(無題)'),
        c ? el('a', { href: `#/cases/${c.id}`, class: 'text-muted' }, c.caseName) : null
      ]);
      list.appendChild(row);
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
