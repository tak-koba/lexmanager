// LexManager 4 - 設定（サーバーモード／ローカルモードで内容が分岐）
import { el, clear } from '../ui/dom.js';
import { asciiPasswordInput, PASSWORD_RULE } from '../lock.js';
import { confirmDialog } from '../ui/dialog.js';
import { fieldLabel, formatFieldValue } from './_shared.js';

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, '設定'));

  if (ctx.caps.ai || ctx.caps.trash || ctx.caps.update || ctx.caps.migrate || ctx.caps.mobileImport || ctx.caps.conflicts) {
    await renderServerMode(container, ctx);
    addToc(container);
  } else {
    await renderLocalMode(container, ctx);
  }
}

const AUTO_LOCK_OPTIONS = [[0, 'しない'], [5, '5分'], [10, '10分'], [15, '15分'], [30, '30分'], [60, '60分']];

function autoLockSelect(value, onChange) {
  const sel = el('select', { class: 'field', style: 'width:auto' },
    AUTO_LOCK_OPTIONS.map(([v, t]) => el('option', { value: String(v), selected: v === value }, t)));
  sel.addEventListener('change', () => onChange(Number(sel.value)));
  return sel;
}

/**
 * iPhone版: パスワード・ロック（DESIGN.md §15）。パスワードを設定すると端末内のデータを暗号化する。
 * 変更・復旧コードの発行・暗号化の解除には今のパスワードが必要。復旧コードは控えたのを確かめてから有効にする。
 */
async function buildLocalPasswordSection(ctx) {
  const store = ctx.store;
  const { showRecoveryCodeDialog } = await import('../lock.js');
  const { normalizeRecoveryCode, PASSWORD_MIN } = await import('../store-local.js');
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, 'パスワード・ロック'));
  const hint = el('p', { class: 'text-error', 'aria-live': 'polite' });
  const pw = (ph, auto = 'new-password') => asciiPasswordInput(el('input', { type: 'password', class: 'field', placeholder: ph, autocomplete: auto }), hint);
  const enabled = await store.hasPassphrase();
  const reload = () => { ctx.lockConfigChanged(); ctx.navigate('#/settings'); };

  // 復旧コードを控えてもらってから保存する（やめたら何も変わらない）
  const commitWithCode = async (prepared, doneMsg) => {
    if (prepared.code) {
      if (!(await showRecoveryCodeDialog(prepared.code, { normalize: normalizeRecoveryCode }))) {
        ctx.toast('何も変更していません', 'info');
        return;
      }
    }
    try {
      await prepared.commit();
      ctx.toast(doneMsg, 'success');
      reload();
    } catch (e) {
      ctx.toast('保存に失敗しました（何も変更していません）: ' + e.message, 'error');
    }
  };
  const busy = async (btn, fn) => {
    btn.disabled = true;
    hint.textContent = '処理しています…（数秒かかります）';
    try { await fn(); hint.textContent = ''; } catch (e) { hint.textContent = e.message; } finally { btn.disabled = false; }
  };

  if (!enabled) {
    section.appendChild(el('p', {}, '未設定'));
    const p1 = pw(`新しいパスワード（${PASSWORD_MIN}文字以上）`);
    const p2 = pw('もう一度入力');
    section.appendChild(p1);
    section.appendChild(p2);
    const btn = el('button', { type: 'button', class: 'btn btn-primary', onClick: () => busy(btn, async () => {
      if (p1.value !== p2.value) throw new Error('2回の入力が一致しません');
      await commitWithCode(await store.setupPassword(p1.value), 'パスワードを設定しました（この端末のデータを暗号化しました）');
    }) }, 'パスワードを設定');
    section.appendChild(btn);
    section.appendChild(hint);
    section.appendChild(el('p', { class: 'text-muted' }, `${PASSWORD_MIN}文字以上で、${PASSWORD_RULE}。設定すると、この端末内のデータが暗号化され、パスワードを忘れたときに使う「復旧コード」が発行されます。一定時間操作がないときの自動ロックも使えるようになります。`));
    return section;
  }

  const rcText = store.hasRecovery()
    ? `復旧コード: 発行済み（${new Date(store.recoveryIssuedAt()).toLocaleDateString('ja-JP')}）`
    : '復旧コード: 未発行（パスワードを忘れると、この端末のデータを初期化するしかありません。発行をおすすめします）';
  section.appendChild(el('p', {}, ['🔒 設定済み（この端末のデータは暗号化されています）', el('br'), el('span', { class: store.hasRecovery() ? 'text-muted' : 'text-error' }, rcText)]));
  const cur = store.passwordIsAscii() ? pw('今のパスワード', 'current-password')
    : el('input', { type: 'password', class: 'field', placeholder: '今のパスワード', autocomplete: 'current-password' });
  const p1 = pw(`新しいパスワード（${PASSWORD_MIN}文字以上）`);
  const p2 = pw('新しいパスワードをもう一度');
  section.appendChild(cur);
  section.appendChild(el('div', { class: 'field-row' }, [p1, p2]));
  const changeBtn = el('button', { type: 'button', class: 'btn', onClick: () => busy(changeBtn, async () => {
    if (!p1.value) throw new Error('新しいパスワードを入力してください');
    if (p1.value !== p2.value) throw new Error('2回の入力が一致しません');
    await commitWithCode(await store.changePassword(cur.value, p1.value), 'パスワードを変更しました');
  }) }, 'パスワードを変更');
  const rcBtn = el('button', { type: 'button', class: 'btn', onClick: () => busy(rcBtn, async () => {
    if (!cur.value) throw new Error('今のパスワードを入力してください');
    await commitWithCode(await store.issueRecoveryCode(cur.value), '復旧コードを有効にしました（以前のコードは使えなくなりました）');
  }) }, store.hasRecovery() ? '復旧コードを再発行' : '復旧コードを発行');
  const offBtn = el('button', { type: 'button', class: 'btn btn-danger', onClick: () => busy(offBtn, async () => {
    if (!cur.value) throw new Error('今のパスワードを入力してください');
    if (!(await ctx.confirm('パスワードをやめて、この端末のデータの暗号化を解除します。よろしいですか？', { okLabel: '暗号化を解除する', danger: true }))) return;
    await store.disableEncryption(cur.value);
    ctx.toast('暗号化を解除しました', 'success');
    reload();
  }) }, '暗号化をやめる');
  section.appendChild(el('div', { class: 'toolbar' }, [changeBtn, rcBtn, offBtn]));
  section.appendChild(hint);
  section.appendChild(el('p', { class: 'text-muted' }, `新しいパスワードは${PASSWORD_MIN}文字以上で、${PASSWORD_RULE}。変更・復旧コードの発行・暗号化の解除には、今のパスワードが必要です。`));
  // 自動ロック（ロック中も、アプリを開いている間は同期を続ける）
  section.appendChild(el('label', { class: 'field-row', style: 'margin-top:8px' }, ['操作がないとき自動でロック', autoLockSelect(store.getAutoLockMinutes(), async (m) => {
    await store.setAutoLockMinutes(m);
    ctx.lockConfigChanged();
    ctx.toast('自動ロックの時間を変えました', 'success');
  })]));
  section.appendChild(el('div', { class: 'toolbar' }, [el('button', { type: 'button', class: 'btn', onClick: () => ctx.lockNow() }, '今すぐロック')]));
  return section;
}

