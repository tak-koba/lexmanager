// LexManager 4 - ホーム画面（DESIGN.md §6）
import { el, clear } from '../ui/dom.js';
import {
  renderDeadlineBadge, displayName, sortByKana, kanaName,
  quickCreateClientDialog, quickCreateCaseDialog, quickCreateTodoDialog, openCalendar
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
    } }, '＋ToDo'),
    el('button', { type: 'button', class: 'btn', title: 'Googleカレンダーを開く', onClick: openCalendar }, '📅 カレンダー')
  ]);
  const syncPanel = el('div', { class: 'sync-panel', hidden: true });
  const syncBtn = el('button', { type: 'button', class: 'btn btn-primary sync-btn', 'aria-expanded': 'false', onClick: async () => {
    const open = syncPanel.hidden;
    syncPanel.hidden = !open;
    syncBtn.setAttribute('aria-expanded', String(open));
    if (open) await fillSyncPanel(syncPanel, ctx, () => render(container, params, ctx));
  } }, '⇅ 同期');
  quickRow.appendChild(syncBtn);
  container.appendChild(quickRow);
  container.appendChild(syncPanel);

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
  // 要対応は、対応が必要なものがあるときだけ一番上に出す
  const attention = await buildAttentionSection(ctx);
  if (attention) body.appendChild(attention);
  body.appendChild(buildDeadlineSection(all.cases, ctx));
  body.appendChild(buildTodoSection(all.todos, ctx));
  body.appendChild(buildRecentSection(all, ctx));
}

// ---------------- 同期（Import / Export） ----------------
// PC: Import = iPhoneで書き出した変更（mobile/inbox）を取り込む、Export = iPhone用の snapshot.json を作り直す
// iPhone: Import = PCのデータ（snapshot.json）を読み込む、Export = iPhoneでの変更を書き出す
async function fillSyncPanel(panel, ctx, rerender) {
  clear(panel);
  const store = ctx.store;
  const local = !!ctx.caps.local;
  const fmt = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '未実施');

  let status = {};
  try {
    if (local) {
      status.pending = store.pendingChangesCount ? await store.pendingChangesCount() : 0;
      const meta = store.getSyncInfo ? store.getSyncInfo() : {};
      status = { ...status, ...meta };
    } else if (store.getMobileStatus) {
      status = await store.getMobileStatus();
    }
  } catch (e) { /* 状態が取れなくても操作はできる */ }

  const card = (title, desc, info, onClick) => el('button', { type: 'button', class: 'sync-card', onClick }, [
    el('span', { class: 'sync-card-title' }, title),
    el('span', { class: 'sync-card-desc' }, desc),
    info ? el('span', { class: 'sync-card-info text-muted' }, info) : null
  ]);

  if (local) {
    panel.appendChild(card('Import', 'PCのデータ（snapshot.json）を読み込み、この端末のデータを置き換えます',
      `前回の読込: ${fmt(status.snapshotAt)}`, () => iphoneImport(ctx, rerender)));
    panel.appendChild(card('Export', 'この端末で変更した内容を書き出します（PCで取り込みます）',
      `未書出しの変更: ${status.pending || 0}件 ／ 前回の書出し: ${fmt(status.lastExportAt)}`, () => iphoneExport(ctx, status.pending || 0, rerender)));
  } else {
    panel.appendChild(card('Import', 'iPhoneで書き出した変更（mobile/inbox）を取り込みます',
      `取込待ち: ${status.inboxCount || 0}件`, () => pcImport(ctx, status.inboxCount || 0, rerender)));
    panel.appendChild(card('Export', 'iPhone用のデータ（snapshot.json）を最新の内容で作り直します',
      `前回の作成: ${fmt(status.snapshotAt)}`, () => pcExport(ctx, rerender)));
    let g = null;
    try { g = ctx.store.gcalStatus ? await ctx.store.gcalStatus() : null; } catch (e) { g = null; }
    if (g && g.connected && g.calendarId) {
      panel.appendChild(card('Googleカレンダー', `「${g.calendarName || 'カレンダー'}」とToDoを今すぐ同期します`,
        `前回: ${fmt(g.lastRun)}${g.enabled ? '（このPCで10分ごとに自動同期）' : '（このPCは自動同期しない設定）'}`, () => gcalSyncNow(ctx, rerender)));
    }
  }
}

