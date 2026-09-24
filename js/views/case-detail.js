// LexManager 4 - 案件詳細
import { el, clear } from '../ui/dom.js';
import { guardNavigation } from '../ui/forms.js';
import { ConflictError } from '../api.js';
import { googleCalendarUrl, buildIcs, downloadIcs } from '../util/calendar.js';
import { extractTodoCandidates } from '../util/suggest.js';
import { openDialog } from '../ui/dialog.js';
import {
  displayName, opponentName, sortByKana, formatDate, formatDateTime, newId,
  renderDeadlineBadge, telLink, copyButton, sectionHeader, saveRecord, deleteRecordButton, editTodoDialog, dateTimeInputs, defaultTodo, runAiExtractFlow
} from './_shared.js';

const TRIAL_TYPES = ['', '調停', '訴訟', '強制執行', 'その他'];
const TRIAL_METHODS = ['', '出頭', 'ウェブ', '電話'];
const COURT_ROLES = ['', '破産管財人', '個人再生監督委員', '相続財産清算人', '相続財産管理人', '不在者財産管理人', 'その他'];

export async function render(container, params, ctx) {
  clear(container);
  const id = params && params.id;
  if (!id) {
    container.appendChild(el('p', { class: 'text-error' }, '案件IDが指定されていません'));
    return;
  }
  container.appendChild(el('p', { class: 'text-muted' }, '読み込み中...'));

  let all;
  try {
    all = await ctx.store.all();
  } catch (e) {
    clear(container);
    container.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
    return;
  }
  let record = (all.cases || []).find((c) => c.id === id);
  clear(container);
  if (!record) {
    container.appendChild(el('p', { class: 'text-error' }, '案件が見つかりません'));
    return;
  }
  const clients = all.clients || [];

  let dirty = false;
  const setDirty = (v) => { dirty = v; };


  const root = el('div', { class: 'detail-root' });
  container.appendChild(root);

  /** セクションの保存。常に保存済みの全体から始め、編集した項目だけを上書きする。 */
  async function saveSection(editedFields) {
    const saved = await saveRecord(ctx, 'cases', record, { ...record, ...editedFields });
    if (saved) {
      record = saved;
      setDirty(false);
      renderAll();
    }
  }

  function renderAll() {
    clear(root);
    root.appendChild(buildHeaderSection());
    if (record.caseType === 'client') root.appendChild(buildOverviewSection());
    else root.appendChild(buildRoleSection());
    root.appendChild(buildTrialSection());
    if (record.caseType === 'client') root.appendChild(buildOpponentsSection());
    root.appendChild(buildTodoSection());
    root.appendChild(buildMinutesSection());
    root.appendChild(buildNotesSection());
  }

  // ---------------- 見出し ----------------
  function buildHeaderSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('基本情報', () => { editing = true; edit(); }));
      section.appendChild(el('h2', {}, record.caseName || '(無題の案件)'));
      const names = (record.clientIds || []).map((cid) => {
        const c = clients.find((x) => x.id === cid);
        return c ? displayName(c) : '(不明)';
      });
      section.appendChild(el('p', { class: 'text-muted' }, `依頼者: ${names.join('、') || 'なし'}`));
      section.appendChild(el('div', { class: 'field-row' }, [
        el('span', { class: 'chip' }, record.caseType === 'court' ? '裁判所案件' : '顧客案件'),
        record.isArchived ? el('span', { class: 'chip' }, '終了') : null,
        renderDeadlineBadge(record.nextDate)
      ]));
      const caseTodos = (all.todos || []).filter((t) => t.caseId === record.id);
      section.appendChild(el('div', { class: 'field-row', style: 'margin-top:8px' }, [
        deleteRecordButton(ctx, 'cases', () => record, record.caseName || 'この案件', '#/cases',
          caseTodos.length ? `この案件のToDo ${caseTodos.length}件は残ります（関連案件なしのToDoになります）。` : '')
      ]));
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const nameInput = el('input', { type: 'text', class: 'field', value: record.caseName || '' });
      const clientSelect = el('select', { class: 'field', multiple: true, size: Math.min(8, Math.max(3, clients.length)) },
        sortByKana(clients.slice(), displayName).map((c) => el('option', { value: c.id, selected: (record.clientIds || []).includes(c.id) }, displayName(c)))
      );
      const archived = el('input', { type: 'checkbox', checked: !!record.isArchived });
      form.appendChild(el('label', {}, ['案件名', nameInput]));
      form.appendChild(el('label', {}, ['依頼者（複数選択可）', clientSelect]));
      form.appendChild(el('label', { class: 'field-row' }, [archived, '終了（アーカイブ）']));
      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          editing = false;
          await saveSection({
            caseName: nameInput.value,
            clientIds: Array.from(clientSelect.selectedOptions).map((o) => o.value),
            isArchived: archived.checked
          });
        } }, '保存')
      ]));
      section.appendChild(sectionHeader('基本情報（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  // ---------------- 概要（顧客案件） ----------------
  function buildOverviewSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('概要', () => { editing = true; edit(); }));
      section.appendChild(el('p', {}, `区分: ${record.caseCategory === 'dispute' ? '争訟等' : '書面作成等'}`));
      section.appendChild(el('p', {}, `委任契約: ${{ yes: '有', no: '無' }[record.commissionSigned] || '未設定'}`));
      if (record.overview) section.appendChild(el('p', {}, `概要: ${record.overview}`));
      if (record.requestContent) section.appendChild(el('p', {}, `依頼内容: ${record.requestContent}`));

      if (ctx.caps.ai) {
        section.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
          await runAiExtractFlow(ctx, { kind: 'memo-case' }, [
            { key: 'overview', label: '概要' },
            { key: 'requestContent', label: '依頼内容' }
          ], async (sel) => {
            await saveSection(sel);
          });
        } }, 'メモAI読取'));
      }
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const category = el('select', { class: 'field' }, [
        el('option', { value: 'document', selected: record.caseCategory !== 'dispute' }, '書面作成等'),
        el('option', { value: 'dispute', selected: record.caseCategory === 'dispute' }, '争訟等')
      ]);
      const commission = el('select', { class: 'field' }, [
        el('option', { value: '', selected: !record.commissionSigned }, '未設定'),
        el('option', { value: 'yes', selected: record.commissionSigned === 'yes' }, '有'),
        el('option', { value: 'no', selected: record.commissionSigned === 'no' }, '無')
      ]);
      const overview = el('textarea', { class: 'field', rows: 3 }, record.overview || '');
      const requestContent = el('textarea', { class: 'field', rows: 3 }, record.requestContent || '');
      form.appendChild(el('label', {}, ['区分', category]));
      form.appendChild(el('label', {}, ['委任契約', commission]));
      form.appendChild(el('label', {}, ['概要', overview]));
      form.appendChild(el('label', {}, ['依頼内容', requestContent]));
      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          editing = false;
          await saveSection({ caseCategory: category.value, commissionSigned: commission.value, overview: overview.value, requestContent: requestContent.value });
        } }, '保存')
      ]));
      section.appendChild(sectionHeader('概要（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  // ---------------- 役割（裁判所案件） ----------------
  function buildRoleSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('役割', () => { editing = true; edit(); }));
      section.appendChild(el('p', {}, `役割: ${record.courtRole || '未設定'}`));
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const role = el('select', { class: 'field' }, COURT_ROLES.map((r) => el('option', { value: r, selected: r === record.courtRole }, r || '未設定')));
      form.appendChild(el('label', {}, ['役割', role]));
      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => { editing = false; await saveSection({ courtRole: role.value }); } }, '保存')
      ]));
      section.appendChild(sectionHeader('役割（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  // ---------------- 期日・裁判所 ----------------
  function buildTrialSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('期日・裁判所', () => { editing = true; edit(); }));
      const court = [record.trialCourt, record.trialDept].filter(Boolean).join(' ');
      const rows = [
        ['裁判所', court],
        ['書記官', record.trialClerk],
        ['電話', record.trialTel, 'tel'],
        ['FAX', record.trialFax, 'copy'],
        ...(record.caseType === 'client' ? [['種別', record.trialType], ['期日方法', record.trialMethod]] : [])
      ];
      for (const [label, value, kind] of rows) {
        if (!value) continue;
        section.appendChild(el('div', { class: 'field-row' }, [
          el('span', { class: 'text-muted', style: 'min-width:5em' }, label),
          kind === 'tel' ? telLink(value) : el('span', {}, value),
          kind ? copyButton(ctx, value) : null
        ]));
      }
      if (!court && !record.trialClerk && !record.trialTel) section.appendChild(el('p', { class: 'text-muted' }, '裁判所の情報は未登録です'));
      if (record.caseType === 'client' && record.trialPrep) {
        section.appendChild(el('div', { class: 'section-sub' }, '次回期日までの準備事項'));
        section.appendChild(el('pre', {}, record.trialPrep));
      }
      const dateRow = el('div', { class: 'field-row' }, [
        el('span', {}, '次回期日: '),
        record.nextDate ? el('span', {}, record.nextDate.length > 10 ? formatDateTime(record.nextDate) : formatDate(record.nextDate)) : el('span', { class: 'text-muted' }, '未設定')
      ]);
      section.appendChild(dateRow);

      if (record.nextDate) {
        const btnRow = el('div', { class: 'field-row' }, [
          el('button', { type: 'button', class: 'btn btn-small', onClick: () => {
            const url = googleCalendarUrl({ title: record.caseName || '案件', dateOrDateTime: record.nextDate, details: record.overview || '' });
            window.open(url, '_blank', 'noopener');
          } }, 'Googleカレンダーに追加'),
          el('button', { type: 'button', class: 'btn btn-small', onClick: () => {
            const ics = buildIcs({ uid: `${record.id}@lexmanager`, title: record.caseName || '案件', dateOrDateTime: record.nextDate, description: record.overview || '' });
            downloadIcs(ics, `${record.caseName || 'case'}.ics`);
          } }, 'ICSダウンロード')
        ]);
        section.appendChild(btnRow);
      }
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const trialCourt = el('input', { type: 'text', class: 'field', value: record.trialCourt || '' });
      const trialDept = el('input', { type: 'text', class: 'field', value: record.trialDept || '' });
      const trialClerk = el('input', { type: 'text', class: 'field', value: record.trialClerk || '' });
      const trialTel = el('input', { type: 'tel', class: 'field', value: record.trialTel || '' });
      const trialFax = el('input', { type: 'tel', class: 'field', value: record.trialFax || '' });

      const hasTime = /T\d{2}:\d{2}/.test(record.nextDate || '');
      const dateInput = el('input', { type: 'date', class: 'field', value: (record.nextDate || '').slice(0, 10) });
      const timeInput = el('input', { type: 'time', class: 'field', value: hasTime ? record.nextDate.slice(11, 16) : '' });

      form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['裁判所', trialCourt]), el('label', {}, ['部', trialDept])]));
      form.appendChild(el('label', {}, ['書記官', trialClerk]));
      form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['電話', trialTel]), el('label', {}, ['FAX', trialFax])]));

      let trialType, trialMethod, trialPrep;
      if (record.caseType === 'client') {
        trialType = el('select', { class: 'field' }, TRIAL_TYPES.map((t) => el('option', { value: t, selected: t === record.trialType }, t || '未設定')));
        trialMethod = el('select', { class: 'field' }, TRIAL_METHODS.map((t) => el('option', { value: t, selected: t === record.trialMethod }, t || '未設定')));
        trialPrep = el('textarea', { class: 'field', rows: 2 }, record.trialPrep || '');
        form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['種別', trialType]), el('label', {}, ['方法', trialMethod])]));
        form.appendChild(el('label', {}, ['準備事項', trialPrep]));
      }

      form.appendChild(el('div', { class: 'field-row' }, [
        el('label', {}, ['次回期日', dateInput]),
        el('label', {}, ['時刻（任意）', timeInput])
      ]));
      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          editing = false;
          let nextDate = dateInput.value || '';
          if (nextDate && timeInput.value) nextDate = `${nextDate}T${timeInput.value}`;
          const edited = { trialCourt: trialCourt.value, trialDept: trialDept.value, trialClerk: trialClerk.value, trialTel: trialTel.value, trialFax: trialFax.value, nextDate };
          if (record.caseType === 'client') {
            edited.trialType = trialType.value;
            edited.trialMethod = trialMethod.value;
            edited.trialPrep = trialPrep.value;
          }
          await saveSection(edited);
        } }, '保存')
      ]));
      section.appendChild(sectionHeader('期日・裁判所（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  // ---------------- 相手方 ----------------
  function buildOpponentsSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('相手方', () => { editing = true; edit(); }));
      const list = el('div', { class: 'field-stack' });
      for (const o of record.opponents || []) {
        const box = el('div', { class: 'section-sub' });
        box.appendChild(el('div', {}, [
          el('strong', {}, opponentName(o) || '(未設定)'),
          el('span', { class: 'chip' }, o.type === 'corporate' ? '法人' : '個人')
        ]));
        if (o.tel) box.appendChild(el('div', {}, `電話: ${o.tel}`));
        if (o.email) box.appendChild(el('div', {}, `メール: ${o.email}`));
        if (o.addr) box.appendChild(el('div', {}, `住所: ${o.zip ? '〒' + o.zip + ' ' : ''}${o.addr}`));
        if (o.lawyerName) box.appendChild(el('div', {}, `代理人: ${o.lawyerName}（${o.lawyerOffice || ''}）TEL:${o.lawyerTel || ''} FAX:${o.lawyerFax || ''}`));
        list.appendChild(box);
      }
      section.appendChild(list);
      if (!(record.opponents || []).length) section.appendChild(el('p', { class: 'text-muted' }, '相手方は登録されていません'));
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const opponents = (record.opponents || []).map((o) => ({ ...o }));
      const box = el('div', { class: 'field-stack' });

      function renderOne(o, i) {
        const wrap = el('div', { class: 'section-sub' });
        const typeSel = el('select', { class: 'field' }, [
          el('option', { value: 'individual', selected: o.type !== 'corporate' }, '個人'),
          el('option', { value: 'corporate', selected: o.type === 'corporate' }, '法人')
        ]);
        typeSel.addEventListener('change', () => { o.type = typeSel.value; renderBox(); });
        wrap.appendChild(typeSel);

        if (o.type === 'corporate') {
          const corpName = el('input', { type: 'text', class: 'field', value: o.corpName || '', placeholder: '法人名' });
          corpName.addEventListener('input', () => { o.corpName = corpName.value; });
          const corpRep = el('input', { type: 'text', class: 'field', value: o.corpRep || '', placeholder: '代表者' });
          corpRep.addEventListener('input', () => { o.corpRep = corpRep.value; });
          const contactName = el('input', { type: 'text', class: 'field', value: o.contactName || '', placeholder: '担当者' });
          contactName.addEventListener('input', () => { o.contactName = contactName.value; });
          wrap.appendChild(el('div', { class: 'field-row' }, [corpName, corpRep, contactName]));
        } else {
          const lastName = el('input', { type: 'text', class: 'field', value: o.lastName || '', placeholder: '姓' });
          lastName.addEventListener('input', () => { o.lastName = lastName.value; });
          const firstName = el('input', { type: 'text', class: 'field', value: o.firstName || '', placeholder: '名' });
          firstName.addEventListener('input', () => { o.firstName = firstName.value; });
          const lastNameKana = el('input', { type: 'text', class: 'field', value: o.lastNameKana || '', placeholder: 'せい' });
          lastNameKana.addEventListener('input', () => { o.lastNameKana = lastNameKana.value; });
          const firstNameKana = el('input', { type: 'text', class: 'field', value: o.firstNameKana || '', placeholder: 'めい' });
          firstNameKana.addEventListener('input', () => { o.firstNameKana = firstNameKana.value; });
          wrap.appendChild(el('div', { class: 'field-row' }, [lastName, firstName, lastNameKana, firstNameKana]));
        }

        const tel = el('input', { type: 'tel', class: 'field', value: o.tel || '', placeholder: '電話' });
        tel.addEventListener('input', () => { o.tel = tel.value; });
        const email = el('input', { type: 'email', class: 'field', value: o.email || '', placeholder: 'メール' });
        email.addEventListener('input', () => { o.email = email.value; });
        const zip = el('input', { type: 'text', class: 'field', value: o.zip || '', placeholder: '郵便番号' });
        zip.addEventListener('input', () => { o.zip = zip.value; });
        const addr = el('input', { type: 'text', class: 'field', value: o.addr || '', placeholder: '住所' });
        addr.addEventListener('input', () => { o.addr = addr.value; });
        wrap.appendChild(el('div', { class: 'field-row' }, [tel, email]));
        wrap.appendChild(el('div', { class: 'field-row' }, [zip, addr]));

        const lawyerName = el('input', { type: 'text', class: 'field', value: o.lawyerName || '', placeholder: '代理人氏名' });
        lawyerName.addEventListener('input', () => { o.lawyerName = lawyerName.value; });
        const lawyerOffice = el('input', { type: 'text', class: 'field', value: o.lawyerOffice || '', placeholder: '事務所' });
        lawyerOffice.addEventListener('input', () => { o.lawyerOffice = lawyerOffice.value; });
        const lawyerTel = el('input', { type: 'tel', class: 'field', value: o.lawyerTel || '', placeholder: '代理人電話' });
        lawyerTel.addEventListener('input', () => { o.lawyerTel = lawyerTel.value; });
        const lawyerFax = el('input', { type: 'tel', class: 'field', value: o.lawyerFax || '', placeholder: '代理人FAX' });
        lawyerFax.addEventListener('input', () => { o.lawyerFax = lawyerFax.value; });
        const lawyerEmail = el('input', { type: 'email', class: 'field', value: o.lawyerEmail || '', placeholder: '代理人メール' });
        lawyerEmail.addEventListener('input', () => { o.lawyerEmail = lawyerEmail.value; });
        wrap.appendChild(el('div', { class: 'field-row' }, [lawyerName, lawyerOffice]));
        wrap.appendChild(el('div', { class: 'field-row' }, [lawyerTel, lawyerFax, lawyerEmail]));

        const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { opponents.splice(i, 1); renderBox(); } }, 'この相手方を削除');
        wrap.appendChild(delBtn);
        return wrap;
      }

      function renderBox() {
        clear(box);
        opponents.forEach((o, i) => box.appendChild(renderOne(o, i)));
      }
      renderBox();
      form.appendChild(box);
      form.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => {
        opponents.push({ id: newId('op'), type: 'individual' });
        renderBox();
      } }, '＋相手方追加'));

      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => { editing = false; await saveSection({ opponents }); } }, '保存')
      ]));
      section.appendChild(sectionHeader('相手方（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  // ---------------- ToDo ----------------
  function buildTodoSection() {
    const section = el('section', { class: 'section' });
    section.appendChild(sectionHeader('ToDo'));
    const todos = (all.todos || []).filter((t) => t.caseId === record.id);
    const list = el('ul', { class: 'list' });
    for (const t of todos) {
      const cb = el('input', { type: 'checkbox', checked: !!t.done, onChange: async () => {
        try {
          const fresh = await ctx.store.all();
          const cur = (fresh.todos || []).find((x) => x.id === t.id) || t;
          await ctx.store.update('todos', { ...cur, done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : '' }, cur);
          ctx.toast('更新しました', 'success');
          render(container, params, ctx);
        } catch (e) {
          ctx.toast('更新に失敗しました: ' + e.message, 'error');
        }
      } });
      list.appendChild(el('li', { class: 'list-row' }, [cb, renderDeadlineBadge(t.deadline),
        el('button', { type: 'button', class: 'list-row-name linklike', onClick: async () => {
          if (await editTodoDialog(ctx, t, all.cases || [])) render(container, params, ctx);
        } }, t.title || '(無題)')]));
    }
    section.appendChild(list);
    if (!todos.length) section.appendChild(el('p', { class: 'text-muted' }, 'ToDoはありません'));

    const titleInput = el('input', { type: 'text', class: 'field', placeholder: '新しいToDo' });
    const dl = dateTimeInputs('');
    const deadlineInput = { get value() { return dl.get(); } };
    const addBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
      if (!titleInput.value) { ctx.toast('内容を入力してください', 'error'); return; }
      try {
        await ctx.store.create('todos', { ...defaultTodo(), title: titleInput.value, deadline: deadlineInput.value, caseId: record.id });
        ctx.toast('ToDoを追加しました', 'success');
        render(container, params, ctx);
      } catch (e) {
        ctx.toast('追加に失敗しました: ' + e.message, 'error');
      }
    } }, '追加');
    section.appendChild(el('div', { class: 'field-stack' }, [titleInput, el('div', { class: 'field-row' }, [dl.nodes, addBtn])]));
    return section;
  }

  // ---------------- 議事録 ----------------
  function buildMinutesSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('議事録', () => { editing = true; edit(); }));
      const minutes = (record.minutes || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!minutes.length) section.appendChild(el('p', { class: 'text-muted' }, '議事録はありません'));
      for (const m of minutes) {
        const box = el('div', { class: 'section-sub' });
        box.appendChild(el('div', {}, `${formatDate(m.date)} ${m.time || ''} ${m.place || ''}`));
        if (m.attendees) box.appendChild(el('div', { class: 'text-muted' }, `出席: ${m.attendees}`));
        box.appendChild(el('p', {}, m.content || ''));
        box.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => extractCandidates(m) }, 'ToDo候補抽出'));
        section.appendChild(box);
      }
    }

    function extractCandidates(minute) {
      const candidates = extractTodoCandidates(minute.content || '');
      if (!candidates.length) {
        ctx.toast('ToDo候補は見つかりませんでした', 'info');
        return;
      }
      const form = el('form', { class: 'quick-form' });
      const rows = candidates.map((c) => {
        const cb = el('input', { type: 'checkbox', checked: true });
        const titleI = el('input', { type: 'text', class: 'field', value: c.title || '' });
        const deadlineI = el('input', { type: 'date', class: 'field', value: '' });
        if (c.deadlineHint) deadlineI.placeholder = c.deadlineHint;
        form.appendChild(el('div', { class: 'field-row' }, [cb, titleI, deadlineI]));
        return { cb, titleI, deadlineI };
      });
      openDialog({
        title: 'ToDo候補抽出',
        bodyNode: form,
        actions: [
          { label: 'キャンセル', onClick: () => {} },
          {
            label: '登録',
            primary: true,
            onClick: async () => {
              let created = 0;
              for (const r of rows) {
                if (!r.cb.checked || !r.titleI.value) continue;
                await ctx.store.create('todos', { ...defaultTodo(), title: r.titleI.value, deadline: r.deadlineI.value, caseId: record.id });
                created++;
              }
              if (created) ctx.toast(`${created}件のToDoを登録しました`, 'success');
              render(container, params, ctx);
            }
          }
        ]
      });
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const minutes = (record.minutes || []).map((m) => ({ ...m }));
      const box = el('div', { class: 'field-stack' });
      function renderBox() {
        clear(box);
        minutes.forEach((m, i) => {
          const dateI = el('input', { type: 'date', class: 'field', value: m.date || '' });
          dateI.addEventListener('input', () => { m.date = dateI.value; });
          const timeI = el('input', { type: 'time', class: 'field', value: m.time || '' });
          timeI.addEventListener('input', () => { m.time = timeI.value; });
          const placeI = el('input', { type: 'text', class: 'field', value: m.place || '', placeholder: '場所' });
          placeI.addEventListener('input', () => { m.place = placeI.value; });
          const attendeesI = el('input', { type: 'text', class: 'field', value: m.attendees || '', placeholder: '出席者' });
          attendeesI.addEventListener('input', () => { m.attendees = attendeesI.value; });
          const contentI = el('textarea', { class: 'field', rows: 3, placeholder: '内容' }, m.content || '');
          contentI.addEventListener('input', () => { m.content = contentI.value; });
          const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { minutes.splice(i, 1); renderBox(); } }, '削除');
          box.appendChild(el('div', { class: 'section-sub' }, [
            el('div', { class: 'field-row' }, [dateI, timeI, placeI]),
            attendeesI, contentI, delBtn
          ]));
        });
      }
      renderBox();
      form.appendChild(box);
      form.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => {
        minutes.push({ id: newId('min'), date: '', time: '', place: '', attendees: '', content: '' });
        renderBox();
      } }, '＋議事録追加'));
      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => { editing = false; await saveSection({ minutes }); } }, '保存')
      ]));
      section.appendChild(sectionHeader('議事録（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  // ---------------- 備考 ----------------
  function buildNotesSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('備考', () => { editing = true; edit(); }));
      section.appendChild(el('p', {}, record.notes || ''));
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const notes = el('textarea', { class: 'field', rows: 4 }, record.notes || '');
      form.appendChild(el('label', {}, ['備考', notes]));
      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => { editing = false; await saveSection({ notes: notes.value }); } }, '保存')
      ]));
      section.appendChild(sectionHeader('備考（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  renderAll();
}