/** PC版: 画面ロック（DESIGN.md §15）。ロック中もバックグラウンドの同期・アドオン連携は動く */
async function buildServerLockSection(ctx) {
  const store = ctx.store;
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, '画面ロック'));
  let st;
  try { st = await store.lockStatus(); } catch (e) {
    section.appendChild(el('p', { class: 'text-error' }, '状態を取得できませんでした: ' + e.message));
    return section;
  }
  section.appendChild(el('p', { class: 'text-muted' },
    'パスワードを設定すると、LexManagerを開いたときと、一定時間操作がないときにロックします。ロック中も、iPhoneからの取り込み・Googleカレンダー同期・自動バックアップ・Thunderbirdアドオンとの連携は動き続けます。'));
  section.appendChild(el('p', {}, st.enabled ? '🔒 設定済み' : '未設定'));

  const hint = el('p', { class: 'text-error', 'aria-live': 'polite' });
  const pw = (ph) => asciiPasswordInput(el('input', { type: 'password', class: 'field', placeholder: ph, autocomplete: 'new-password' }), hint);
  const after = (r, msg) => { ctx.toast(msg, 'success'); ctx.lockConfigChanged(); ctx.navigate('#/settings'); return r; };
  const fail = (e) => ctx.toast(e.message, 'error');

  if (!st.enabled) {
    const p1 = pw(`新しいパスワード（${st.minLength}文字以上）`);
    const p2 = pw('もう一度入力');
    section.appendChild(p1);
    section.appendChild(p2);
    section.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
      if (p1.value !== p2.value) { ctx.toast('2回の入力が一致しません', 'error'); return; }
      try { after(await store.configureLock({ newPassword: p1.value }), 'ロックを設定しました'); } catch (e) { fail(e); }
    } }, 'ロックを設定'));
  } else {
    const cur = pw('今のパスワード');
    cur.autocomplete = 'current-password';
    const p1 = pw(`新しいパスワード（${st.minLength}文字以上）`);
    const p2 = pw('新しいパスワードをもう一度');
    section.appendChild(cur);
    section.appendChild(el('div', { class: 'field-row' }, [p1, p2]));
    section.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { type: 'button', class: 'btn', onClick: async () => {
        if (!p1.value) { ctx.toast('新しいパスワードを入力してください', 'error'); return; }
        if (p1.value !== p2.value) { ctx.toast('2回の入力が一致しません', 'error'); return; }
        try { after(await store.configureLock({ currentPassword: cur.value, newPassword: p1.value }), 'パスワードを変更しました'); } catch (e) { fail(e); }
      } }, 'パスワードを変更'),
      el('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
        if (!(await ctx.confirm('画面ロックをやめます（パスワードなしで開けるようになります）。よろしいですか？', { okLabel: 'ロックをやめる', danger: true }))) return;
        try { after(await store.configureLock({ currentPassword: cur.value, newPassword: '' }), 'ロックをやめました'); } catch (e) { fail(e); }
      } }, 'ロックをやめる'),
      el('button', { type: 'button', class: 'btn', onClick: () => ctx.lockNow() }, '今すぐロック')
    ]));
  }
  section.appendChild(hint);
  section.appendChild(el('p', { class: 'text-muted' }, `パスワードは${st.minLength}文字以上で、${PASSWORD_RULE}。`));
  section.appendChild(el('label', { class: 'field-row' }, ['操作がないとき自動でロック', autoLockSelect(st.autoLockMinutes, async (m) => {
    try { after(await store.configureLock({ autoLockMinutes: m }), '自動ロックの時間を変えました'); } catch (e) { fail(e); }
  })]));
  section.appendChild(el('p', { class: 'text-muted' }, 'パスワードを忘れたときは、このPCで、LexManagerのフォルダにある「LexManager-lock-reset.bat」をダブルクリックするとロックが外れます（データは消えません）。'));
  return section;
}

