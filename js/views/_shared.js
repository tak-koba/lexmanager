// LexManager 4 - views 共通の小さなヘルパー群（views/ 配下でのみ使用）。
// 新規の独立ファイルは増やさない方針だが、9つのビュー間で重複しがちな
// UI片（バッジ・コピー・クイック登録ダイアログ・AI確認フロー）はここに集約する。

import { el, clear } from '../ui/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { deadlineBadge, displayName, kanaName, sortByKana, opponentName, defaultClient, defaultCase, defaultTodo, newId, PHONE_TYPES, todoCaseText, todoRequesterText } from '../model.js';
import { formatDate, formatDateTime, todayIso } from '../ui/dates.js';
import { lookupZip, googleMapsUrl, addressSearchUrl } from '../util/zip.js';
import { setupKanaAssist } from '../util/kana.js';
import { ConflictError } from '../api.js';

export { deadlineBadge, displayName, kanaName, sortByKana, opponentName, defaultClient, defaultCase, defaultTodo, newId, PHONE_TYPES, todoCaseText, todoRequesterText, formatDate, formatDateTime, todayIso };

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

// 編集ボタン（ペンのアイコン）。文字の「編集」の代わりに全画面で使う。title・aria-label で「編集」と読み上げる
const PEN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

export function editIconButton(onClick, { label = '編集', primary = false, disabled = false } = {}) {
  return el('button', { type: 'button', class: ['btn', 'btn-pen', primary ? 'btn-primary' : ''], title: label, 'aria-label': label, disabled, onClick },
    el('span', { class: 'icon', html: PEN_SVG }));
}

/** セクション見出し + 編集ボタン（ペン）の共通レイアウト。 */
export function sectionHeader(title, onEdit) {
  const header = el('div', { class: 'section-header' }, [
    el('h3', {}, title)
  ]);
  if (onEdit) {
    header.appendChild(editIconButton(onEdit));
  }
  return header;
}

/** 顧客の「個人/法人」チップ。顧問契約ありは黄色（chip-retainer）。 */
export function clientTypeChip(c) {
  const retainer = c && c.retainerContract === 'yes';
  return el('span', { class: ['chip', retainer ? 'chip-retainer' : ''], title: retainer ? '顧問契約あり' : null },
    c && c.type === 'corporate' ? '法人' : '個人');
}

/**
 * 詳細画面の一括編集バー。閲覧中は［編集］、編集中は［キャンセル］［保存］。
 * lead（戻るボタン等）は閲覧中だけ左端に置く（狭い画面で1行にまとめるため）。
 */
