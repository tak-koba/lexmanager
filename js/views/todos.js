// LexManager 4 - ToDo一覧
// 案件ごとのまとまりで表示する。閲覧中は完了チェックだけ即時保存、まとまりごとの［編集］で
// そのまとまりのToDoを入力欄にし、［保存］でまとめて保存する（DESIGN.md §6）。
// 列はThunderbird「要返信orタスク」に合わせる（完了｜期限｜依頼者｜タスク・詳細。案件名はまとまりの見出し）。
import { el, clear } from '../ui/dom.js';
import { confirmDialog } from '../ui/dialog.js';
import {
  quickCreateTodoDialog, sortByKana, suggestCase,
  todoViewRow, todoGroupEditor, commitTodoPlan, editIconButton
} from './_shared.js';

// 絞込・並び順は画面移動しても保持する（モジュール変数）
const persisted = { statusFilter: 'open', deadlineFilter: 'all', groupSort: 'deadline' };

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, 'ToDo'));
  const state = persisted;

  const chipRow = el('div', { class: 'chip-row' });
  makeChipGroup(chipRow, [
    { value: 'open', label: '未完了' },
    { value: 'done', label: '完了' },
    { value: 'all', label: 'すべて' }
  ], state.statusFilter, (v) => { state.statusFilter = v; renderList(); });
  makeChipGroup(chipRow, [
    { value: 'all', label: '期限すべて' },
    { value: 'with', label: '期限あり' },
    { value: 'without', label: '期限なし' }
  ], state.deadlineFilter, (v) => { state.deadlineFilter = v; renderList(); });
  makeChipGroup(chipRow, [
    { value: 'deadline', label: '期限の近い順' },
    { value: 'case', label: '案件名順' }
  ], state.groupSort, (v) => { state.groupSort = v; renderList(); });
  container.appendChild(chipRow);

  const listBox = el('div', { class: 'list-box' });
  listBox.appendChild(el('p', { class: 'text-muted' }, '読み込み中...'));
  container.appendChild(listBox);

  let todos = [];
  let cases = [];
  let clients = [];
  try {
    const all = await ctx.store.all();
    todos = all.todos || [];
    cases = all.cases || [];
    clients = all.clients || [];
  } catch (e) {
    clear(listBox);
    listBox.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
    return;
  }
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  // ---- 追加（内容・期限・案件だけですぐ登録） ----
  const titleInput = el('input', { type: 'text', class: 'field', placeholder: '新しいToDo（タスク）', 'aria-label': '新しいToDoのタスク' });
  const dateInput = el('input', { type: 'date', class: 'field', 'aria-label': '期限' });
  const timeInput = el('input', { type: 'time', class: 'field', step: 300, 'aria-label': '時刻（任意）' });
  const caseSelect = el('select', { class: 'field', 'aria-label': '案件' }, [
    el('option', { value: '' }, '案件なし'),
    ...sortByKana(cases.filter((c) => !c.isArchived), (c) => c.caseName).map((c) => el('option', { value: c.id }, c.caseName || '(無題)'))
  ]);
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    if (!titleInput.value.trim()) {
      if (await quickCreateTodoDialog(ctx, cases)) await reload();
      return;
    }
    const d = dateInput.value;
    try {
      await ctx.store.create('todos', {
        task: titleInput.value.trim(), title: '', deadline: d ? (timeInput.value ? `${d}T${timeInput.value}` : d) : '',
        caseId: caseSelect.value, caseLabel: '', requester: '', clientId: '', done: false, doneAt: '', notes: ''
      });
      ctx.toast('ToDoを追加しました', 'success');
      titleInput.value = ''; dateInput.value = ''; timeInput.value = ''; caseSelect.value = '';
      syncAddOpen();
      await reload();
    } catch (e) {
      ctx.toast('追加に失敗しました: ' + e.message, 'error');
    }
  } }, '追加');
  // 狭い画面では、内容を入力し始めるまで期限・案件の欄を隠す（CSS: .todo-add-open）
  const syncAddOpen = () => addBox.classList.toggle('todo-add-open', !!titleInput.value);
  titleInput.addEventListener('input', syncAddOpen);
  const addBox = el('div', { class: 'todo-add' }, [
    titleInput,
    el('div', { class: 'todo-add-sub' }, [dateInput, timeInput, caseSelect, addBtn])
  ]);
  container.insertBefore(addBox, listBox);

  // ---- まとまりごとの編集状態（同時に1つだけ） ----
  let editingKey = null;
  let editor = null;
  let dirty = false;
  ctx.unsavedGuard.set(() => !!editingKey && dirty);

  async function reload() {
    const all = await ctx.store.all();
    todos = all.todos || [];
    renderList();
  }

  function groupKeyOf(t) {
    if (t.caseId && caseById.has(t.caseId)) return `c:${t.caseId}`;
    if ((t.caseLabel || '').trim()) return `l:${t.caseLabel.trim()}`;
    return 'none';
  }

  function renderList() {
    clear(listBox);
    const filtered = todos.filter((t) => {
      if (state.statusFilter === 'open' && t.done) return false;
      if (state.statusFilter === 'done' && !t.done) return false;
      if (state.deadlineFilter === 'with' && !t.deadline) return false;
      if (state.deadlineFilter === 'without' && t.deadline) return false;
      return true;
    });
    const groups = new Map();
    for (const t of filtered) {
      const k = groupKeyOf(t);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    // 編集中のまとまりは、絞込で空になっても表示を続ける
    if (editingKey && !editingKey.startsWith('item:') && !groups.has(editingKey)) groups.set(editingKey, []);
    if (!groups.size) {
      listBox.appendChild(el('p', { class: 'text-muted' }, '該当するToDoはありません'));
      return;
    }
    const byDeadline = (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999');
    let entries = [...groups.entries()].map(([key, items]) => ({ key, items: items.sort(byDeadline), ...groupInfo(key) }));
    if (state.groupSort === 'case') {
      entries = sortByKana(entries, (g) => (g.key === 'none' ? '' : g.name));
    } else {
      const first = (g) => (g.items[0] && g.items[0].deadline) || '9999';
      entries.sort((a, b) => first(a).localeCompare(first(b)));
    }
    const board = el('div', { class: 'todo-board' });
    board.appendChild(el('div', { class: 'todo-item todo-item-wc todo-item-header', 'aria-hidden': 'true' }, [
      el('div', { class: 'todo-item-check' }, '完了'), el('div', { class: 'todo-item-deadline' }, '期限'),
      el('div', { class: 'todo-item-requester' }, '依頼者'), el('div', { class: 'todo-item-case' }, '案件'),
      el('div', { class: 'todo-item-body' }, 'タスク・詳細')
    ]));
    for (const g of entries) board.appendChild(renderGroup(g));
    listBox.appendChild(board);
  }

  function groupInfo(key) {
    if (key.startsWith('c:')) {
      const c = caseById.get(key.slice(2));
      return { name: (c && c.caseName) || '(無題の案件)', caseObj: c, label: '' };
    }
    if (key.startsWith('l:')) return { name: key.slice(2), caseObj: null, label: key.slice(2) };
    return { name: '案件なし', caseObj: null, label: '' };
  }

  function renderGroup(g) {
    const editing = editingKey === g.key;
    const section = el('section', { class: ['todo-group', editing ? 'todo-group-editing' : ''] });

    const titleNode = g.caseObj
      ? el('a', { href: `#/cases/${g.caseObj.id}`, class: 'todo-group-title' }, g.name)
      : el('span', { class: 'todo-group-title' }, g.name);
    const headLeft = el('div', { class: 'todo-group-name' }, [
      titleNode,
      g.label ? el('span', { class: 'chip' }, '未紐付け') : null,
      el('span', { class: 'text-muted todo-group-count' }, `${g.items.length}件`)
    ]);
    const actions = el('div', { class: 'todo-group-actions' });
    if (editing) {
      actions.appendChild(el('button', { type: 'button', class: 'btn', onClick: cancelEdit }, 'キャンセル'));
      actions.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: saveEdit }, '保存'));
    } else {
      // 同期された案件名と同じ名前の案件があれば、まとめて紐付けるボタン（テキストは残る）
      const hit = g.label ? suggestCase(g.label, cases) : null;
      if (hit) {
        actions.appendChild(el('button', { type: 'button', class: 'btn btn-small', title: '案件名のテキストはそのまま残ります', onClick: () => linkGroup(g, hit) }, '🔗 案件に紐付け'));
      }
      actions.appendChild(editIconButton(() => startEdit(g), { label: 'このまとまりのToDoをまとめて編集', disabled: !!editingKey }));
    }
    section.appendChild(el('div', { class: 'todo-group-head' }, [headLeft, actions]));

    if (editing) {
      section.appendChild(editor.node);
    } else {
      const list = el('div', { class: 'todo-items' });
      for (const t of g.items) {
        if (editingKey === `item:${t.id}`) {
          // 1件だけの編集（行の位置で入力欄に切り替える）
          list.appendChild(el('div', { class: 'todo-item-editing' }, [
            editor.node,
            el('div', { class: 'todo-group-actions' }, [
              el('button', { type: 'button', class: 'btn', onClick: cancelEdit }, 'キャンセル'),
              el('button', { type: 'button', class: 'btn btn-primary', onClick: saveEdit }, '保存')
            ])
          ]));
          continue;
        }
        list.appendChild(todoViewRow(ctx, t, { caseById, clientById, showCase: true, onEdit: () => startItemEdit(t), editDisabled: !!editingKey,
          onChanged: (saved) => {
            const i = todos.findIndex((x) => x.id === saved.id);
            if (i >= 0) todos[i] = saved;
            renderList();
          } }));
      }
      section.appendChild(list);
    }
    return section;
  }

  function startEdit(g) {
    editingKey = g.key;
    dirty = false;
    const newDefaults = g.caseObj ? { caseId: g.caseObj.id } : (g.label ? { caseLabel: g.label } : {});
    editor = todoGroupEditor({ todos: g.items, cases, clients, newDefaults });
    editor.node.addEventListener('input', () => { dirty = true; });
    editor.node.addEventListener('change', () => { dirty = true; });
    editor.node.addEventListener('click', (e) => { if (e.target.closest('button')) dirty = true; });
    renderList();
  }

  function startItemEdit(t) {
    editingKey = `item:${t.id}`;
    dirty = false;
    editor = todoGroupEditor({ todos: [t], cases, clients, allowAdd: false });
    editor.node.addEventListener('input', () => { dirty = true; });
    editor.node.addEventListener('change', () => { dirty = true; });
    editor.node.addEventListener('click', (e) => { if (e.target.closest('button')) dirty = true; });
    renderList();
  }

  async function cancelEdit() {
    if (dirty && !(await confirmDialog('編集内容を破棄しますか？'))) return;
    editingKey = null; editor = null; dirty = false;
    renderList();
  }

  async function saveEdit() {
    const plan = editor.collect();
    if (plan.errors.length) { ctx.toast(plan.errors[0], 'error'); return; }
    const total = plan.creates.length + plan.updates.length + plan.removes.length;
    if (total) {
      const { ok, failed } = await commitTodoPlan(ctx, plan);
      ctx.toast(failed ? `${ok}件保存、${failed}件は保存できませんでした` : `${ok}件保存しました`, failed ? 'error' : 'success');
    }
    editingKey = null; editor = null; dirty = false;
    await reload();
  }

  async function linkGroup(g, caseObj) {
    if (!(await confirmDialog(`「${g.label}」のToDo ${g.items.length}件を案件「${caseObj.caseName}」に紐付けますか？（案件名のテキストは残ります）`))) return;
    const { ok, failed } = await commitTodoPlan(ctx, {
      creates: [], removes: [], updates: g.items.map((t) => ({ base: t, payload: { ...t, caseId: caseObj.id } }))
    });
    ctx.toast(failed ? `${ok}件紐付け、${failed}件は失敗しました` : `${ok}件を紐付けました`, failed ? 'error' : 'success');
    await reload();
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
