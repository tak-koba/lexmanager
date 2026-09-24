// LexManager 4 - views 共通の小さなヘルパー群（views/ 配下でのみ使用）。
// 新規の独立ファイルは増やさない方針だが、9つのビュー間で重複しがちな
// UI片（バッジ・コピー・クイック登録ダイアログ・AI確認フロー）はここに集約する。

import { el, clear } from '../ui/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { deadlineBadge, displayName, kanaName, sortByKana, opponentName, defaultClient, defaultCase, defaultTodo, newId, PHONE_TYPES } from '../model.js';
import { formatDate, formatDateTime, todayIso } from '../ui/dates.js';
import { lookupZip, googleMapsUrl, addressSearchUrl } from '../util/zip.js';
import { setupKanaAssist } from '../util/kana.js';
import { ConflictError } from '../api.js';

export { deadlineBadge, displayName, kanaName, sortByKana, opponentName, defaultClient, defaultCase, defaultTodo, newId, PHONE_TYPES, formatDate, formatDateTime, todayIso };

const BADGE_CLASS = {
  overdue: 'badge-overdue',
  today: 'badge-today',
  soon: 'badge-soon',
  later: 'badge-later'
};

const BADGE_LABEL = {
  overdue: '超過',
  today: '本日',
  soon: 'まもなく',
  later: ''
};

/** 期限日付から <span class="badge badge-xxx"> を作る。空なら null。 */
export function renderDeadlineBadge(dateStr) {
  if (!dateStr) return null;
  const kind = deadlineBadge(dateStr);
  if (!kind) return null;
  // 旧版で自動付与された「T00:00」は時刻なしとして表示する
  const hasTime = dateStr.length > 10 && !dateStr.endsWith('T00:00');
  const dateLabel = hasTime ? formatDateTime(dateStr) : formatDate(dateStr.slice(0, 10));
  const label = BADGE_LABEL[kind] ? `${BADGE_LABEL[kind]} ${dateLabel}` : dateLabel;
  return el('span', { class: ['badge', BADGE_CLASS[kind] || ''] }, label);
}

export function telLink(number) {
  if (!number) return null;
  return el('a', { href: `tel:${String(number).replace(/[^0-9+]/g, '')}` }, number);
}

export function mailLink(email) {
  if (!email) return null;
  return el('a', { href: `mailto:${email}` }, email);
}

/** クリップボードコピー用のボタン。text は文字列 or 引数無し関数。 */
export function copyButton(ctx, text, label = 'コピー') {
  return el('button', {
    type: 'button',
    class: 'btn btn-small',
    onClick: async () => {
      const value = typeof text === 'function' ? text() : text;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        ctx.toast('コピーしました', 'success');
      } catch (e) {
        ctx.toast('コピーに失敗しました', 'error');
      }
    }
  }, label);
}

/** 住所行: 表示 + Googleマップリンク + コピー。 */
export function addressDisplayRow(ctx, zip, addr) {
  const parts = [];
  if (zip) parts.push(el('span', { class: 'text-muted' }, `〒${zip}`));
  parts.push(el('span', {}, addr || ''));
  if (addr) {
    parts.push(el('a', { href: googleMapsUrl(addr), target: '_blank', rel: 'noopener' }, '地図'));
    parts.push(copyButton(ctx, addr));
  }
  return el('div', { class: 'field-row' }, parts);
}

/** 郵便番号入力の隣に置く「住所検索」ボタン。zipInput.value を見て addrInput.value を埋める。 */
export function zipLookupButton(ctx, zipInput, addrInput) {
  return el('button', {
    type: 'button',
    class: 'btn btn-small',
    onClick: async () => {
      const code = (zipInput.value || '').replace(/[^0-9]/g, '');
      if (code.length !== 7) {
        ctx.toast('郵便番号は7桁で入力してください', 'error');
        return;
      }
      try {
        const res = await lookupZip(code, { mode: ctx.caps.ai ? 'server' : 'local' });
        const results = res && res.results;
        if (!results || !results.length) {
          ctx.toast('住所が見つかりませんでした。手入力してください', 'error');
          return;
        }
        const r = results[0];
        addrInput.value = `${r.pref || ''}${r.city || ''}${r.town || ''}`;
      } catch (e) {
        ctx.toast('郵便番号検索に失敗しました。手入力してください', 'error');
      }
    }
  }, '住所検索');
}