/** PC版の設定は項目が多いので、先頭に目次（押すとその欄へ移動）を付ける */
function addToc(container) {
  const sections = [...container.querySelectorAll(':scope > section.section')]
    .map((s) => ({ s, h: s.querySelector('h3') })).filter((x) => x.h);
  if (sections.length < 4) return;
  const toc = el('nav', { class: 'settings-toc', 'aria-label': '設定の目次' }, sections.map(({ s, h }) =>
    el('button', { type: 'button', class: 'btn btn-small', onClick: () => s.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, h.textContent)));
  const title = container.querySelector(':scope > .view-title');
  if (title) title.after(toc); else container.prepend(toc);
}

async function renderServerMode(container, ctx) {
  let settings = {};
  try {
    settings = await ctx.store.getSettings();
  } catch (e) {
    container.appendChild(el('p', { class: 'text-error' }, '設定の取得に失敗しました: ' + e.message));
  }

  // 端末名・データフォルダ・AIモデル
  const basicSection = el('section', { class: 'section' });
  basicSection.appendChild(el('h3', {}, '基本設定'));
  const deviceInput = el('input', { type: 'text', class: 'field', value: settings.deviceName || '' });
  const dataRootInput = el('input', { type: 'text', class: 'field', value: settings.dataRoot || '' });
  const aiModelInput = el('input', { type: 'text', class: 'field', value: settings.aiModel || '' });
  basicSection.appendChild(el('label', {}, ['端末名', deviceInput]));
  basicSection.appendChild(el('label', {}, ['データフォルダ', dataRootInput]));
  basicSection.appendChild(el('label', {}, ['AIモデル', aiModelInput]));
  basicSection.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    try {
      await ctx.store.postSettings({ deviceName: deviceInput.value, dataRoot: dataRootInput.value, aiModel: aiModelInput.value });
      ctx.toast('保存しました', 'success');
    } catch (e) {
      ctx.toast('保存に失敗しました: ' + e.message, 'error');
    }
  } }, '保存'));
  container.appendChild(basicSection);

  // APIキー
  const apiSection = el('section', { class: 'section' });
  apiSection.appendChild(el('h3', {}, 'APIキー'));
  apiSection.appendChild(el('p', { class: 'text-muted' }, settings.apiKeySet ? '設定済み' : '未設定'));
  const keyInput = el('input', { type: 'password', class: 'field', placeholder: '新しいAPIキー' });
  const rowKey = el('div', { class: 'field-row' }, [
    keyInput,
    el('button', { type: 'button', class: 'btn', onClick: async () => {
      if (!keyInput.value) return;
      try {
        await ctx.store.postSettings({ apiKey: keyInput.value });
        ctx.toast('APIキーを設定しました', 'success');
        keyInput.value = '';
      } catch (e) {
        ctx.toast('設定に失敗しました: ' + e.message, 'error');
      }
    } }, '設定'),
    el('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
      const ok = await confirmDialog('APIキーをクリアします（AI読取が使えなくなります）。よろしいですか？', { okLabel: 'クリアする', danger: true });
      if (!ok) return;
      try {
        await ctx.store.postSettings({ apiKey: '' });
        ctx.toast('APIキーをクリアしました', 'success');
      } catch (e) {
        ctx.toast('操作に失敗しました: ' + e.message, 'error');
      }
    } }, 'クリア')
  ]);
  apiSection.appendChild(rowKey);
  container.appendChild(apiSection);

  if (ctx.store.lockStatus) container.appendChild(await buildServerLockSection(ctx));

  // Googleカレンダー連携
  if (ctx.store.gcalStatus) container.appendChild(await buildGcalSection(ctx));

  // 更新確認
  if (ctx.caps.update) {
    const updateSection = el('section', { class: 'section' });
    updateSection.appendChild(el('h3', {}, 'アプリの更新'));
    updateSection.appendChild(el('p', { class: 'text-muted' }, 'LexManager本体の新しい版がGitHubにあるかを確認し、あれば取り込みます。適用後はアプリの再起動が必要です。'));
    const statusBox = el('div', {}, '');
    updateSection.appendChild(statusBox);
    updateSection.appendChild(el('div', { class: 'field-row' }, [
      el('button', { type: 'button', class: 'btn', onClick: async () => {
        try {
          const status = await ctx.store.updateStatus();
          clear(statusBox);
          statusBox.appendChild(el('p', {}, status && status.hasUpdate ? '新しいバージョンがあります' : '最新版です'));
        } catch (e) {
          ctx.toast('確認に失敗しました: ' + e.message, 'error');
        }
      } }, '更新を確認'),
      el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
        const ok = await confirmDialog('新しい版を取り込みます。適用後はアプリの再起動が必要です。よろしいですか？', { okLabel: '適用する' });
        if (!ok) return;
        try {
          await ctx.store.updateApply();
          ctx.toast('更新しました。アプリを再起動してください', 'success');
        } catch (e) {
          ctx.toast('更新に失敗しました: ' + e.message, 'error');
        }
      } }, '更新を適用')
    ]));
    container.appendChild(updateSection);
  }

  // 移行（旧LexManagerの data.json からの一度きりの取り込み。完了後は表示しない）
  let migrated = true;
  if (ctx.caps.migrate) {
    try { const st = await ctx.store.migrationStatus(); migrated = !!(st && st.migrated); } catch (e) { migrated = false; }
  }
  if (ctx.caps.migrate && !migrated) {
    const migSection = el('section', { class: 'section' });
    migSection.appendChild(el('h3', {}, '旧データの移行'));
    migSection.appendChild(el('p', { class: 'text-muted' }, '旧LexManager（data.json）のデータを、今の形式に取り込む一度きりの作業です。旧データは変更されません。'));
    const migStatusBox = el('div', {}, '');
    migSection.appendChild(migStatusBox);
    try {
      const status = await ctx.store.migrationStatus();
      migStatusBox.appendChild(el('p', {}, status && status.migrated ? '移行済みです' : '未移行のデータがあります'));
    } catch (e) {
      migStatusBox.appendChild(el('p', { class: 'text-error' }, '状態取得に失敗しました'));
    }
    migSection.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
      const ok = await confirmDialog('旧データからの移行を実行します（旧データは変更されません）。よろしいですか？', { okLabel: '移行する' });
      if (!ok) return;
      try {
        const report = await ctx.store.migrationRun();
        ctx.toast('移行が完了しました', 'success');
        const pre = el('pre', {}, JSON.stringify(report, null, 2));
        migSection.appendChild(pre);
      } catch (e) {
        ctx.toast('移行に失敗しました: ' + e.message, 'error');
      }
    } }, '移行を実行'));
    container.appendChild(migSection);
  }

  // iPhoneとのやり取り（ふだんは自動。ホームの［同期］でまとめて実行。ここは念のための手動操作）
  if (ctx.caps.mobileImport) {
    const mobSection = el('section', { class: 'section' });
    mobSection.appendChild(el('h3', {}, 'iPhoneとのやり取り（手動）'));
    mobSection.appendChild(el('p', { class: 'text-muted' },
      'ふだんは自動です（iPhoneからの変更は1分ごとに取り込み、iPhone用のデータは保存のたびに作り直します）。ホームの［同期］でもまとめて実行できます。うまく反映されないときだけ使ってください。'));
    try {
      const st = await ctx.store.getMobileStatus();
      mobSection.appendChild(el('p', {}, `取り込み待ち: ${(st && st.inboxCount) || 0}件 ／ iPhone用データの作成: ${st && st.snapshotAt ? String(st.snapshotAt).slice(0, 16).replace('T', ' ') : '未作成'}`));
      // 形式の誤り等で取り込めなかったファイルは mobile/failed に移される（中身は消えていない）
      if (st && st.failedCount > 0) {
        mobSection.appendChild(el('p', { class: 'text-error' }, `⚠ 取り込めなかった変更 ${st.failedCount}件（OneDriveの「LexManagerData」フォルダの「mobile」→「failed」に残っています）`));
      }
    } catch (e) { /* 状態が取れなくても操作はできる */ }
    mobSection.appendChild(el('div', { class: 'field-row' }, [
      el('button', { type: 'button', class: 'btn', onClick: async () => {
        if (!(await confirmDialog('iPhoneからの変更を今すぐ取り込みます。よろしいですか？', { okLabel: '取り込む' }))) return;
        try {
          const r = await ctx.store.importMobile();
          ctx.toast(`取り込みました: 反映${r.applied || 0}件 ／ 統合${r.merged || 0}件 ／ 競合${r.conflicts || 0}件`, r.conflicts ? 'info' : 'success');
        } catch (e) { ctx.toast('取り込みに失敗しました: ' + e.message, 'error'); }
      } }, 'iPhoneからの変更を取り込む'),
      el('button', { type: 'button', class: 'btn', onClick: async () => {
        if (!(await confirmDialog('iPhone用のデータを今すぐ作り直します。よろしいですか？', { okLabel: '作り直す' }))) return;
        try {
          await ctx.store.regenerateSnapshot();
          ctx.toast('iPhone用のデータを作り直しました', 'success');
        } catch (e) { ctx.toast('作成に失敗しました: ' + e.message, 'error'); }
      } }, 'iPhone用のデータを作り直す')
    ]));
    container.appendChild(mobSection);
  }

  // 競合一覧
  if (ctx.caps.conflicts) {
    const conflictSection = el('section', { class: 'section' });
    conflictSection.appendChild(el('h3', {}, '競合一覧'));
    const box = el('div', {}, '');
    conflictSection.appendChild(box);
    try {
      const res = await ctx.store.getConflicts();
      const items = (res && res.items) || [];
      if (!items.length) {
        box.appendChild(el('p', { class: 'text-muted' }, '競合はありません'));
      }
      const COLL_LABEL = { clients: '顧客', cases: '案件', todos: 'ToDo' };
      const nameOf = (r) => (r && (r.caseName || r.task || r.title || r.companyName || [r.lastName, r.firstName].filter(Boolean).join(' '))) || '';
      const resolveWith = async (item, choice, record) => {
        try {
          await ctx.store.resolveConflict({ kind: item.kind, coll: item.coll, id: item.id, path: item.path, choice, record });
          ctx.toast('解決しました', 'success');
          render(container, {}, ctx);
        } catch (e) {
          ctx.toast('解決に失敗しました: ' + e.message, 'error');
        }
      };
      // 項目ごとの選択ではなく「どちらを残すか」を選ぶ種類（iPhoneからの取り込みで起きるもの）
      const SPECIAL = {
        '*deleted-on-pc*': { text: 'PCで削除済みのデータを、iPhoneで編集していました。', buttons: [['削除のままにする', 'current'], ['iPhoneの内容で復元する', 'other']] },
        '*delete*': { text: 'iPhoneで削除しましたが、PCで先に変更されていました。', buttons: [['PCの内容を残す', 'current'], ['削除する', 'delete']] },
        '*new-vs-existing*': { text: '同じデータがPCに既にありました。', buttons: [['PCの内容を残す', 'current'], ['iPhoneの内容で上書きする', 'other']] }
      };
      for (const item of items) {
        const itemBox = el('div', { class: 'section-sub' });
        const label = `${COLL_LABEL[item.coll] || item.coll}「${nameOf(item.current) || nameOf(item.other) || item.id}」`;
        itemBox.appendChild(el('p', {}, el('strong', {}, label)));
        const special = item.kind === 'mobile' && (item.fields || []).map((f) => SPECIAL[f]).find(Boolean);
        if (special) {
          itemBox.appendChild(el('p', { class: 'text-muted' }, special.text));
          itemBox.appendChild(el('div', { class: 'toolbar' }, special.buttons.map(([text, choice]) =>
            el('button', { type: 'button', class: choice === 'delete' ? 'btn btn-danger' : 'btn', onClick: () => resolveWith(item, choice) }, text))));
          box.appendChild(itemBox);
          continue;
        }
        const fieldChoices = {};
        for (const f of item.fields || []) {
          const sel = el('select', { class: 'field' }, [
            el('option', { value: 'current' }, `${item.kind === 'mobile' ? 'PCの内容' : '今の内容'}: ${formatFieldValue(item.current && item.current[f])}`),
            el('option', { value: 'other' }, `${item.kind === 'mobile' ? 'iPhoneの内容' : 'もう一方の内容'}: ${formatFieldValue(item.other && item.other[f])}`)
          ]);
          fieldChoices[f] = sel;
          itemBox.appendChild(el('label', {}, [fieldLabel(f, item.coll), sel]));
        }
        itemBox.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
          const choice = {};
          for (const f of Object.keys(fieldChoices)) choice[f] = fieldChoices[f].value;
          await resolveWith(item, 'merged', choice);
        } }, 'この内容で解決'));
        box.appendChild(itemBox);
      }
    } catch (e) {
      box.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました'));
    }
    container.appendChild(conflictSection);
  }

  // バックアップ（自動: 起動時と1時間ごとに確認し1日1回、30日分保持。手動: 全データをJSONで保存）
  const backupSection = el('section', { class: 'section' });
  backupSection.appendChild(el('h3', {}, 'バックアップ'));
  try {
    const st = ctx.store.backupStatus ? await ctx.store.backupStatus() : null;
    const fmt = (b) => (b ? `${b.at.slice(0, 16).replace('T', ' ')}（${b.device}）` : 'まだありません');
    if (st) {
      backupSection.appendChild(el('p', {}, `最終バックアップ: ${fmt(st.latest)}`));
      if (st.latest && st.latestThisDevice && st.latest.name !== st.latestThisDevice.name) {
        backupSection.appendChild(el('p', { class: 'text-muted' }, `この端末の最終バックアップ: ${fmt(st.latestThisDevice)}`));
      }
      backupSection.appendChild(el('p', { class: 'text-muted' }, `自動バックアップ: アプリ起動中に1日1回、データフォルダの backups に作成し、${st.retentionDays}日分を保存しています（現在${st.count}件。添付ファイルは含みません）。`));
    }
  } catch (e) {
    backupSection.appendChild(el('p', { class: 'text-error' }, 'バックアップの状況を取得できませんでした'));
  }
  backupSection.appendChild(el('p', { class: 'text-muted' }, '全データを1つのファイル（JSON形式）としてダウンロードします。OneDrive以外の場所にも控えを残したいときに使います。'));
  backupSection.appendChild(el('a', { href: ctx.store.exportJsonUrl(), target: '_blank', rel: 'noopener', class: 'btn' }, 'データをファイルに保存（JSON）'));
  container.appendChild(backupSection);

  // アプリを終了
  const shutdownSection = el('section', { class: 'section' });
  shutdownSection.appendChild(el('h3', {}, 'アプリ'));
  shutdownSection.appendChild(el('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
    const ok = await confirmDialog('アプリを終了します（ブラウザの画面は閉じても大丈夫です）。よろしいですか？', { okLabel: '終了する' });
    if (!ok) return;
    try {
      if (ctx.store.shutdown) {
        await ctx.store.shutdown();
      } else {
        await fetch('./api/shutdown', { method: 'POST' });
      }
      ctx.toast('終了しました', 'success');
    } catch (e) {
      ctx.toast('終了に失敗しました: ' + e.message, 'error');
    }
  } }, 'アプリを終了'));
  container.appendChild(shutdownSection);
}