export function editBar(editMode, { onEdit, onCancel, onSave }, lead) {
  if (!editMode) {
    return el('div', { class: 'edit-bar' }, [
      lead || null,
      editIconButton(onEdit, { primary: true })
    ]);
  }
  return el('div', { class: 'edit-bar editing' }, [
    el('span', { class: 'edit-bar-label' }, '編集中'),
    el('button', { type: 'button', class: 'btn', onClick: onCancel }, 'キャンセル'),
    el('button', { type: 'button', class: 'btn btn-primary', onClick: onSave }, '保存')
  ]);
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
        fieldsBox.appendChild(el('div', { class: 'field-row' }, [
          el('label', {}, ['代表者役職', el('input', { type: 'text', name: 'repTitle', class: 'field', value: '代表取締役' })]),
          el('label', {}, ['代表者', el('input', { type: 'text', name: 'representative', class: 'field' })])
        ]));
        // 代表者1名で担当者も同じ場合は、担当者の電話・メールを別入力しない（会社の連絡先を共用）。
        const repIsContact = el('input', { type: 'checkbox', name: 'repIsContact', checked: true });
        fieldsBox.appendChild(el('label', { class: 'field-row' }, [repIsContact, '代表者が担当者を兼ねる']));
        const cpBox = el('div', { class: 'field-stack' }, [
          el('div', { class: 'field-row' }, [
            el('label', {}, ['担当者氏名', el('input', { type: 'text', name: 'cpName', class: 'field' })]),
            el('label', {}, ['担当者役職', el('input', { type: 'text', name: 'cpTitle', class: 'field' })])
          ]),
          el('div', { class: 'field-row' }, [
            el('label', {}, ['担当者電話', el('input', { type: 'tel', name: 'cpTel', class: 'field' })]),
            el('label', {}, ['担当者メール', el('input', { type: 'email', name: 'cpEmail', class: 'field' })])
          ])
        ]);
        const syncCp = () => { cpBox.hidden = repIsContact.checked; };
        repIsContact.addEventListener('change', syncCp);
        syncCp();
        fieldsBox.appendChild(el('label', {}, ['電話番号', el('input', { type: 'tel', name: 'phone', class: 'field' })]));
        fieldsBox.appendChild(el('label', {}, ['メール', el('input', { type: 'email', name: 'email', class: 'field' })]));
        fieldsBox.appendChild(cpBox);
        return;
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
              rec.repTitle = data.get('repTitle') || '';
              rec.representative = data.get('representative') || '';
              rec.email = data.get('email') || '';
              rec.repIsContact = data.get('repIsContact') === 'on';
              if (!rec.repIsContact) {
                const cp = {
                  name: data.get('cpName') || '', title: data.get('cpTitle') || '', dept: '',
                  tel: data.get('cpTel') || '', email: data.get('cpEmail') || '', homeAddr: ''
                };
                if (cp.name || cp.tel || cp.email) rec.contactPersons = [cp];
              }
            }
            const phone = data.get('phone') || '';
            if (phone) rec.phones = [{ type: type === 'corporate' ? '会社' : '携帯電話', number: phone }];
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
    const dl = dateTimeInputs('');
    const caseSelect = el('select', { name: 'caseId', class: 'field' }, [
      el('option', { value: '' }, '（個別ToDo）'),
      ...sortByKana((cases || []).slice(), (c) => c.caseName).map((c) => el('option', { value: c.id, selected: c.id === presetCaseId }, c.caseName))
    ]);
    const requesterInput = el('input', { type: 'text', name: 'requester', class: 'field' });
    const calendarInput = el('input', { type: 'checkbox', name: 'calendar' });
    form.appendChild(el('label', {}, ['内容', titleInput]));
    form.appendChild(el('label', {}, ['期限', dl.nodes]));
    form.appendChild(el('label', {}, ['案件', caseSelect]));
    form.appendChild(el('label', {}, ['依頼者', requesterInput]));
    form.appendChild(el('label', { class: 'field-row' }, [calendarInput, '📅 Googleカレンダーに登録（期限が必要）']));

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
            rec.deadline = dl.get();
            rec.caseId = caseSelect.value || '';
            rec.requester = requesterInput.value.trim();
            rec.calendar = calendarInput.checked;
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
  companyNameKana: '会社名よみ', representative: '代表者', repTitle: '代表者役職', repIsContact: '代表者が担当者を兼任', extraEmails: '追加メール', birthday: '生年月日',
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

/** 案件名（テキスト）に完全一致する案件。紐付け候補の提示用。 */
export function suggestCase(label, cases) {
  const s = (label || '').trim();
  return s ? (cases || []).find((c) => (c.caseName || '').trim() === s) || null : null;
}

/** 依頼者（テキスト）に一致する顧客（空白を無視して氏名・会社名で完全一致）。紐付け候補の提示用。 */
export function suggestClient(text, clients) {
  const s = (text || '').replace(/\s/g, '');
  return s ? (clients || []).find((c) => displayName(c).replace(/\s/g, '') === s) || null : null;
}

/** 元メール情報の1行表示（メール由来のToDoのみ）。 */
export function todoMailLine(todo) {
  const m = todo && todo.mail;
  if (!m || !(m.subject || m.from)) return null;
  const received = m.received ? formatDate(String(m.received).slice(0, 10)) : '';
  return el('div', { class: 'todo-mail text-muted' }, `✉ ${[m.subject, m.from, received].filter(Boolean).join(' ／ ')}`);
}

// ---------------- ToDo（案件単位の表示・一括編集） ----------------
// ToDo一覧（案件ごとのまとまり）と案件詳細のToDo欄で共用する。閲覧中は完了チェックだけ即時保存し、
// それ以外は［編集］→［保存］でまとめて保存する（DESIGN.md §6）。