/** 住所→郵便番号（Google検索）リンクボタン。 */
export function addressSearchButton(addrInput) {
  return el('button', {
    type: 'button',
    class: 'btn btn-small',
    onClick: () => {
      const addr = addrInput.value || '';
      if (!addr) return;
      window.open(addressSearchUrl(addr), '_blank', 'noopener');
    }
  }, '郵便番号検索');
}

export function kanaAssistPair(nameInput, kanaInput) {
  try {
    setupKanaAssist(nameInput, kanaInput);
  } catch (e) {
    // util/kana.js 未実装でも壊れないようにする
  }
}

/** セクション見出し + [編集]ボタンの共通レイアウト。 */
export function sectionHeader(title, onEdit) {
  const header = el('div', { class: 'section-header' }, [
    el('h3', {}, title)
  ]);
  if (onEdit) {
    header.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: onEdit }, '編集'));
  }
  return header;
}

// ---------------- クイック登録ダイアログ ----------------

export function quickCreateClientDialog(ctx) {
  return new Promise((resolve) => {
    let type = 'individual';
    const form = el('form', { class: 'quick-form' });

    const typeRow = el('div', { class: 'field-row' }, [
      el('label', {}, [
        el('input', { type: 'radio', name: 'qtype', value: 'individual', checked: true, onChange: () => { type = 'individual'; renderFields(); } }),
        ' 個人'
      ]),
      el('label', {}, [
        el('input', { type: 'radio', name: 'qtype', value: 'corporate', onChange: () => { type = 'corporate'; renderFields(); } }),
        ' 法人'
      ])
    ]);

    const fieldsBox = el('div', { class: 'field-box' });
    form.appendChild(typeRow);
    form.appendChild(fieldsBox);

    function renderFields() {
      clear(fieldsBox);
      if (type === 'individual') {
        const lastName = el('input', { type: 'text', name: 'lastName', class: 'field' });
        const firstName = el('input', { type: 'text', name: 'firstName', class: 'field' });
        const lastNameKana = el('input', { type: 'text', name: 'lastNameKana', class: 'field' });
        const firstNameKana = el('input', { type: 'text', name: 'firstNameKana', class: 'field' });
        kanaAssistPair(lastName, lastNameKana);
        kanaAssistPair(firstName, firstNameKana);
        fieldsBox.appendChild(el('div', { class: 'field-row' }, [
          el('label', {}, ['姓', lastName]),
          el('label', {}, ['名', firstName])
        ]));
        fieldsBox.appendChild(el('div', { class: 'field-row' }, [
          el('label', {}, ['せい', lastNameKana]),
          el('label', {}, ['めい', firstNameKana])
        ]));
      } else {
        const companyName = el('input', { type: 'text', name: 'companyName', class: 'field' });
        const companyNameKana = el('input', { type: 'text', name: 'companyNameKana', class: 'field' });
        kanaAssistPair(companyName, companyNameKana);
        fieldsBox.appendChild(el('label', {}, ['会社名', companyName]));
        fieldsBox.appendChild(el('label', {}, ['かな', companyNameKana]));
      }
      fieldsBox.appendChild(el('label', {}, ['電話番号', el('input', { type: 'tel', name: 'phone', class: 'field' })]));
    }
    renderFields();

    const dlg = openDialog({
      title: '新規顧客（クイック登録）',
      bodyNode: form,
      actions: [
        { label: 'キャンセル', onClick: () => resolve(null) },
        {
          label: '登録',
          primary: true,
          onClick: async () => {
            const data = new FormData(form);
            const rec = defaultClient(type);
            if (type === 'individual') {
              rec.lastName = data.get('lastName') || '';
              rec.firstName = data.get('firstName') || '';
              rec.lastNameKana = data.get('lastNameKana') || '';
              rec.firstNameKana = data.get('firstNameKana') || '';
            } else {
              rec.companyName = data.get('companyName') || '';
              rec.companyNameKana = data.get('companyNameKana') || '';
            }
            const phone = data.get('phone') || '';
            if (phone) rec.phones = [{ type: '携帯電話', number: phone }];
            rec.registeredAt = todayIso();
            try {
              const created = await ctx.store.create('clients', rec);
              ctx.toast('顧客を登録しました', 'success');
              resolve(created);
            } catch (e) {
              ctx.toast('登録に失敗しました: ' + e.message, 'error');
              resolve(null);
            }
          }
        }
      ]
    });
    void dlg;
  });
}

