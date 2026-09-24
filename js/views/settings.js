// LexManager 4 - 設定（サーバーモード／ローカルモードで内容が分岐）
import { el, clear } from '../ui/dom.js';
import { confirmDialog } from '../ui/dialog.js';

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, '設定'));

  if (ctx.caps.ai || ctx.caps.trash || ctx.caps.update || ctx.caps.migrate || ctx.caps.mobileImport || ctx.caps.conflicts) {
    await renderServerMode(container, ctx);
  } else {
    await renderLocalMode(container, ctx);
  }
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
      const ok = await confirmDialog('APIキーをクリアします。よろしいですか？');
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

  // LANアクセス
  const lanSection = el('section', { class: 'section' });
  lanSection.appendChild(el('h3', {}, 'LANアクセス'));
  const lanCheckbox = el('input', { type: 'checkbox', checked: !!settings.lanAccess });
  lanSection.appendChild(el('label', { class: 'field-row' }, [lanCheckbox, 'LANアクセスを許可する']));
  if (settings.lanAccess && settings.lanToken) {
    lanSection.appendChild(el('p', { class: 'text-muted' }, `トークン: ${settings.lanToken}`));
  }
  lanSection.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
    try {
      await ctx.store.postSettings({ lanAccess: lanCheckbox.checked });
      ctx.toast('保存しました。反映には再起動が必要です', 'success');
    } catch (e) {
      ctx.toast('保存に失敗しました: ' + e.message, 'error');
    }
  } }, '保存'));
  container.appendChild(lanSection);

  // 更新確認
  if (ctx.caps.update) {
    const updateSection = el('section', { class: 'section' });
    updateSection.appendChild(el('h3', {}, '更新確認・適用'));
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
      } }, '確認'),
      el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
        const ok = await confirmDialog('更新を適用します。よろしいですか？');
        if (!ok) return;
        try {
          await ctx.store.updateApply();
          ctx.toast('更新しました。アプリを再起動してください', 'success');
        } catch (e) {
          ctx.toast('更新に失敗しました: ' + e.message, 'error');
        }
      } }, '適用')
    ]));
    container.appendChild(updateSection);
  }

  // 移行
  if (ctx.caps.migrate) {
    const migSection = el('section', { class: 'section' });
    migSection.appendChild(el('h3', {}, '移行'));
    const migStatusBox = el('div', {}, '');
    migSection.appendChild(migStatusBox);
    try {
      const status = await ctx.store.migrationStatus();
      migStatusBox.appendChild(el('p', {}, status && status.migrated ? '移行済みです' : '未移行のデータがあります'));
    } catch (e) {
      migStatusBox.appendChild(el('p', { class: 'text-error' }, '状態取得に失敗しました'));
    }
    migSection.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
      const ok = await confirmDialog('旧データからの移行を実行します。よろしいですか？');
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

  // iPhone取込
  if (ctx.caps.mobileImport) {
    const mobSection = el('section', { class: 'section' });
    mobSection.appendChild(el('h3', {}, 'iPhone取込'));
    const box = el('div', {}, '');
    mobSection.appendChild(box);
    try {
      const status = await ctx.store.getMobileStatus();
      box.appendChild(el('p', {}, `取込待ち: ${(status && status.inboxCount) || 0} 件`));
    } catch (e) {
      box.appendChild(el('p', { class: 'text-error' }, '状態取得に失敗しました'));
    }
    mobSection.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
      try {
        const res = await ctx.store.importMobile();
        ctx.toast(`取込完了: 適用${res.applied || 0}件 / 統合${res.merged || 0}件 / 競合${res.conflicts || 0}件`, 'success');
      } catch (e) {
        ctx.toast('取込に失敗しました: ' + e.message, 'error');
      }
    } }, '取込実行'));
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
      for (const item of items) {
        const itemBox = el('div', { class: 'section-sub' });
        itemBox.appendChild(el('p', {}, `${item.kind} / ${item.coll} / ${item.id}`));
        const fieldChoices = {};
        for (const f of item.fields || []) {
          const sel = el('select', { class: 'field' }, [
            el('option', { value: 'current' }, `現在: ${JSON.stringify(item.current && item.current[f])}`),
            el('option', { value: 'other' }, `他方: ${JSON.stringify(item.other && item.other[f])}`)
          ]);
          fieldChoices[f] = sel;
          itemBox.appendChild(el('label', {}, [f, sel]));
        }
        itemBox.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
          const choice = {};
          for (const f of Object.keys(fieldChoices)) choice[f] = fieldChoices[f].value;
          try {
            await ctx.store.resolveConflict({ kind: item.kind, coll: item.coll, id: item.id, path: item.path, choice: 'merged', record: choice });
            ctx.toast('解決しました', 'success');
            render(container, {}, ctx);
          } catch (e) {
            ctx.toast('解決に失敗しました: ' + e.message, 'error');
          }
        } }, 'この内容で解決'));
        box.appendChild(itemBox);
      }
    } catch (e) {
      box.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました'));
    }
    container.appendChild(conflictSection);
  }

  // JSONバックアップ
  const backupSection = el('section', { class: 'section' });
  backupSection.appendChild(el('h3', {}, 'JSONバックアップ'));
  backupSection.appendChild(el('a', { href: ctx.store.exportJsonUrl(), target: '_blank', rel: 'noopener', class: 'btn' }, 'JSONダウンロード'));
  container.appendChild(backupSection);

  // アプリを終了
  const shutdownSection = el('section', { class: 'section' });
  shutdownSection.appendChild(el('h3', {}, 'アプリ'));
  shutdownSection.appendChild(el('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
    const ok = await confirmDialog('アプリを終了します。よろしいですか？');
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

async function renderLocalMode(container, ctx) {
  const store = ctx.store;

  const loadSection = el('section', { class: 'section' });
  loadSection.appendChild(el('h3', {}, 'データの読込'));
  loadSection.appendChild(el('p', { class: 'text-muted' }, 'PCから書き出した snapshot.json を選択してください'));
  const fileInput = el('input', { type: 'file', accept: 'application/json' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !store.importSnapshot) return;
    try {
      if (store.hasUnexportedChanges && await store.hasUnexportedChanges()) {
        const ok = await ctx.confirm('この端末には、まだ書き出していない変更があります。読み込むとその変更は消えます。先に［変更を書き出す］を行うことをお勧めします。このまま読み込みますか？');
        if (!ok) { fileInput.value = ''; return; }
      }
      const r = await store.importSnapshot(file);
      fileInput.value = '';
      ctx.toast(`読み込みました（顧客${r.counts.clients}件・案件${r.counts.cases}件・ToDo${r.counts.todos}件）`, 'success');
      await ctx.refresh();
      ctx.navigate('#/home');
    } catch (e) {
      ctx.toast('読込に失敗しました: ' + e.message, 'error');
    }
  });
  loadSection.appendChild(fileInput);
  container.appendChild(loadSection);

  const exportSection = el('section', { class: 'section' });
  exportSection.appendChild(el('h3', {}, '変更の書出し'));
  let pending = 0;
  try {
    pending = (store.pendingChangesCount && await store.pendingChangesCount()) || 0;
  } catch (e) { /* ignore */ }
  exportSection.appendChild(el('p', { class: 'text-muted' }, `未書出しの変更: ${pending} 件`));
  exportSection.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
    if (!store.exportChanges) { ctx.toast('この端末では利用できません', 'error'); return; }
    try {
      const r = await store.exportChanges();
      ctx.toast(`${r.count}件の変更を書き出しました。OneDriveの LexManagerData/mobile/inbox に保存してください`, 'success');
      ctx.navigate('#/settings');
    } catch (e) {
      ctx.toast('書出しに失敗しました: ' + e.message, 'error');
    }
  } }, '書き出す'));
  container.appendChild(exportSection);

  const passSection = el('section', { class: 'section' });
  passSection.appendChild(el('h3', {}, '合言葉の設定・変更'));
  const passInput = el('input', { type: 'password', class: 'field', placeholder: '合言葉' });
  passSection.appendChild(passInput);
  passSection.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
    if (!store.setPassphrase) { ctx.toast('この端末では利用できません', 'error'); return; }
    try {
      await store.setPassphrase(passInput.value);
      ctx.toast('設定しました', 'success');
      passInput.value = '';
    } catch (e) {
      ctx.toast('設定に失敗しました: ' + e.message, 'error');
    }
  } }, '設定'));
  container.appendChild(passSection);

  let legacyData = null;
  try {
    legacyData = store.getLegacyIphoneData ? await store.getLegacyIphoneData() : null;
  } catch (e) { /* ignore */ }
  if (legacyData) {
    const legacySection = el('section', { class: 'section' });
    legacySection.appendChild(el('h3', {}, '旧iPhone版データの書出し'));
    legacySection.appendChild(el('button', { type: 'button', class: 'btn', onClick: async () => {
      try {
        await store.exportLegacyIphoneData();
        ctx.toast('書き出しました', 'success');
      } catch (e) {
        ctx.toast('書出しに失敗しました: ' + e.message, 'error');
      }
    } }, '書き出す'));
    container.appendChild(legacySection);
  }

  const deviceSection = el('section', { class: 'section' });
  deviceSection.appendChild(el('h3', {}, '端末名'));
  const deviceInput = el('input', { type: 'text', class: 'field' });
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