function gcalSummary(r) {
  const parts = [];
  if (r.imported) parts.push(`取込${r.imported}件`);
  if (r.created) parts.push(`予定登録${r.created}件`);
  if (r.updatedTodos + r.updatedEvents) parts.push(`更新${r.updatedTodos + r.updatedEvents}件`);
  if (r.deletedEvents) parts.push(`予定削除${r.deletedEvents}件`);
  if (r.trashedTodos) parts.push(`ToDoをごみ箱へ${r.trashedTodos}件`);
  return parts.length ? parts.join('・') : '変更はありませんでした';
}

const HELD_LABEL = {
  trashTodos: (n) => `Googleで削除された予定 ${n}件に対応するToDoを、ごみ箱へ移します`,
  imports: (n) => `Googleの予定 ${n}件を、ToDoとして取り込みます`,
  deleteEvents: (n) => `LexManagerで削除・登録解除したToDoの予定 ${n}件を、Googleから削除します`
};

async function gcalSyncNow(ctx, rerender, force = false) {
  if (!force && !(await ctx.confirm('Googleカレンダーと今すぐ同期します。よろしいですか？'))) return;
  try {
    const { result } = await ctx.store.gcalSync(force);
    if (result.held && result.held.length) {
      const msg = result.held.map((h) => '・' + HELD_LABEL[h.kind](h.count)).join('\n');
      if (await ctx.confirm(`件数が多いため、次の処理を止めています。実行してよいですか？\n${msg}`)) return gcalSyncNow(ctx, rerender, true);
    }
    ctx.toast(`Googleカレンダー: ${gcalSummary(result)}${result.conflicts.length ? `（両方で変更された項目 ${result.conflicts.length}件はLexManagerの内容を残しました）` : ''}`,
      result.errors.length ? 'error' : 'success');
    rerender();
  } catch (e) {
    ctx.toast('Googleカレンダーの同期に失敗しました: ' + e.message, 'error');
  }
}

async function pcImport(ctx, count, rerender) {
  if (!count) {
    if (!(await ctx.confirm('取込待ちのファイルはありません（OneDriveの同期が終わっていない可能性があります）。それでも取込を実行しますか？'))) return;
  } else if (!(await ctx.confirm(`iPhoneからの変更 ${count}件を取り込みます。よろしいですか？`))) return;
  try {
    const res = await ctx.store.importMobile();
    ctx.toast(`取込完了: 適用${res.applied || 0}件 / 統合${res.merged || 0}件 / 競合${res.conflicts || 0}件`, res.conflicts ? 'info' : 'success');
    rerender();
  } catch (e) {
    ctx.toast('取込に失敗しました: ' + e.message, 'error');
  }
}

async function pcExport(ctx, rerender) {
  if (!(await ctx.confirm('iPhone用のデータ（LexManagerData/mobile/snapshot.json）を最新の内容で作り直します。よろしいですか？'))) return;
  try {
    await ctx.store.regenerateSnapshot();
    ctx.toast('iPhone用のデータを作り直しました。OneDriveの同期後、iPhoneで Import してください', 'success');
    rerender();
  } catch (e) {
    ctx.toast('作成に失敗しました: ' + e.message, 'error');
  }
}

/** iPhoneの Import: 確認画面の中でファイルを選ぶ（iPhoneでは、ボタンを押した流れの中でないとファイル選択を開けないため）。 */
async function iphoneImport(ctx, rerender) {
  const store = ctx.store;
  let unexported = false;
  try { unexported = store.hasUnexportedChanges ? await store.hasUnexportedChanges() : false; } catch (e) { /* ignore */ }
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json' });
  const body = el('div', { class: 'field-stack' }, [
    el('p', {}, 'OneDriveの LexManagerData → mobile → snapshot.json を選ぶと、この端末のデータがPCの内容に置き換わります。'),
    unexported ? el('p', { class: 'text-error' }, '⚠ まだ書き出していない変更があります。読み込むとその変更は消えます。先に Export することをお勧めします。') : null,
    el('label', { class: 'btn btn-primary file-btn' }, [fileInput, 'snapshot.json を選んで読み込む'])
  ]);
  const dlg = ctx.openDialog({ title: 'Import（PCのデータを読み込む）', bodyNode: body, actions: [{ label: 'キャンセル', onClick: () => {} }] });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const r = await store.importSnapshot(file);
      if (dlg && dlg.close) dlg.close();
      ctx.toast(`読み込みました（顧客${r.counts.clients}件・案件${r.counts.cases}件・ToDo${r.counts.todos}件）`, 'success');
      await ctx.refresh();
      rerender();
    } catch (e) {
      ctx.toast('読込に失敗しました: ' + e.message, 'error');
    }
  });
}