const TODO_EDIT_KEYS = ['title', 'deadline', 'done', 'requester', 'clientId', 'caseLabel', 'caseId', 'notes', 'calendar'];

/** 閲覧用のToDo1行。完了チェックは即時保存し onChanged(saved) を呼ぶ。 */
export function todoViewRow(ctx, t, { caseById, clientById, showCase = false, onChanged, onEdit, editDisabled = false } = {}) {
  const cb = el('input', { type: 'checkbox', checked: !!t.done, 'aria-label': '完了', onChange: async () => {
    try {
      const res = await ctx.store.update('todos', { ...t, done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : '' }, t);
      ctx.toast(cb.checked ? '完了にしました' : '未完了に戻しました', 'success');
      if (onChanged) onChanged(res.record);
    } catch (e) {
      cb.checked = !cb.checked;
      ctx.toast('更新に失敗しました: ' + e.message, 'error');
    }
  } });
  const requester = clientById ? todoRequesterText(t, clientById) : (t.requester || '');
  const client = t.clientId && clientById ? clientById.get(t.clientId) : null;
  const caseObj = showCase && t.caseId && caseById ? caseById.get(t.caseId) : null;
  const caseText = showCase ? (caseObj ? caseObj.caseName : t.caseLabel) : '';
  const deadline = t.deadline ? (renderDeadlineBadge(t.deadline) || el('span', { class: 'text-muted' }, formatTodoDeadline(t.deadline))) : el('span', { class: 'text-muted' }, '期限なし');
  return el('div', { class: ['todo-item', t.done ? 'todo-done' : ''] }, [
    el('div', { class: 'todo-item-check' }, cb),
    el('div', { class: 'todo-item-deadline' }, deadline),
    el('div', { class: 'todo-item-requester' }, requester
      ? (client ? el('a', { href: `#/clients/${client.id}` }, requester) : el('span', {}, requester))
      : el('span', { class: 'text-muted todo-empty' }, '依頼者なし')),
    el('div', { class: 'todo-item-body' }, [
      el('div', { class: 'todo-item-title' }, [t.calendar ? el('span', { class: 'todo-cal', title: 'Googleカレンダーに登録' }, '📅 ') : null, t.title || '(無題)']),
      caseText ? el('div', { class: 'todo-sub text-muted' }, caseObj ? el('a', { href: `#/cases/${caseObj.id}` }, `案件: ${caseText}`) : `案件: ${caseText}`) : null,
      todoMailLine(t),
      t.notes ? el('div', { class: 'todo-sub text-muted todo-notes' }, `📝 ${t.notes}`) : null
    ]),
    onEdit ? el('div', { class: 'todo-item-act' }, editIconButton(onEdit, { label: 'このToDoを編集', disabled: editDisabled })) : null
  ]);
}

function formatTodoDeadline(v) {
  return v.length > 10 && !v.endsWith('T00:00') ? `${formatDate(v.slice(0, 10))} ${v.slice(11, 16)}` : formatDate(v.slice(0, 10));
}

/**
 * ToDoのまとめて編集。todos を入力欄で並べ、追加・削除もできる。collect() で保存内容
 * {creates, updates:[{base,payload}], removes:[base], errors:[]} を返す（まだ保存しない）。
 * fixedCaseId を渡すと案件欄を出さない（案件詳細の中で使う場合）。newDefaults は追加行の初期値。
 */