/**
 * Googleカレンダー連携（PCのみ）。①Googleでの準備で得たクライアントID等を保存 → ②ログイン →
 * ③同期するカレンダーを選ぶ → ④このPCで同期する をオン。同期の仕組みは lexmanager/gcal.py。
 */
async function buildGcalSection(ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, 'Googleカレンダー連携'));
  let st;
  try {
    st = await ctx.store.gcalStatus();
  } catch (e) {
    section.appendChild(el('p', { class: 'text-error' }, '状態を取得できませんでした: ' + e.message));
    return section;
  }
  const rerender = async () => section.replaceWith(await buildGcalSection(ctx));
  const fmt = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '');

  section.appendChild(el('p', { class: 'text-muted' },
    'ToDoの「Googleカレンダーに登録」をオンにすると、選んだGoogleカレンダーに予定として登録します。そのカレンダーで追加した予定はToDoとして取り込みます。' +
    '削除は両方向に反映されます（Googleで消した予定のToDoはごみ箱へ）。同期はこのPCが起動中に10分ごと、またはホームの［同期］から行います。'));

  // ① Googleでの準備で得た値
  const idInput = el('input', { type: 'text', class: 'field', value: st.clientId || '', placeholder: 'xxxx.apps.googleusercontent.com' });
  const secretInput = el('input', { type: 'password', class: 'field', placeholder: st.clientSecretSet ? '設定済み（変更する場合のみ入力）' : 'クライアントシークレット' });
  section.appendChild(el('div', { class: 'section-sub' }, '① Google Cloud で作った「OAuthクライアント（デスクトップアプリ）」の値'));
  section.appendChild(el('label', {}, ['クライアントID', idInput]));
  section.appendChild(el('label', {}, ['クライアントシークレット', secretInput]));
  section.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
    try {
      await ctx.store.gcalConfig({ clientId: idInput.value, clientSecret: secretInput.value });
      ctx.toast('保存しました（シークレットは暗号化して保存）', 'success');
      await rerender();
    } catch (e) { ctx.toast('保存に失敗しました: ' + e.message, 'error'); }
  } }, '保存'));

  // ② ログイン
  section.appendChild(el('div', { class: 'section-sub' }, '② Googleにログイン'));
  section.appendChild(el('p', {}, st.connected ? (st.reauth ? '⚠ ログインの有効期限が切れました。もう一度ログインしてください。' : '✅ 接続済み') : '未接続'));
  section.appendChild(el('div', { class: 'field-row' }, [
    el('button', { type: 'button', class: 'btn btn-primary', disabled: !(st.clientId && st.clientSecretSet), onClick: async () => {
      try {
        const r = await ctx.store.gcalAuthStart();
        window.open(r.url, '_blank', 'noopener');
        ctx.toast('開いた画面でGoogleにログインし、許可してください。終わったらこの画面で［状態を更新］を押してください', 'info');
      } catch (e) { ctx.toast(e.message, 'error'); }
    } }, st.connected ? 'ログインし直す' : 'Googleにログイン'),
    el('button', { type: 'button', class: 'btn', onClick: rerender }, '状態を更新'),
    st.connected ? el('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
      if (!(await confirmDialog('Googleカレンダーとの接続を解除します（予定やToDoは消えません）。よろしいですか？', { okLabel: '接続を解除する', danger: true }))) return;
      await ctx.store.gcalDisconnect();
      await rerender();
    } }, '接続を解除') : null
  ]));
  section.appendChild(el('p', { class: 'text-muted' }, `Google Cloud の「承認済みのリダイレクトURI」は不要です（デスクトップアプリ用）。参考: このPCの戻り先 ${st.redirectUri}`));

  // ③ カレンダーの選択（名前ではなくIDで固定する）
  section.appendChild(el('div', { class: 'section-sub' }, '③ 同期するカレンダー'));
  const calBox = el('div', { class: 'field-row' });
  calBox.appendChild(el('span', {}, st.calendarId ? `「${st.calendarName || st.calendarId}」` : '未選択'));
  calBox.appendChild(el('button', { type: 'button', class: 'btn', disabled: !st.connected, onClick: async () => {
    try {
      const r = await ctx.store.gcalCalendars();
      const sel = el('select', { class: 'field' }, (r.items || []).map((c) =>
        el('option', { value: c.id, selected: c.id === st.calendarId || (!st.calendarId && c.name === 'ToDo') }, `${c.name}${c.primary ? '（メイン）' : ''}`)));
      clear(calBox);
      calBox.appendChild(sel);
      calBox.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
        const opt = sel.selectedOptions[0];
        if (!opt) return;
        if (!(await confirmDialog(`「${opt.textContent}」と同期します。このカレンダーの予定はToDoとして取り込まれます。よろしいですか？`, { okLabel: 'このカレンダーと同期する' }))) return;
        await ctx.store.gcalSetCalendar(opt.value, opt.textContent.replace(/（メイン）$/, ''));
        await rerender();
      } }, 'このカレンダーにする'));
    } catch (e) { ctx.toast('カレンダー一覧を取得できませんでした: ' + e.message, 'error'); }
  } }, st.calendarId ? '変更' : '選ぶ'));
  section.appendChild(calBox);

  // TBDカレンダー（ツール「空き日程の検索」で確定した候補を登録する先）
  section.appendChild(el('div', { class: 'section-sub' }, '空き日程の候補を登録するカレンダー（仮予定＝TBD）'));
  const tbdBox = el('div', { class: 'field-row' });
  tbdBox.appendChild(el('span', {}, st.tbdCalendarId ? `「${st.tbdCalendarName || st.tbdCalendarId}」` : '未選択'));
  tbdBox.appendChild(el('button', { type: 'button', class: 'btn', disabled: !st.connected, onClick: async () => {
    try {
      const r = await ctx.store.gcalCalendars();
      const sel = el('select', { class: 'field' }, (r.items || []).map((c) =>
        el('option', { value: c.id, selected: c.id === st.tbdCalendarId || (!st.tbdCalendarId && c.name === 'TBD') }, c.name)));
      clear(tbdBox);
      tbdBox.appendChild(sel);
      tbdBox.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
        const opt = sel.selectedOptions[0];
        if (!opt) return;
        await ctx.store.gcalSetTbdCalendar(opt.value, opt.textContent);
        ctx.toast(`空き日程の候補は「${opt.textContent}」に登録します`, 'success');
        await rerender();
      } }, 'このカレンダーにする'));
    } catch (e) { ctx.toast('カレンダー一覧を取得できませんでした: ' + e.message, 'error'); }
  } }, st.tbdCalendarId ? '変更' : '選ぶ'));
  section.appendChild(tbdBox);

  // ④ 同期の担当
  section.appendChild(el('div', { class: 'section-sub' }, '④ 同期を担当するPC'));
  const enabled = el('input', { type: 'checkbox', checked: !!st.enabled, disabled: !(st.connected && st.calendarId) });
  enabled.addEventListener('change', async () => {
    await ctx.store.gcalConfig({ enabled: enabled.checked });
    ctx.toast(enabled.checked ? 'このPCで同期します（10分ごと）' : 'このPCでの同期を止めました', 'success');
    await rerender();
  });
  section.appendChild(el('label', { class: 'field-row' }, [enabled, `このPC（${st.device}）で同期する（同期は1台のPCだけで行ってください）`]));
  if (st.leaseHolder && st.leaseHolder !== st.device) {
    section.appendChild(el('p', { class: 'text-error' }, `⚠ 現在「${st.leaseHolder}」が同期を担当しています。2台で同時に同期しないでください。`));
  }
  if (st.lastRun) section.appendChild(el('p', { class: 'text-muted' }, `前回の同期: ${fmt(st.lastRun)}`));
  if (st.error) section.appendChild(el('p', { class: 'text-error' }, `前回のエラー: ${st.error}`));
  return section;
}