export function quickCreateCaseDialog(ctx, clients) {
  return new Promise((resolve) => {
    let caseType = 'client';
    const form = el('form', { class: 'quick-form' });
    const typeRow = el('div', { class: 'field-row' }, [
      el('label', {}, [
        el('input', { type: 'radio', name: 'qcasetype', value: 'client', checked: true, onChange: () => { caseType = 'client'; } }),
        ' 顧客案件'
      ]),
      el('label', {}, [
        el('input', { type: 'radio', name: 'qcasetype', value: 'court', onChange: () => { caseType = 'court'; } }),
        ' 裁判所案件'
      ])
    ]);
    const nameInput = el('input', { type: 'text', name: 'caseName', class: 'field', required: true });
    const clientSelect = el('select', { name: 'clientIds', class: 'field', multiple: true, size: Math.min(6, Math.max(3, (clients || []).length)) },
      sortByKana((clients || []).slice(), kanaName).map((c) => el('option', { value: c.id }, displayName(c)))
    );
    form.appendChild(typeRow);
    form.appendChild(el('label', {}, ['案件名', nameInput]));
    form.appendChild(el('label', {}, ['依頼者（複数選択可）', clientSelect]));

    openDialog({
      title: '新規案件（クイック登録）',
      bodyNode: form,
      actions: [
        { label: 'キャンセル', onClick: () => resolve(null) },
        {
          label: '登録',
          primary: true,
          onClick: async () => {
            const rec = defaultCase(caseType);
            rec.caseName = nameInput.value || '';
            rec.clientIds = Array.from(clientSelect.selectedOptions).map((o) => o.value);
            rec.registeredAt = todayIso();
            try {
              const created = await ctx.store.create('cases', rec);
              ctx.toast('案件を登録しました', 'success');
              resolve(created);
            } catch (e) {
              ctx.toast('登録に失敗しました: ' + e.message, 'error');
              resolve(null);
            }
          }
        }
      ]
    });
  });
}

export function quickCreateTodoDialog(ctx, cases, presetCaseId) {
  return new Promise((resolve) => {
    const form = el('form', { class: 'quick-form' });
    const titleInput = el('input', { type: 'text', name: 'title', class: 'field', required: true });
    const deadlineInput = el('input', { type: 'date', name: 'deadline', class: 'field' });
    const caseSelect = el('select', { name: 'caseId', class: 'field' }, [
      el('option', { value: '' }, '（個別ToDo）'),
      ...sortByKana((cases || []).slice(), (c) => c.caseName).map((c) => el('option', { value: c.id, selected: c.id === presetCaseId }, c.caseName))
    ]);
    form.appendChild(el('label', {}, ['内容', titleInput]));
    form.appendChild(el('label', {}, ['期限', deadlineInput]));
    form.appendChild(el('label', {}, ['案件', caseSelect]));

    openDialog({
      title: '新規ToDo（クイック登録）',
      bodyNode: form,
      actions: [
        { label: 'キャンセル', onClick: () => resolve(null) },
        {
          label: '登録',
          primary: true,
          onClick: async () => {
            const rec = defaultTodo();
            rec.title = titleInput.value || '';
            rec.deadline = deadlineInput.value || '';
            rec.caseId = caseSelect.value || '';
            if (!rec.title) {
              ctx.toast('内容を入力してください', 'error');
              return 'keep-open';
            }
            try {
              const created = await ctx.store.create('todos', rec);
              ctx.toast('ToDoを登録しました', 'success');
              resolve(created);
            } catch (e) {
              ctx.toast('登録に失敗しました: ' + e.message, 'error');
              resolve(null);
            }
          }
        }
      ]
    });
  });
}

// ---------------- AI抽出の確認→実行→レビューフロー ----------------

/**
 * @param {object} ctx
 * @param {object} payload store.aiExtract に渡すpayload（kind等）
 * @param {Array<{key,label}>} fields レビュー画面で確認するフィールド定義
 * @param {Function} onApply (selectedData)=>void 反映処理はビュー側で実装
 */