export function todoGroupEditor({ todos, cases, clients, fixedCaseId = null, newDefaults = {}, allowAdd = true }) {
  const form = el('form', { class: 'todo-editor', onSubmit: (e) => e.preventDefault() });
  const listBox = el('div', { class: 'todo-editor-list' });
  const rows = (todos || []).map((t) => ({ base: t, draft: { ...t }, removed: false }));
  const sortedCases = sortByKana((cases || []).slice(), (c) => c.caseName);
  const sortedClients = sortByKana((clients || []).slice(), kanaName);

  function renderRows() {
    clear(listBox);
    rows.forEach((r) => listBox.appendChild(renderRow(r)));
    if (!rows.length) listBox.appendChild(el('p', { class: 'text-muted' }, 'ToDoはありません。［＋ToDoを追加］で追加できます。'));
  }

  function renderRow(r) {
    const d = r.draft;
    const bind = (node, key, read = (n) => n.value) => {
      node.addEventListener('input', () => { d[key] = read(node); });
      node.addEventListener('change', () => { d[key] = read(node); });
      return node;
    };
    const done = bind(el('input', { type: 'checkbox', checked: !!d.done, 'aria-label': '完了' }), 'done', (n) => n.checked);
    const calendar = bind(el('input', { type: 'checkbox', checked: !!d.calendar, 'aria-label': 'カレンダー登録' }), 'calendar', (n) => n.checked);
    const title = bind(el('input', { type: 'text', class: 'field', value: d.title || '', placeholder: '依頼内容・要対応事項' }), 'title');
    const v = d.deadline || '';
    const date = el('input', { type: 'date', class: 'field', value: v.slice(0, 10), 'aria-label': '期限' });
    const time = el('input', { type: 'time', class: 'field', step: 300, value: v.length > 10 && !v.endsWith('T00:00') ? v.slice(11, 16) : '', 'aria-label': '時刻（任意）' });
    const syncDeadline = () => { d.deadline = date.value ? (time.value ? `${date.value}T${time.value}` : date.value) : ''; };
    for (const n of [date, time]) { n.addEventListener('input', syncDeadline); n.addEventListener('change', syncDeadline); }
    const requester = bind(el('input', { type: 'text', class: 'field', value: d.requester || '', placeholder: '依頼者' }), 'requester');
    const clientSel = bind(el('select', { class: 'field', 'aria-label': '依頼者の顧客' }, [
      el('option', { value: '' }, '顧客と紐付けない'),
      ...sortedClients.map((c) => el('option', { value: c.id, selected: c.id === d.clientId }, displayName(c) || '(名称未設定)'))
    ]), 'clientId');
    // メモは書いた行数に合わせて広がる（最低4行。行数で決めるので画面の状態に左右されない）
    const memoRows = (v) => Math.min(20, Math.max(4, String(v || '').split('\n').length + 1));
    const notes = bind(el('textarea', { class: 'field todo-ed-memo', rows: memoRows(d.notes), placeholder: 'メモ' }, d.notes || ''), 'notes');
    notes.addEventListener('input', () => { notes.rows = memoRows(notes.value); });

    const fields = [
      el('label', { class: 'todo-ed-title' }, ['内容', title]),
      el('div', { class: 'todo-ed-deadline' }, [el('span', { class: 'todo-ed-label' }, '期限'), el('div', { class: 'todo-deadline-inputs' }, [date, time])]),
      el('label', { class: 'todo-ed-requester' }, ['依頼者', requester]),
      el('label', { class: 'todo-ed-client' }, ['依頼者の顧客', clientSel]),
      linkHint(requester, clientSel, (s) => suggestClient(s, clients), (c) => displayName(c))
    ];
    if (!fixedCaseId) {
      const caseLabel = bind(el('input', { type: 'text', class: 'field', value: d.caseLabel || '', placeholder: '案件名（テキスト）' }), 'caseLabel');
      const caseSel = bind(el('select', { class: 'field', 'aria-label': '関連案件' }, [
        el('option', { value: '' }, '案件と紐付けない'),
        ...sortedCases.map((c) => el('option', { value: c.id, selected: c.id === d.caseId }, c.caseName || '(無題)'))
      ]), 'caseId');
      fields.push(
        el('label', { class: 'todo-ed-caselabel' }, ['案件名', caseLabel]),
        el('label', { class: 'todo-ed-case' }, ['関連案件', caseSel]),
        linkHint(caseLabel, caseSel, (s) => suggestCase(s, cases), (c) => c.caseName)
      );
    }
    fields.push(el('label', { class: 'todo-ed-notes' }, ['メモ', notes]), todoMailLine(r.base || {}));

    const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => {
      if (!r.base) { rows.splice(rows.indexOf(r), 1); renderRows(); return; }
      r.removed = !r.removed;
      renderRows();
    } }, r.removed ? '元に戻す' : '削除');

    return el('div', { class: ['todo-ed-row', r.removed ? 'todo-ed-removed' : '', r.base ? '' : 'todo-ed-new'] }, [
      el('div', { class: 'todo-ed-head' }, [
        el('label', { class: 'todo-ed-done' }, [done, '完了']),
        el('label', { class: 'todo-ed-done', title: '期限のあるToDoを、Googleカレンダーに予定として登録します（PCで同期したときに反映）' }, [calendar, '📅 カレンダー登録']),
        r.base ? null : el('span', { class: 'chip' }, '新規'),
        r.removed ? el('span', { class: 'chip' }, '保存すると削除') : null,
        delBtn
      ]),
      el('fieldset', { class: 'todo-ed-fields', disabled: r.removed }, fields)
    ]);
  }

  // テキストに一致する案件・顧客があり未紐付けなら、ワンクリックで紐付けるボタンを出す
  function linkHint(input, sel, find, label) {
    const box = el('div', { class: 'todo-ed-hint' });
    const update = () => {
      clear(box);
      const hit = !sel.value && find(input.value);
      if (hit) box.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => {
        sel.value = hit.id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        update();
      } }, `🔗「${label(hit)}」に紐付け`));
    };
    input.addEventListener('input', update);
    sel.addEventListener('change', update);
    update();
    return box;
  }

  const addBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => {
    rows.push({ base: null, draft: { ...defaultTodo(), ...newDefaults, ...(fixedCaseId ? { caseId: fixedCaseId } : {}) }, removed: false });
    renderRows();
    const inputs = listBox.querySelectorAll('.todo-ed-new .todo-ed-title input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  } }, '＋ToDoを追加');

  renderRows();
  form.appendChild(listBox);
  if (allowAdd) form.appendChild(addBtn);

  function collect() {
    const plan = { creates: [], updates: [], removes: [], errors: [] };
    for (const r of rows) {
      const d = { ...r.draft, title: (r.draft.title || '').trim(), requester: (r.draft.requester || '').trim(), caseLabel: (r.draft.caseLabel || '').trim() };
      if (!r.base) {
        if (d.title) plan.creates.push({ ...d, doneAt: d.done ? new Date().toISOString() : '' });
        continue;
      }
      if (r.removed) { plan.removes.push(r.base); continue; }
      if (!d.title) { plan.errors.push('内容が空のToDoがあります'); continue; }
      const changed = TODO_EDIT_KEYS.some((k) => (d[k] ?? '') !== (r.base[k] ?? ''));
      if (!changed) continue;
      if (!!d.done !== !!r.base.done) d.doneAt = d.done ? new Date().toISOString() : '';
      plan.updates.push({ base: r.base, payload: d });
    }
    return plan;
  }

  return { node: form, collect };
}

/** todoGroupEditor の collect() 結果を保存する。保存できた件数と失敗件数を返す（トーストは呼び出し側）。 */
export async function commitTodoPlan(ctx, plan) {
  let ok = 0;
  let failed = 0;
  for (const rec of plan.creates) {
    try { await ctx.store.create('todos', rec); ok++; } catch (e) { failed++; }
  }
  for (const { base, payload } of plan.updates) {
    try {
      await ctx.store.update('todos', payload, base);
      ok++;
    } catch (e) {
      // 他の端末と同じToDoを同時に変えていた場合は、項目ごとに選ぶ画面を出す
      if (e instanceof ConflictError && await saveRecord(ctx, 'todos', base, payload)) ok++;
      else failed++;
    }
  }
  for (const base of plan.removes) {
    try { await ctx.store.remove('todos', base); ok++; } catch (e) { failed++; }
  }
  return { ok, failed };
}

// ---------------- カレンダーを開く ----------------

/** iPhone・iPad（iPadOSはMacと名乗るため、タッチ対応で判定） */
export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * カレンダーを開く。PC: Googleカレンダー（新しいタブ）。iPhone・iPad: Googleカレンダーのアプリ
 * （入っていなければ、1.5秒後にブラウザ版を別の画面で開く。LexManager自体は残す）。
 */
export function openCalendar() {
  const web = 'https://calendar.google.com/calendar/r';
  if (!isIOS()) {
    window.open(web, '_blank', 'noopener');
    return;
  }
  const timer = setTimeout(() => { if (!document.hidden) window.open(web, '_blank', 'noopener'); }, 1500);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); }, { once: true });
  window.location.href = 'googlecalendar://';
}