/** PC（事務所PC）のGoogleカレンダー連携が動いているか（PCが同期のたびに書く gcal/status.json による。30分以内なら動作中） */
function gcalStatusText(s) {
  if (!s || !s.at) return '情報なし';
  const when = new Date(s.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (s.reauth) return `⚠ 停止中（事務所PCでGoogleへの再ログインが必要。前回 ${when}）`;
  if (!s.ok) return `⚠ エラーで停止中（前回 ${when}）`;
  if (Date.now() - new Date(s.at).getTime() <= 30 * 60 * 1000) return `✅ 動作中（前回の同期 ${when}）`;
  return `⚠ 止まっています（前回の同期 ${when}。事務所PCのLexManagerが起動していない可能性）`;
}

/** iPhone版: OneDrive自動同期（DESIGN.md §14。準備は docs/onedrive-setup.md） */
async function buildOneDriveSection(ctx) {
  const store = ctx.store;
  const { startLogin, DEFAULT_ROOT } = await import('../util/onedrive.js');
  const section = el('section', { class: 'section' });
  const od = store.getOd();
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const connected = !!(od.clientId && od.refreshToken);
  section.appendChild(el('h3', {}, 'OneDrive自動同期'));
  section.appendChild(el('p', { class: 'text-muted' }, '変更は自動でPCへ送られ、PCの最新データも自動で読み込みます。ログインは24時間ごとに切れます（再ログインはボタン1つ）。'));
  const status = connected
    ? (od.needLogin ? '⚠ 再ログインが必要です' : `✅ 接続中${od.lastSync ? `（前回の同期 ${fmt(od.lastSync)}${od.waiting ? `、PCの取り込み待ち ${od.waiting}件` : ''}）` : ''}`)
    : '未接続';
  section.appendChild(el('p', {}, status));
  if (od.lastError) section.appendChild(el('p', { class: 'text-error' }, `前回のエラー: ${od.lastError}`));

  const idInput = el('input', { type: 'text', class: 'field', value: od.clientId || '', placeholder: 'アプリケーション（クライアント）ID' });
  const rootInput = el('input', { type: 'text', class: 'field', value: od.root || DEFAULT_ROOT });
  section.appendChild(el('label', {}, ['アプリケーション（クライアント）ID（Azureで登録したもの）', idInput]));
  section.appendChild(el('label', {}, ['OneDrive上のデータフォルダ', rootInput]));
  section.appendChild(el('div', { class: 'field-row' }, [
    el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
      const id = idInput.value.trim();
      if (!/^[0-9a-f-]{36}$/i.test(id)) { ctx.toast('アプリケーション（クライアント）IDを正しく入力してください', 'error'); return; }
      await store.setOd({ clientId: id, root: rootInput.value.trim() || DEFAULT_ROOT });
      await startLogin(id);
    } }, connected ? 'Microsoftに再ログイン' : 'Microsoftでログイン'),
    connected ? el('button', { type: 'button', class: 'btn', onClick: async () => {
      if (!ctx.autosync) return;
      ctx.toast('同期しています…', 'info');
      const r = await ctx.autosync.run();
      const s = store.getOd();
      if (s.needLogin) ctx.toast('再ログインが必要です', 'error');
      else if (s.lastError) ctx.toast(`同期に失敗しました: ${s.lastError}`, 'error');
      else ctx.toast(`同期しました${r && r.sent ? `（${r.sent}件を送信）` : ''}${r && r.imported ? '（PCのデータを読み込み）' : ''}`, 'success');
      ctx.navigate('#/settings');
    } }, '今すぐ同期') : null,
    connected ? el('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
      if (!(await ctx.confirm('OneDriveとの接続を解除します（この端末のデータは消えません。以後は手動の同期になります）。よろしいですか？', { okLabel: '接続を解除する', danger: true }))) return;
      await store.clearOd();
      ctx.navigate('#/settings');
    } }, '接続を解除') : null
  ]));
  return section;
}