export async function runAiExtractFlow(ctx, payload, fields, onApply) {
  if (!ctx.caps.ai) return;
  const ok = await confirmDialog('外部（Anthropic）へ送信します。よろしいですか？');
  if (!ok) return;
  let data;
  try {
    const res = await ctx.store.aiExtract(payload);
    data = res && res.data;
  } catch (e) {
    ctx.toast('AI読取に失敗しました: ' + e.message, 'error');
    return;
  }
  if (!data) {
    ctx.toast('AI読取結果が空でした', 'error');
    return;
  }

  return new Promise((resolve) => {
    const form = el('form', { class: 'quick-form' });
    const checks = [];
    for (const f of fields) {
      const value = data[f.key];
      if (value === undefined || value === null || value === '') continue;
      const cb = el('input', { type: 'checkbox', name: f.key, checked: true });
      checks.push({ key: f.key, cb, value });
      form.appendChild(el('label', { class: 'field-row' }, [cb, `${f.label}: ${value}`]));
    }
    if (!checks.length) {
      ctx.toast('抽出できた項目がありませんでした', 'info');
      resolve(null);
      return;
    }
    openDialog({
      title: 'AI読取結果の確認',
      bodyNode: form,
      actions: [
        { label: 'キャンセル', onClick: () => resolve(null) },
        {
          label: '反映',
          primary: true,
          onClick: async () => {
            const selected = {};
            for (const c of checks) {
              if (c.cb.checked) selected[c.key] = c.value;
            }
            await onApply(selected);
            resolve(selected);
          }
        }
      ]
    });
  });
}

// ---------------- 保存（競合時の解決つき） ----------------

const FIELD_LABELS = {
  lastName: '姓', firstName: '名', lastNameKana: 'せい', firstNameKana: 'めい', companyName: '会社名',
  companyNameKana: '会社名よみ', representative: '代表者', repTitle: '代表者役職', birthday: '生年月日',
  phones: '電話番号', email: 'メール', mainZip: '郵便番号', mainAddr: '住所', prevZip: '前住所〒', prevAddr: '前住所',
  hkAddr: '本籍', notes: '備考', tags: 'タグ', referrer: '紹介者', referrerAttr: '紹介者属性', envelope: '封筒郵送',
  hoterasu: '法テラス', retainerContract: '顧問契約', retainerDate: '顧問契約日', altContacts: '本人以外の連絡先',
  contactPersons: '担当者', branchOffices: '事業所', relatedCompanies: '関連会社', cards: '名刺', attachments: '添付',
  isArchived: '終了', registeredAt: '登録日', caseName: '案件名', clientIds: '依頼者', caseCategory: '案件区分',
  overview: '概要', requestContent: '依頼内容', commissionSigned: '委任契約', opponents: '相手方', trialType: '裁判種別',
  trialMethod: '期日方法', trialPrep: '準備事項', courtRole: '役割', trialCourt: '裁判所', trialDept: '担当部',
  trialClerk: '書記官', trialTel: '裁判所電話', trialFax: '裁判所FAX', nextDate: '次回期日', minutes: '議事録',
  title: '内容', deadline: '期限', done: '完了', caseId: '関連案件'
};

