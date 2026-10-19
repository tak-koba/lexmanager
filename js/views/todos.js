// LexManager 4 - ToDo一覧
// Thunderbird「要返信orタスク」と同じ列（完了｜期限｜案件名｜依頼者｜内容）の表。見出しクリックで並べ替え、
// 各欄は一覧で直接編集（入力欄を離れた時点で保存）、紐付け・メモ等は［詳細］のダイアログで編集する。
import { el, clear } from '../ui/dom.js';
import {
  renderDeadlineBadge, sortByKana, quickCreateTodoDialog, editTodoDialog, saveRecord, displayName,
  todoCaseText, todoRequesterText, suggestCase, suggestClient, todoMailLine
} from './_shared.js';

// 絞込・並び順は画面移動しても保持する（モジュール変数）
const persisted = { statusFilter: 'open', deadlineFilter: 'all', sortKey: 'deadline', sortDir: 1 };

const COLUMNS = [
  { key: 'done', label: '完了' },
  { key: 'deadline', label: '期限' },
  { key: 'case', label: '案件名' },
  { key: 'requester', label: '依頼者' },
  { key: 'title', label: '依頼内容・要対応事項' }
];

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
    { value: 'all', label: 'すべて' },
    { value: 'with', label: '期限あり' },
    { value: 'without', label: '期限なし' }
  ], state.deadlineFilter, (v) => { state.deadlineFilter = v; renderList(); });
  container.appendChild(chipRow);

  const addRow = el('div', { class: 'field-row todo-add-row' });
  const titleInput = el('input', { type: 'text', class: 'field', placeholder: '新しいToDo（内容）' });
  const deadlineInput = el('input', { type: 'date', class: 'field', 'aria-label': '期限' });
  const timeInput = el('input', { type: 'time', class: 'field', step: 300, 'aria-label': '時刻（任意）' });
  addRow.appendChild(titleInput);
  addRow.appendChild(deadlineInput);
  addRow.appendChild(timeInput);
  container.appendChild(addRow);

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

  async function reload() {
    const all = await ctx.store.all();
    todos = all.todos || [];
    renderList();
  }

  const addBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    if (titleInput.value) {
      const d = deadlineInput.value;
      try {
        await ctx.store.create('todos', {
          title: titleInput.value, deadline: d ? (timeInput.value ? `${d}T${timeInput.value}` : d) : '',
          caseId: '', caseLabel: '', requester: '', clientId: '', done: false, doneAt: '', notes: ''
        });
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

  /** 1件の一部項目を保存し、一覧上のレコードを差し替える（再描画しないので次の欄へTab移動できる）。 */
  async function saveField(t, patch) {
    const saved = await saveRecord(ctx, 'todos', t, { ...t, ...patch });
    if (saved) {
      const i = todos.indexOf(t);
      if (i >= 0) todos[i] = saved;
    }
    return saved;
  }

  function sortValue(t, key) {
    switch (key) {
      case 'done': return t.done ? 1 : 0;
      case 'deadline': return t.deadline || '9999';
      case 'case': return todoCaseText(t, caseById);
      case 'requester': return todoRequesterText(t, clientById);
      case 'title': return t.title || '';
      default: return '';
    }
  }

  function renderList() {
    clear(listBox);
    let filtered = todos.filter((t) => {
      if (state.statusFilter === 'open' && t.done) return false;
      if (state.statusFilter === 'done' && !t.done) return false;
      if (state.deadlineFilter === 'with' && !t.deadline) return false;
      if (state.deadlineFilter === 'without' && t.deadline) return false;
      return true;
    });

    const key = state.sortKey;
    if (key === 'case' || key === 'requester' || key === 'title') {
      filtered = sortByKana(filtered.slice(), (t) => sortValue(t, key));
      if (state.sortDir < 0) filtered.reverse();
    } else {
      filtered = filtered.slice().sort((a, b) => {
        const va = sortValue(a, key);
        const vb = sortValue(b, key);
        const r = va < vb ? -1 : va > vb ? 1 : 0;
        return r * state.sortDir || (a.deadline || '9999').localeCompare(b.deadline || '9999');
      });
    }

    if (!filtered.length) {
      listBox.appendChild(el('p', { class: 'text-muted' }, '該当するToDoはいません'));
      return;
    }

    const headRow = el('tr', {}, [
      ...COLUMNS.map((col) => el('th', {
        class: ['todo-th', `todo-col-${col.key}`],
        tabindex: '0',
        'aria-sort': state.sortKey === col.key ? (state.sortDir > 0 ? 'ascending' : 'descending') : null,
        onClick: () => toggleSort(col.key),
        onKeydown: (e) => { if (e.key === 'Enter') toggleSort(col.key); }
      }, [col.label, state.sortKey === col.key ? (state.sortDir > 0 ? ' ▲' : ' ▼') : ''])),
      el('th', { class: 'todo-col-actions' }, '')
    ]);
    const tbody = el('tbody');
    for (const t of filtered) tbody.appendChild(renderRow(t));
    listBox.appendChild(el('div', { class: 'todo-table-wrap' }, el('table', { class: 'todo-table' }, [el('thead', {}, headRow), tbody])));
  }

  function toggleSort(key) {
    if (state.sortKey === key) state.sortDir = -state.sortDir;
    else { state.sortKey = key; state.sortDir = 1; }
    renderList();
  }

  function renderRow(t0) {
    let t = t0;
    const tr = el('tr', { class: t.done ? 'todo-done' : '' });

    // 完了
    const cb = el('input', { type: 'checkbox', checked: !!t.done, 'aria-label': '完了', onChange: async () => {
      if (await saveField(t, { done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : '' })) {
        ctx.toast(cb.checked ? '完了にしました' : '未完了に戻しました', 'success');
        renderList();
      } else {
        cb.checked = !cb.checked;
      }
    } });

    // 期限（日付＋任意の時刻）
    const v = t.deadline || '';
    const date = el('input', { type: 'date', class: 'field field-compact', value: v.slice(0, 10), 'aria-label': '期限' });
    const time = el('input', { type: 'time', class: 'field field-compact', step: 300, value: v.length > 10 && !v.endsWith('T00:00') ? v.slice(11, 16) : '', 'aria-label': '時刻（任意）' });
    const badgeBox = el('span', {}, renderDeadlineBadge(t.deadline));
    const onDeadline = async () => {
      const next = date.value ? (time.value ? `${date.value}T${time.value}` : date.value) : '';
      if (next === (t.deadline || '')) return;
      const saved = await saveField(t, { deadline: next });
      if (saved) { t = saved; clear(badgeBox); const b = renderDeadlineBadge(t.deadline); if (b) badgeBox.appendChild(b); }
    };
    date.addEventListener('change', onDeadline);
    time.addEventListener('change', onDeadline);

    // 案件名・依頼者: 紐付け済みならリンク（同期テキストが異なれば併記）、未紐付けならテキストを直接編集
    const caseCell = linkedOrText({
      linked: t.caseId ? caseById.get(t.caseId) : null,
      linkHref: (c) => `#/cases/${c.id}`,
      linkText: (c) => c.caseName || '(無題)',
      textKey: 'caseLabel',
      placeholder: '案件名',
      suggest: (s) => suggestCase(s, cases),
      suggestLabel: (c) => c.caseName,
      linkKey: 'caseId'
    });
    const reqCell = linkedOrText({
      linked: t.clientId ? clientById.get(t.clientId) : null,
      linkHref: (c) => `#/clients/${c.id}`,
      linkText: (c) => displayName(c) || '(名称未設定)',
      textKey: 'requester',
      placeholder: '依頼者',
      suggest: (s) => suggestClient(s, clients),
      suggestLabel: (c) => displayName(c),
      linkKey: 'clientId'
    });

    function linkedOrText(o) {
      const cell = el('div', { class: 'todo-cell-stack' });
      if (o.linked) {
        cell.appendChild(el('a', { href: o.linkHref(o.linked) }, o.linkText(o.linked)));
        const text = (t[o.textKey] || '').trim();
        if (text && text !== o.linkText(o.linked)) cell.appendChild(el('span', { class: 'text-muted todo-sub' }, text));
        return cell;
      }
      const input = el('input', { type: 'text', class: 'field field-compact', value: t[o.textKey] || '', placeholder: o.placeholder });
      const hintBox = el('div');
      const showHint = () => {
        clear(hintBox);
        const hit = o.suggest(input.value);
        if (hit) {
          hintBox.appendChild(el('button', { type: 'button', class: 'btn btn-small', title: 'LexManagerの登録データと紐付けます（テキストはそのまま残ります）', onClick: async () => {
            if (await saveField(t, { [o.linkKey]: hit.id })) renderList();
          } }, `🔗 ${o.suggestLabel(hit)}`));
        }
      };
      input.addEventListener('change', async () => {
        const next = input.value.trim();
        if (next === (t[o.textKey] || '')) return;
        const saved = await saveField(t, { [o.textKey]: next });
        if (saved) t = saved;
        showHint();
      });
      showHint();
      cell.appendChild(input);
      cell.appendChild(hintBox);
      return cell;
    }

    // 内容（＋元メール情報）
    const title = el('input', { type: 'text', class: 'field field-compact', value: t.title || '', placeholder: '内容', 'aria-label': '内容' });
    title.addEventListener('change', async () => {
      const next = title.value.trim();
      if (!next) { ctx.toast('内容は空にできません', 'error'); title.value = t.title || ''; return; }
      if (next === t.title) return;
      const saved = await saveField(t, { title: next });
      if (saved) t = saved;
    });

    const detailBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
      if (await editTodoDialog(ctx, t, cases, clients)) await reload();
    } }, '詳細');

    tr.appendChild(el('td', { class: 'todo-col-done' }, cb));
    tr.appendChild(el('td', { class: 'todo-col-deadline' }, el('div', { class: 'todo-cell-stack' }, [el('div', { class: 'todo-deadline-inputs' }, [date, time]), badgeBox])));
    tr.appendChild(el('td', { class: 'todo-col-case' }, caseCell));
    tr.appendChild(el('td', { class: 'todo-col-requester' }, reqCell));
    tr.appendChild(el('td', { class: 'todo-col-title' }, el('div', { class: 'todo-cell-stack' }, [title, todoMailLine(t), t.notes ? el('span', { class: 'text-muted todo-sub', title: t.notes }, '📝 メモあり') : null])));
    tr.appendChild(el('td', { class: 'todo-col-actions' }, detailBtn));
    return tr;
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
