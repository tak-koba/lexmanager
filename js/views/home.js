// LexManager 4 - ホーム画面（DESIGN.md §6）
import { el, clear } from '../ui/dom.js';
import {
  renderDeadlineBadge, displayName, sortByKana, kanaName,
  quickCreateClientDialog, quickCreateCaseDialog, quickCreateTodoDialog, openCalendar, todoTaskText, calendarBadge
} from './_shared.js';
import { formatDateTime } from '../ui/dates.js';

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
  // ［同期］: PC と、OneDrive自動同期につないだiPhoneは押したらすぐ同期（確認なし）。
  // OneDriveにつないでいないiPhoneだけ、従来どおり「PCのデータを読み込む」「変更を書き出す」を選ぶパネルを開く。
  const syncBtn = el('button', { type: 'button', class: 'btn btn-primary sync-btn', 'aria-expanded': 'false', onClick: async () => {
    const rerender = () => render(container, params, ctx);
    if (!ctx.caps.local) return syncNowPc(ctx, syncBtn, rerender);
    if (ctx.autosync && ctx.autosync.connected()) return syncNowIphone(ctx, syncBtn, rerender);
    const open = syncPanel.hidden;
    syncPanel.hidden = !open;
    syncBtn.setAttribute('aria-expanded', String(open));
    if (open) await fillSyncPanel(syncPanel, ctx, rerender);
  } }, '⇅ 同期');
  quickRow.appendChild(syncBtn);
  container.appendChild(quickRow);
  container.appendChild(syncPanel);

  const body = el('div', { class: 'home-grid' });
  container.appendChild(body);
  body.appendChild(el('p', { class: 'text-muted' }, '読み込み中…'));

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

// ---------------- 同期（押したらすぐ） ----------------

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⇅ 同期中…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

/** iPhone（OneDrive自動同期につないでいる）: その場で送受信 */
async function syncNowIphone(ctx, btn, rerender) {
  await busy(btn, () => ctx.autosync.run());
  const s = ctx.store.getOd();
  if (s.needLogin) {
    if (await ctx.confirm('OneDriveのログインの期限が切れています。再ログインしますか？', { okLabel: '再ログインする' })) {
      const { startLogin } = await import('../util/onedrive.js');
      await startLogin(s.clientId);
    }
    return;
  }
  if (s.lastError) { ctx.toast(`同期に失敗しました: ${s.lastError}`, 'error'); return; }
  ctx.toast(s.waiting ? `送信しました（PCの取り込み待ち ${s.waiting}件。PCが起動中なら1分以内に反映）` : '同期しました', 'success');
  rerender();
}

/** PC: iPhoneからの変更の取り込み＋iPhone用データの作り直し＋Googleカレンダー同期（つないでいれば）をまとめて */
async function syncNowPc(ctx, btn, rerender, force = false) {
  const parts = [];
  let failed = false;
  await busy(btn, async () => {
    try {
      const st = ctx.store.getMobileStatus ? await ctx.store.getMobileStatus() : {};
      if (st && st.inboxCount) {
        const r = await ctx.store.importMobile();
        parts.push(`iPhoneから取り込み${r.applied || 0}件${r.conflicts ? `（競合${r.conflicts}件）` : ''}`);
      }
      if (ctx.store.regenerateSnapshot) await ctx.store.regenerateSnapshot();
    } catch (e) {
      failed = true;
      parts.push(`iPhoneとのやり取りに失敗: ${e.message}`);
    }
    try {
      const g = ctx.store.gcalStatus ? await ctx.store.gcalStatus() : null;
      if (g && g.connected && g.calendarId) {
        const { result } = await ctx.store.gcalSync(force);
        if (result.held && result.held.length && !force) {
          const msg = result.held.map((h) => '・' + HELD_LABEL[h.kind](h.count)).join('\n');
          if (await ctx.confirm(`Googleカレンダー: 件数が多いため、次の処理を止めています。実行してよいですか？\n${msg}`, { okLabel: '実行する' })) {
            const again = await ctx.store.gcalSync(true);
            parts.push(`Googleカレンダー: ${gcalSummary(again.result)}`);
          } else {
            parts.push('Googleカレンダー: 一部を保留');
          }
        } else {
          parts.push(`Googleカレンダー: ${gcalSummary(result)}`);
        }
      }
    } catch (e) {
      failed = true;
      parts.push(`Googleカレンダーの同期に失敗: ${e.message}`);
    }
  });
  ctx.toast(`${failed ? '同期の一部に失敗しました' : '同期しました'}${parts.length ? `（${parts.join('／')}）` : ''}`, failed ? 'error' : 'success');
  rerender();
}