async function renderLocalMode(container, ctx) {
  const store = ctx.store;
  if (store.getOd) container.appendChild(await buildOneDriveSection(ctx));
  container.appendChild(el('section', { class: 'section' }, [
    el('h3', {}, 'Googleカレンダー連携'),
    el('p', {}, gcalStatusText(store.getGcalStatus ? store.getGcalStatus() : null))
  ]));

  // 手動のやり取り（OneDrive自動同期を使っていれば通常は不要）
  const manualSection = el('section', { class: 'section' });
  const odOn = !!(store.getOd && store.getOd().refreshToken);
  manualSection.appendChild(el('h3', {}, odOn ? 'PCとのやり取り（手動・通常は不要）' : 'PCとのやり取り（手動）'));
  manualSection.appendChild(el('p', { class: 'text-muted' }, '［PCのデータを読み込む］: PCが作ったファイル（OneDriveの「LexManagerData」フォルダの「mobile」にある snapshot.json）を選びます。［変更を書き出す］: この端末の変更をファイルにします。OneDriveの「LexManagerData」フォルダの「mobile」→「inbox」に保存してください。'));
  const fileInput = el('input', { type: 'file', accept: 'application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !store.importSnapshot) return;
    try {
      if (store.hasUnexportedChanges && await store.hasUnexportedChanges()) {
        const ok = await ctx.confirm('この端末には、まだ書き出していない変更があります。読み込むとその変更は消えます。先に［変更を書き出す］を行うことをお勧めします。このまま読み込みますか？', { okLabel: '変更を捨てて読み込む', danger: true });
        if (!ok) { fileInput.value = ''; return; }
      }
      const r = await store.importSnapshot(file);
      fileInput.value = '';
      ctx.toast(`読み込みました（顧客${r.counts.clients}件・案件${r.counts.cases}件・ToDo${r.counts.todos}件）`, 'success');
      await ctx.refresh();
      ctx.navigate('#/home');
    } catch (e) {
      ctx.toast('読み込みに失敗しました: ' + e.message, 'error');
    }
  });
  let pending = 0;
  try {
    pending = (store.pendingChangesCount && await store.pendingChangesCount()) || 0;
  } catch (e) { /* ignore */ }
  manualSection.appendChild(fileInput);
  const manualRow = el('div', { class: 'toolbar' });
  manualRow.appendChild(el('button', { type: 'button', class: 'btn', onClick: () => fileInput.click() }, 'PCのデータを読み込む'));
  manualRow.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
    if (!store.exportChanges) { ctx.toast('この端末では利用できません', 'error'); return; }
    try {
      const r = await store.exportChanges();
      ctx.toast(`${r.count}件の変更を書き出しました。OneDriveの「LexManagerData」フォルダの「mobile」→「inbox」に保存してください`, 'success');
      ctx.navigate('#/settings');
    } catch (e) {
      ctx.toast('書き出しに失敗しました: ' + e.message, 'error');
    }
  } }, `変更を書き出す（${pending}件）`));
  manualSection.appendChild(manualRow);
  container.appendChild(manualSection);

  container.appendChild(await buildLocalPasswordSection(ctx));

  let legacyData = null;
  try {
    legacyData = store.getLegacyIphoneData ? await store.getLegacyIphoneData() : null;
  } catch (e) { /* ignore */ }
  if (legacyData) {
    const legacySection = el('section', { class: 'section' });
    legacySection.appendChild(el('h3', {}, '旧iPhone版データの書き出し'));
    legacySection.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
      try {
        await store.exportLegacyIphoneData();
        ctx.toast('書き出しました', 'success');
      } catch (e) {
        ctx.toast('書き出しに失敗しました: ' + e.message, 'error');
      }
    } }, '書き出す'));
    container.appendChild(legacySection);
  }

  const deviceSection = el('section', { class: 'section' });
  deviceSection.appendChild(el('h3', {}, '端末名'));
  const deviceInput = el('input', { type: 'text', class: 'field', value: store.getDeviceName ? store.getDeviceName() : '' });
  deviceSection.appendChild(deviceInput);
  deviceSection.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
    if (!store.setDeviceName) { ctx.toast('この端末では利用できません', 'error'); return; }
    try {
      await store.setDeviceName(deviceInput.value);
      ctx.toast('設定しました', 'success');
    } catch (e) {
      ctx.toast('設定に失敗しました: ' + e.message, 'error');
    }
  } }, '保存'));
  container.appendChild(deviceSection);
}
