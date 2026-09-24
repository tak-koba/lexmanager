// LexManager 4 - ホーム画面（DESIGN.md §6）
import { el, clear } from '../ui/dom.js';
import {
  renderDeadlineBadge, displayName, sortByKana, kanaName,
  quickCreateClientDialog, quickCreateCaseDialog, quickCreateTodoDialog
} from './_shared.js';

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, 'ホーム'));

  const quickRow = el('div', { class: 'quick-actions' }, [
    el('button', { type: 'button', class: 'btn', onClick: async () => {
      const c = await quickCreateClientDialog(ctx);
      if (c) ctx.navigate(`#/clients/${c.id}`);
    } }, '＋顧客'),
    el('button', { type: 'button', class: 'btn', onClick: async () => {
      const all = await ctx.store.all();
      const c = await quickCreateCaseDialog(ctx, all.clients);
      if (c) ctx.navigate(`#/cases/${c.id}`);
    } }, '＋案件'),
    el('button', { type: 'button', class: 'btn', onClick: async () => {
      const all = await ctx.store.all();
      await quickCreateTodoDialog(ctx, all.cases);
      render(container, params, ctx);
    } }, '＋ToDo')
  ]);
  container.appendChild(quickRow);

  const body = el('div', { class: 'home-grid' });
  container.appendChild(body);
  body.appendChild(el('p', { class: 'text-muted' }, '読み込み中...'));

  let all;
  try {
    all = await ctx.store.all();
  } catch (e) {
    clear(body);
    body.appendChild(el('p', { class: 'text-error' }, 'データの取得に失敗しました: ' + e.message));
    return;
  }

  clear(body);
  body.appendChild(buildDeadlineSection(all.cases, ctx));
  body.appendChild(buildTodoSection(all.todos, ctx));
  body.appendChild(buildRecentSection(all, ctx));
  body.appendChild(await buildAttentionSection(ctx));
}

function buildDeadlineSection(cases, ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('div', { class: 'section-header' }, [el('h3', {}, '期日')]));

  const withDate = (cases || [])
    .filter((c) => c.nextDate && !c.isArchived)
    .filter((c) => {
      const kind = ['overdue', 'today', 'soon', 'later'].includes(deadlineKindWithin7(c.nextDate));
      return kind;
    });
  const sorted = withDate.sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));

  if (!sorted.length) {
    section.appendChild(el('p', { class: 'text-muted' }, '直近7日以内の期日はありません'));
    return section;
  }

  const list = el('ul', { class: 'list' });
  for (const c of sorted) {
    const row = el('li', { class: 'list-row', onClick: () => ctx.navigate(`#/cases/${c.id}`) }, [
      renderDeadlineBadge(c.nextDate),
      el('span', {}, c.caseName || '(無題の案件)')
    ]);
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

function deadlineKindWithin7(dateStr) {
  const datePart = dateStr.slice(0, 10);
  const d = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'soon';
  return '';
}

function buildTodoSection(todos, ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('div', { class: 'section-header' }, [el('h3', {}, 'ToDo')]));

  const open = (todos || []).filter((t) => !t.done);
  let overdue = 0, today = 0, week = 0, none = 0;
  for (const t of open) {
    if (!t.deadline) { none++; continue; }
    const kind = deadlineKindWithin7(t.deadline);
    if (kind === 'overdue') overdue++;
    else if (kind === 'today') today++;
    else if (kind === 'soon') week++;
  }
  section.appendChild(el('div', { class: 'stat-row' }, [
    el('span', { class: 'chip' }, `超過 ${overdue}`),
    el('span', { class: 'chip' }, `今日 ${today}`),
    el('span', { class: 'chip' }, `今週 ${week}`),
    el('span', { class: 'chip' }, `期限なし ${none}`)
  ]));

  const top = open
    .slice()
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 8);

  const list = el('ul', { class: 'list' });
  for (const t of top) {
    const cb = el('input', {
      type: 'checkbox',
      onClick: async (ev) => {
        ev.stopPropagation();
        try {
          await ctx.store.update('todos', { ...t, done: true, doneAt: new Date().toISOString() }, t);
          ctx.toast('完了にしました', 'success');
          row.remove();
        } catch (e) {
          ctx.toast('更新に失敗しました: ' + e.message, 'error');
        }
      }
    });
    const row = el('li', { class: 'list-row' }, [
      cb,
      renderDeadlineBadge(t.deadline),
      el('span', { onClick: () => ctx.navigate('#/todos') }, t.title || '(無題)')
    ]);
    list.appendChild(row);
  }
  section.appendChild(list);
  if (!top.length) section.appendChild(el('p', { class: 'text-muted' }, '未完了のToDoはありません'));
  return section;
}

function buildRecentSection(all, ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('div', { class: 'section-header' }, [el('h3', {}, '最近更新')]));

  const records = [
    ...(all.clients || []).map((c) => ({ type: '顧客', name: displayName(c), updatedAt: c.updatedAt, href: `#/clients/${c.id}` })),
    ...(all.cases || []).map((c) => ({ type: '案件', name: c.caseName || '(無題)', updatedAt: c.updatedAt, href: `#/cases/${c.id}` }))
  ]
    .filter((r) => r.updatedAt)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 8);

  const list = el('ul', { class: 'list' });
  for (const r of records) {
    list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate(r.href) }, [
      el('span', { class: 'chip' }, r.type),
      el('span', {}, r.name),
      el('span', { class: 'text-muted' }, r.updatedAt ? r.updatedAt.slice(0, 16).replace('T', ' ') : '')
    ]));
  }
  section.appendChild(list);
  if (!records.length) section.appendChild(el('p', { class: 'text-muted' }, '更新履歴はまだありません'));
  return section;
}

async function buildAttentionSection(ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('div', { class: 'section-header' }, [el('h3', {}, '要対応')]));
  const list = el('ul', { class: 'list' });
  let any = false;

  if (ctx.caps.conflicts) {
    try {
      const res = await ctx.store.getConflicts();
      const n = (res && res.items && res.items.length) || 0;
      if (n > 0) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/settings') }, `競合しているレコードが ${n} 件あります`));
      }
    } catch (e) { /* ignore */ }
  }

  if (ctx.caps.mobileImport) {
    try {
      const status = await ctx.store.getMobileStatus();
      const n = (status && status.inboxCount) || 0;
      if (n > 0) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/settings') }, `iPhoneからの取込待ちが ${n} 件あります`));
      }
    } catch (e) { /* ignore */ }
  }

  if (ctx.caps.migrate) {
    try {
      const status = await ctx.store.migrationStatus();
      if (status && !status.migrated) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/settings') }, '旧データの移行が完了していません'));
      }
    } catch (e) { /* ignore */ }
  }

  if (!any) {
    section.appendChild(el('p', { class: 'text-muted' }, '対応が必要な項目はありません'));
  } else {
    section.appendChild(list);
  }
  return section;
}