// ---------------- 同期（OneDriveにつないでいないiPhone: 手動の読み込み・書き出し） ----------------
// 読み込み = PCのデータ（snapshot.json）を読み込む、書き出し = iPhoneでの変更を書き出す（PCは1分ごとに自動で取り込む）
// 表示の文言は設定の「PCとのやり取り（手動）」とそろえる
async function fillSyncPanel(panel, ctx, rerender) {
  clear(panel);
  const store = ctx.store;
  const fmt = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '未実施');
  let status = {};
  try {
    status.pending = store.pendingChangesCount ? await store.pendingChangesCount() : 0;
    status = { ...status, ...(store.getSyncInfo ? store.getSyncInfo() : {}) };
  } catch (e) { /* 状態が取れなくても操作はできる */ }
  const card = (title, desc, info, onClick) => el('button', { type: 'button', class: 'sync-card', onClick }, [
    el('span', { class: 'sync-card-title' }, title),
    el('span', { class: 'sync-card-desc' }, desc),
    info ? el('span', { class: 'sync-card-info text-muted' }, info) : null
  ]);
  panel.appendChild(card('PCのデータを読み込む', 'PCが作ったデータを読み込み、この端末のデータを置き換えます',
    `前回の読み込み: ${fmt(status.snapshotAt)}`, () => iphoneImport(ctx, rerender)));
  panel.appendChild(card('変更を書き出す', 'この端末で変更した内容をファイルに書き出します（PCで取り込みます）',
    `まだ書き出していない変更: ${status.pending || 0}件 ／ 前回の書き出し: ${fmt(status.lastExportAt)}`, () => iphoneExport(ctx, status.pending || 0, rerender)));
  panel.appendChild(el('p', { class: 'text-muted' }, '設定の「OneDrive自動同期」でOneDriveにつなぐと、この操作は不要になります。'));
}

function gcalSummary(r) {
  const parts = [];
  if (r.imported) parts.push(`取り込み${r.imported}件`);
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

/** iPhoneの「PCのデータを読み込む」: 確認画面の中でファイルを選ぶ（iPhoneでは、ボタンを押した流れの中でないとファイル選択を開けないため）。 */
async function iphoneImport(ctx, rerender) {
  const store = ctx.store;
  let unexported = false;
  try { unexported = store.hasUnexportedChanges ? await store.hasUnexportedChanges() : false; } catch (e) { /* ignore */ }
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json' });
  const body = el('div', { class: 'field-stack' }, [
    el('p', {}, 'OneDriveの「LexManagerData」フォルダの「mobile」にあるファイル（snapshot.json）を選ぶと、この端末のデータがPCの内容に置き換わります。'),
    unexported ? el('p', { class: 'text-error' }, '⚠ まだ書き出していない変更があります。読み込むとその変更は消えます。先に［変更を書き出す］を行うことをお勧めします。') : null,
    el('label', { class: 'btn btn-primary file-btn' }, [fileInput, 'ファイルを選んで読み込む'])
  ]);
  const dlg = ctx.openDialog({ title: 'PCのデータを読み込む', bodyNode: body, actions: [{ label: 'キャンセル', onClick: () => {} }] });
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
      ctx.toast('読み込みに失敗しました: ' + e.message, 'error');
    }
  });
}

