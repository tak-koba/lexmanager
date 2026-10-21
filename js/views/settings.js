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

  // Googleカレンダー連携
  if (ctx.store.gcalStatus) container.appendChild(await buildGcalSection(ctx));

  // LANアクセス
  const lanSection = el('section', { class: 'section' });
  lanSection.appendChild(el('h3', {}, 'LANアクセス'));
  lanSection.appendChild(el('p', { class: 'text-muted' }, 'オンにすると、同じネットワーク（事務所のWi-Fi等）にある他の端末のブラウザから、このPCのLexManagerを開けるようになります（表示されるトークンが必要）。iPhoneは同期（Import／Export）で使えるため、通常はオフのままで構いません。'));
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
    updateSection.appendChild(el('h3', {}, 'Update'));
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

  // iPhoneとの同期はホームの［同期］（Import / Export）に一本化した

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
  backupSection.appendChild(el('p', { class: 'text-muted' }, '［保存］は、全データを1つのファイル（JSON）としてダウンロードします。OneDrive以外の場所にも控えを残したいときに使います。'));
  backupSection.appendChild(el('a', { href: ctx.store.exportJsonUrl(), target: '_blank', rel: 'noopener', class: 'btn' }, '保存'));
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
    'ToDoの「カレンダー登録」をオンにすると、選んだGoogleカレンダーに予定として登録します。そのカレンダーで追加した予定はToDoとして取り込みます。' +
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
      if (!(await confirmDialog('Googleカレンダーとの接続を解除します（予定やToDoは消えません）。よろしいですか？'))) return;
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
        if (!(await confirmDialog(`「${opt.textContent}」と同期します。このカレンダーの予定はToDoとして取り込まれます。よろしいですか？`))) return;
        await ctx.store.gcalSetCalendar(opt.value, opt.textContent.replace(/（メイン）$/, ''));
        await rerender();
      } }, 'このカレンダーにする'));
    } catch (e) { ctx.toast('カレンダー一覧を取得できませんでした: ' + e.message, 'error'); }
  } }, st.calendarId ? '変更' : '選ぶ'));
  section.appendChild(calBox);

  // TBDカレンダー（ツール「空き日程の検索」で確定した候補を登録する先）
  section.appendChild(el('div', { class: 'section-sub' }, '空き日程の候補を登録するカレンダー（TBD）'));
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