function showValue(v) {
  if (v === undefined || v === null || v === '') return '（空）';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * レコードを保存する。base=編集開始時のレコード、payload=保存したい全体。
 * 他端末と同じ項目を変えていた場合は項目ごとに選ばせ、自分が変えた項目だけを最新版に重ねて保存する。
 * 戻り値: 保存後のレコード（キャンセル・失敗時は null）
 */
export async function saveRecord(ctx, coll, base, payload) {
  try {
    const res = await ctx.store.update(coll, payload, base);
    ctx.toast(res.merged ? '保存しました（他の端末の変更と統合しました）' : '保存しました', 'success');
    return res.record;
  } catch (e) {
    if (!(e instanceof ConflictError)) {
      ctx.toast('保存に失敗しました: ' + e.message, 'error');
      return null;
    }
    const current = e.current;
    const mineChanged = Object.keys(payload).filter((k) => !['rev', 'updatedAt', 'updatedBy'].includes(k) && !sameValue(payload[k], base[k]));
    const body = el('div', { class: 'field-stack' }, [
      el('p', {}, '保存しようとした項目が、他の端末でも変更されています。項目ごとに残す内容を選んでください。')
    ]);
    const choices = {};
    for (const key of e.fields) {
      const name = `cf_${key}`;
      const mine = el('input', { type: 'radio', name, value: 'mine', checked: true });
      const theirs = el('input', { type: 'radio', name, value: 'theirs' });
      choices[key] = mine;
      body.appendChild(el('div', { class: 'field-box' }, [
        el('div', { class: 'section-sub' }, FIELD_LABELS[key] || key),
        el('label', {}, [mine, `この端末の内容: ${showValue(payload[key])}`]),
        el('label', {}, [theirs, `他の端末の内容: ${showValue(current[key])}`])
      ]));
    }
    return new Promise((resolve) => {
      openDialog({
        title: '他の端末で変更されています',
        bodyNode: body,
        onClose: () => resolve(null),
        actions: [
          { label: 'キャンセル', onClick: () => resolve(null) },
          {
            label: 'この内容で保存', primary: true,
            onClick: async () => {
              const merged = { ...current };
              for (const k of mineChanged) merged[k] = payload[k];
              for (const k of e.fields) merged[k] = choices[k].checked ? payload[k] : current[k];
              resolve(await saveRecord(ctx, coll, current, merged));
            }
          }
        ]
      });
    });
  }
}

/** レコード削除ボタン（サーバーモードではごみ箱へ移動し、ツール画面から復元できる）。 */
export function deleteRecordButton(ctx, coll, getRecord, label, afterHash, note = '') {
  return el('button', {
    type: 'button', class: 'btn btn-small btn-danger',
    onClick: async () => {
      const where = ctx.caps && ctx.caps.trash ? '（ごみ箱に移動します。［ツール］→［ごみ箱］から戻せます）' : '';
      const ok = await ctx.confirm(`「${label}」を削除しますか？${where}${note ? ' ' + note : ''}`);
      if (!ok) return;
      try {
        await ctx.store.remove(coll, getRecord());
        ctx.toast('削除しました', 'success');
        await ctx.refresh();
        ctx.navigate(afterHash);
      } catch (e) {
        ctx.toast('削除できませんでした: ' + e.message, 'error');
      }
    }
  }, '削除');
}

/** 日付＋任意の時刻の入力欄。get() は 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM' / '' を返す。 */
export function dateTimeInputs(value) {
  const v = value || '';
  const date = el('input', { type: 'date', class: 'field', value: v.slice(0, 10) });
  const t = v.length > 10 && !v.endsWith('T00:00') ? v.slice(11, 16) : '';
  const time = el('input', { type: 'time', class: 'field', value: t, step: 300, 'aria-label': '時刻（任意）' });
  return {
    nodes: el('div', { class: 'field-row' }, [date, time, el('span', { class: 'text-muted' }, '時刻は任意')]),
    get: () => (date.value ? (time.value ? `${date.value}T${time.value}` : date.value) : '')
  };
}

/** ToDoの編集ダイアログ（内容・期限・関連案件・メモ・完了・削除）。変更があれば true を返す。 */
export function editTodoDialog(ctx, todo, cases) {
  return new Promise((resolve) => {
    const title = el('input', { type: 'text', value: todo.title || '', required: true });
    const dl = dateTimeInputs(todo.deadline);
    const caseSel = el('select', {}, [
      el('option', { value: '' }, '（案件なし）'),
      ...cases.slice().sort((a, b) => (a.caseName || '').localeCompare(b.caseName || '', 'ja'))
        .map((c) => el('option', { value: c.id, selected: c.id === todo.caseId }, c.caseName || '(無題)'))
    ]);
    const notes = el('textarea', { rows: 3 }, todo.notes || '');
    const done = el('input', { type: 'checkbox', checked: !!todo.done });
    const body = el('form', { class: 'quick-form', onSubmit: (e) => e.preventDefault() }, [
      el('label', {}, ['内容', title]),
      el('label', {}, ['期限', dl.nodes]),
      el('label', {}, ['関連案件', caseSel]),
      el('label', {}, ['メモ', notes]),
      el('label', {}, [done, '完了'])
    ]);
    openDialog({
      title: 'ToDoの編集',
      bodyNode: body,
      onClose: () => resolve(false),
      actions: [
        {
          label: '削除', danger: true,
          onClick: async () => {
            if (!(await ctx.confirm(`ToDo「${todo.title || ''}」を削除しますか？`))) return 'keep-open';
            try {
              await ctx.store.remove('todos', todo);
              ctx.toast('削除しました', 'success');
              resolve(true);
            } catch (e) {
              ctx.toast('削除できませんでした: ' + e.message, 'error');
              return 'keep-open';
            }
          }
        },
        { label: 'キャンセル', onClick: () => resolve(false) },
        {
          label: '保存', primary: true,
          onClick: async () => {
            if (!title.value.trim()) { ctx.toast('内容を入力してください', 'error'); return 'keep-open'; }
            const payload = {
              ...todo, title: title.value.trim(), deadline: dl.get(), caseId: caseSel.value, notes: notes.value,
              done: done.checked, doneAt: done.checked ? (todo.doneAt || new Date().toISOString()) : ''
            };
            const saved = await saveRecord(ctx, 'todos', todo, payload);
            if (!saved) return 'keep-open';
            resolve(true);
          }
        }
      ]
    });
  });
}