async function iphoneExport(ctx, pending, rerender) {
  if (!pending && !(await ctx.confirm('書き出していない変更はありません。それでも書き出しますか？', { okLabel: '書き出す' }))) return;
  if (pending && !(await ctx.confirm(`この端末での変更 ${pending}件を書き出します。保存先は、OneDriveの「LexManagerData」フォルダの「mobile」→「inbox」を選んでください。よろしいですか？`, { okLabel: '書き出す' }))) return;
  try {
    const r = await ctx.store.exportChanges();
    ctx.toast(`${r.count}件の変更を書き出しました。OneDriveの「LexManagerData」フォルダの「mobile」→「inbox」に保存してください`, 'success');
    rerender();
  } catch (e) {
    ctx.toast('書き出しに失敗しました: ' + e.message, 'error');
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
      el('div', { class: 'row-main' }, [renderDeadlineBadge(c.nextDate), el('span', {}, c.caseName || '(無題の案件)')])
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
  // 件数の集計（押せないので、押せるチップと区別して枠なしのラベルで表示）
  const stat = (label, n) => el('span', { class: 'stat-label' }, [label, el('strong', {}, String(n))]);
  section.appendChild(el('div', { class: 'stat-row', role: 'group', 'aria-label': '未完了のToDoの件数' }, [
    stat('超過', overdue),
    stat('本日', today),
    stat('7日以内', week),
    stat('期限なし', none)
  ]));

  const top = open
    .slice()
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 8);

  const list = el('ul', { class: 'list' });
  for (const t of top) {
    const cb = el('input', {
      type: 'checkbox',
      'aria-label': `「${todoTaskText(t)}」を完了にする`,
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
    const row = el('li', { class: 'list-row', onClick: () => ctx.navigate('#/todos') }, [
      cb,
      el('div', { class: 'row-main' }, [renderDeadlineBadge(t.deadline), el('span', {}, todoTaskText(t)), calendarBadge(t)])
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
      el('div', { class: 'row-main row-main-stack' }, [
        el('span', {}, r.name),
        el('span', { class: 'text-muted' }, formatDateTime(r.updatedAt.slice(0, 16)))
      ])
    ]));
  }
  section.appendChild(list);
  if (!records.length) section.appendChild(el('p', { class: 'text-muted' }, '更新履歴はまだありません'));
  return section;
}

// 要対応: 放置すると困るもの（PC: 他端末との競合・iPhoneからの取り込み待ち・旧データ移行、iPhone: まだ書き出していない変更）。
// 該当がなければ何も表示しない（null を返す）。
async function buildAttentionSection(ctx) {
  const section = el('section', { class: 'section section-attention' });
  section.appendChild(el('div', { class: 'section-header' }, [el('h3', {}, '⚠ 要対応')]));
  const list = el('ul', { class: 'list' });
  let any = false;

  // iPhone版のOneDrive自動同期: ログインが切れていたら、ここからボタン1つで再ログイン
  const od = ctx.store.getOd ? ctx.store.getOd() : {};
  const autoOn = !!(od.clientId && od.refreshToken);
  if (autoOn && od.needLogin) {
    any = true;
    list.appendChild(el('li', { class: 'list-row' }, [
      el('span', {}, 'OneDrive自動同期: ログインの期限が切れました'),
      el('button', { type: 'button', class: 'btn btn-primary btn-small', onClick: async () => {
        const { startLogin } = await import('../util/onedrive.js');
        await startLogin(od.clientId);
      } }, '再ログイン')
    ]));
  }

  if (ctx.caps.local && ctx.store.pendingChangesCount && !(autoOn && !od.needLogin)) {
    try {
      const n = await ctx.store.pendingChangesCount();
      if (n > 0) {
        any = true;
        list.appendChild(el('li', { class: 'list-row' }, `この端末に、PCへ書き出していない変更が ${n} 件あります（ホームの［同期］→［変更を書き出す］）`));
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
        list.appendChild(el('li', { class: 'list-row' }, `iPhoneからの取り込み待ちが ${n} 件あります（ホームの［同期］を押してください）`));
      }
    } catch (e) { /* ignore */ }
  }

  if (ctx.store.gcalStatus) {
    try {
      const g = await ctx.store.gcalStatus();
      const r = g.result || {};
      if (g.connected && g.reauth) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/settings') }, 'Googleカレンダーへの再ログインが必要です（設定の「Googleカレンダー連携」で［ログインし直す］）'));
      } else if (g.connected && g.error) {
        any = true;
        list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate('#/settings') }, `Googleカレンダーの同期でエラーがありました: ${g.error}`));
      }
      if (r.held && r.held.length) {
        any = true;
        list.appendChild(el('li', { class: 'list-row' }, `Googleカレンダー: 件数が多いため止めている処理があります（ホームの［同期］を押すと、内容を確認して実行できます）`));
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