async function iphoneExport(ctx, pending, rerender) {
  if (!pending && !(await ctx.confirm('書き出していない変更はありません。それでも書き出しますか？'))) return;
  if (pending && !(await ctx.confirm(`この端末での変更 ${pending}件を書き出します。保存先は OneDrive の LexManagerData → mobile → inbox を選んでください。よろしいですか？`))) return;
  try {
    const r = await ctx.store.exportChanges();
    ctx.toast(`${r.count}件の変更を書き出しました。OneDriveの LexManagerData/mobile/inbox に保存してください`, 'success');
    rerender();
  } catch (e) {
    ctx.toast('書出しに失敗しました: ' + e.message, 'error');
  }
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

// 最近更新: この端末・他の端末を問わず、最近登録・変更した顧客と案件（直近5件）。続きの作業にすぐ戻るため。
function buildRecentSection(all, ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('div', { class: 'section-header' }, [el('h3', {}, '最近更新した顧客・案件')]));

  const records = [
    ...(all.clients || []).map((c) => ({ type: '顧客', name: displayName(c), updatedAt: c.updatedAt, href: `#/clients/${c.id}` })),
    ...(all.cases || []).map((c) => ({ type: '案件', name: c.caseName || '(無題)', updatedAt: c.updatedAt, href: `#/cases/${c.id}` }))
  ]
    .filter((r) => r.updatedAt)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 5);

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

// 要対応: 放置すると困るもの（PC: 他端末との競合・iPhoneからの取込待ち・旧データ移行、iPhone: 未書出しの変更）。
// 該当がなければ何も表示しない（null を返す）。
async function buildAttentionSection(ctx) {
  const section = el('section', { class: 'section section-attention' });
  section.appendChild(el('div', { class: 'section-header' }, [el('h3', {}, '⚠ 要対応')]));
  const list = el('ul', { class: 'list' });
  let any = false;

  if (ctx.caps.local && ctx.store.pendingChangesCount) {
    try {
      const n = await ctx.store.pendingChangesCount();
      if (n > 0) {
        any = true;
        list.appendChild(el('li', { class: 'list-row' }, `この端末に、PCへ書き出していない変更が ${n} 件あります（同期 → Export）`));
      }
    } catch (e) { /* ignore */ }
  }

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
        list.appendChild(el('li', { class: 'list-row' }, `iPhoneからの取込待ちが ${n} 件あります（同期 → Import）`));
      }
    } catch (e) { /* ignore */ }
  }

  if (ctx.store.gcalStatus) {
    try {
      const g = await ctx.store.gcalStatus();
      const r = g.result || {};
      if (g.connected && g.reauth) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/settings') }, 'Googleカレンダーへの再ログインが必要です（設定 → Googleカレンダー連携 → ログインし直す）'));
      } else if (g.connected && g.error) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/settings') }, `Googleカレンダーの同期でエラーがありました: ${g.error}`));
      }
      if (r.held && r.held.length) {
        any = true;
        list.appendChild(el('li', { class: 'list-row' }, `Googleカレンダー: 件数が多いため止めている処理があります（同期 → Googleカレンダー で確認）`));
      }
      if (r.conflicts && r.conflicts.length) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/todos') },
          `Googleカレンダー: 両方で変更されたToDo ${r.conflicts.length}件はLexManagerの内容を残しました（${r.conflicts.map((c) => c.title).slice(0, 3).join('、')}）`));
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

  if (!any) return null;
  section.appendChild(list);
  return section;
}
