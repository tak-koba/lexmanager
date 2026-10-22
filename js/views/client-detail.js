// LexManager 4 - 顧客詳細（閲覧が既定、セクション単位で編集）
import { el, clear } from '../ui/dom.js';
import { guardNavigation } from '../ui/forms.js';
import { ConflictError } from '../api.js';
import { toWareki, calcAge } from '../util/gengo.js';
import {
  displayName, kanaName, sortByKana, PHONE_TYPES, formatDate,
  telLink, mailLink, copyButton, addressDisplayRow, zipLookupButton, addressSearchButton,
  kanaAssistPair, sectionHeader, saveRecord, deleteRecordButton, quickCreateCaseDialog, runAiExtractFlow,
  clientTypeChip, editBar, takeNewDraft
} from './_shared.js';
import { defaultClient } from '../model.js';
import { todayIso } from '../ui/dates.js';
import { confirmDialog } from '../ui/dialog.js';

export async function render(container, params, ctx) {
  clear(container);
  const id = params && params.id;
  if (!id) {
    container.appendChild(el('p', { class: 'text-error' }, '表示する顧客が指定されていません（一覧から選び直してください）'));
    return;
  }

  container.appendChild(el('p', { class: 'text-muted' }, '読み込み中…'));

  let all;
  try {
    all = await ctx.store.all();
  } catch (e) {
    clear(container);
    container.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
    return;
  }
  // 新規（#/clients/new）: クイック登録の「すべての項目を入力…」から。保存するまで登録しない
  const isNew = id === 'new';
  let record = isNew ? (takeNewDraft('clients') || { ...defaultClient('individual'), registeredAt: todayIso() })
    : (all.clients || []).find((c) => c.id === id);
  clear(container);
  if (!record) {
    container.appendChild(el('p', { class: 'text-error' }, '顧客が見つかりません'));
    return;
  }

  let dirty = false;
  const setDirty = (v) => { dirty = v; };
  const guardBeforeNav = async () => guardNavigation(() => dirty);


  const root = el('div', { class: 'detail-root' });
  // 入力欄でEnterを押してもフォーム送信（ページ再読込）にしない。
  root.addEventListener('submit', (e) => e.preventDefault());
  container.appendChild(root);

  async function reload() {
    const fresh = await ctx.store.all();
    const found = (fresh.clients || []).find((c) => c.id === id);
    if (found) record = found;
    renderAll();
  }

  /** セクションの保存共通処理。常にフルレコードのコピーから始め、editedFields のみ上書きする。 */
  /** セクションの保存。常に保存済みの全体から始め、編集した項目だけを上書きする。 */
  async function saveSection(editedFields) {
    const saved = await saveRecord(ctx, 'clients', record, { ...record, ...editedFields });
    if (saved) {
      record = saved;
      setDirty(false);
      renderAll();
    }
  }

  // 一括編集: 編集中は全セクションが入力欄になり、上部バーの［保存］でまとめて1回保存する。
  // 関連案件・名刺/添付（即時保存の操作）は編集中は表示しない（入力途中の内容が消えるのを防ぐ）。
  let editMode = isNew;
  let collectors = [];
  // 一覧枠の戻るボタンを編集バーの左端へ移す（1行にまとめる）
  const backLink = container.parentElement && container.parentElement.querySelector(':scope > .back-link');
  ctx.unsavedGuard.set(() => editMode && dirty);

  function renderAll() {
    clear(root);
    collectors = [];
    root.appendChild(editBar(editMode, {
      onEdit: () => { editMode = true; setDirty(false); renderAll(); },
      onCancel: async () => {
        if (dirty && !(await confirmDialog(isNew ? '入力内容を破棄して、登録をやめますか？' : '編集内容を破棄しますか？', { okLabel: '破棄する', danger: true }))) return;
        setDirty(false);
        if (isNew) { editMode = false; ctx.navigate('#/clients'); return; }
        editMode = false; renderAll();
      },
      onSave: saveAll,
      ...(isNew ? { label: '新規登録（未保存）', saveLabel: '登録' } : {})
    }, backLink));
    root.appendChild(buildHeaderSection());
    root.appendChild(buildContactSection());
    root.appendChild(buildDetailSection());
    if (!editMode) {
      root.appendChild(buildCasesSection());
      root.appendChild(buildFilesSection());
    }
    root.appendChild(buildNotesSection());
    // 削除は誤操作を避けるため画面の一番下に（閲覧中のみ）
    if (!editMode) {
      const related = (all.cases || []).filter((k) => (k.clientIds || []).includes(record.id));
      root.appendChild(el('div', { class: 'danger-zone' }, [
        deleteRecordButton(ctx, 'clients', () => record, displayName(record) || 'この顧客', '#/clients',
          related.length ? `この顧客は${related.length}件の案件の依頼者に登録されています。案件側の依頼者表示は「(不明)」になります。` : '', 'この顧客を削除')
      ]));
    }
  }

  async function saveAll() {
    const edited = Object.assign({}, ...collectors.map((f) => f()));
    if (isNew) {
      try {
        const created = await ctx.store.create('clients', { ...record, ...edited });
        ctx.toast('顧客を登録しました', 'success');
        editMode = false; setDirty(false);
        ctx.navigate(`#/clients/${created.id}`);
      } catch (e) {
        ctx.toast('登録に失敗しました: ' + e.message, 'error');
      }
      return;
    }
    const saved = await saveRecord(ctx, 'clients', record, { ...record, ...edited });
    if (saved) {
      record = saved;
      editMode = false;
      setDirty(false);
      if (ctx.rerender) ctx.rerender(); else renderAll();
    }
  }

  // ---------------- 見出し ----------------
  function buildHeaderSection() {
    const section = el('section', { class: 'section' });

    function view() {
      clear(section);
      section.appendChild(sectionHeader('基本情報'));
      section.appendChild(el('h2', {}, displayName(record) || '(名称未設定)'));
      section.appendChild(el('p', { class: 'text-muted' }, kanaName(record)));
      section.appendChild(el('div', { class: 'field-row' }, [
        clientTypeChip(record),
        record.retainerContract === 'yes' ? el('span', { class: 'chip chip-retainer' }, '顧問契約') : null,
        record.isArchived ? el('span', { class: 'chip' }, '取引終了') : null,
        ...(record.tags || []).map((t) => el('span', { class: 'chip' }, t))
      ]));

    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      let fields;
      if (record.type === 'corporate') {
        const companyName = el('input', { type: 'text', class: 'field', value: record.companyName || '' });
        const companyNameKana = el('input', { type: 'text', class: 'field', value: record.companyNameKana || '' });
        kanaAssistPair(companyName, companyNameKana);
        fields = { companyName, companyNameKana };
        form.appendChild(el('label', {}, ['会社名', companyName]));
        form.appendChild(el('label', {}, ['かな', companyNameKana]));
      } else {
        const lastName = el('input', { type: 'text', class: 'field', value: record.lastName || '' });
        const firstName = el('input', { type: 'text', class: 'field', value: record.firstName || '' });
        const lastNameKana = el('input', { type: 'text', class: 'field', value: record.lastNameKana || '' });
        const firstNameKana = el('input', { type: 'text', class: 'field', value: record.firstNameKana || '' });
        kanaAssistPair(lastName, lastNameKana);
        kanaAssistPair(firstName, firstNameKana);
        fields = { lastName, firstName, lastNameKana, firstNameKana };
        form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['姓', lastName]), el('label', {}, ['名', firstName])]));
        form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['せい', lastNameKana]), el('label', {}, ['めい', firstNameKana])]));
      }
      const tagsInput = el('input', { type: 'text', class: 'field', value: (record.tags || []).join(', ') });
      form.appendChild(el('label', {}, ['タグ（カンマ区切り）', tagsInput]));
      const archived = el('input', { type: 'checkbox', checked: !!record.isArchived });
      form.appendChild(el('label', { class: 'field-row' }, [archived, '取引終了（一覧の「取引中」に出さない）']));

      form.addEventListener('input', () => setDirty(true));
      collectors.push(() => {
        const edited = {};
        for (const k of Object.keys(fields)) edited[k] = fields[k].value;
        edited.tags = tagsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
        edited.isArchived = archived.checked;
        return edited;
      });
      section.appendChild(sectionHeader('基本情報'));
      section.appendChild(form);
    }

    editMode ? edit() : view();
    return section;
  }

  // ---------------- 連絡先 ----------------
  function buildContactSection() {
    const section = el('section', { class: 'section' });

    function view() {
      clear(section);
      section.appendChild(sectionHeader('連絡先'));
      const list = el('div', { class: 'field-stack' });
      for (const p of record.phones || []) {
        list.appendChild(el('div', { class: 'field-row' }, [
          el('span', { class: 'chip' }, p.type || ''),
          telLink(p.number),
          copyButton(ctx, p.number)
        ]));
      }
      if (record.email) {
        list.appendChild(el('div', { class: 'field-row' }, [mailLink(record.email), copyButton(ctx, record.email)]));
      }
      for (const m of record.extraEmails || []) {
        if (!m.address) continue;
        list.appendChild(el('div', { class: 'field-row' }, [
          m.label ? el('span', { class: 'chip' }, m.label) : null,
          mailLink(m.address),
          copyButton(ctx, m.address)
        ]));
      }
      if (record.mainAddr) {
        list.appendChild(addressDisplayRow(ctx, record.mainZip, record.mainAddr));
      }
      section.appendChild(list);
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const phonesBox = el('div', { class: 'field-stack' });
      const phoneRows = (record.phones || []).map((p) => ({ ...p }));
      function renderPhones() {
        clear(phonesBox);
        phoneRows.forEach((p, i) => {
          const typeSel = el('select', { class: 'field' }, PHONE_TYPES.map((t) => el('option', { value: t, selected: t === p.type }, t)));
          typeSel.addEventListener('change', () => { p.type = typeSel.value; });
          const numInput = el('input', { type: 'tel', class: 'field', value: p.number || '' });
          numInput.addEventListener('input', () => { p.number = numInput.value; });
          const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { phoneRows.splice(i, 1); renderPhones(); } }, '削除');
          phonesBox.appendChild(el('div', { class: 'field-row' }, [typeSel, numInput, delBtn]));
        });
      }
      renderPhones();
      const addPhoneBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { phoneRows.push({ type: PHONE_TYPES[0], number: '' }); renderPhones(); } }, '＋電話追加');

      const emailInput = el('input', { type: 'email', class: 'field', value: record.email || '' });
      const zipInput = el('input', { type: 'text', class: 'field', value: record.mainZip || '', placeholder: '1234567' });
      const addrInput = el('input', { type: 'text', class: 'field', value: record.mainAddr || '' });

      form.appendChild(el('label', {}, ['電話']));
      form.appendChild(phonesBox);
      form.appendChild(addPhoneBtn);
      // 法人は追加メール（用途ラベル付き）を複数持てる。主メールは従来どおり email に保存。
      const isCorp = record.type === 'corporate';
      const extraEmails = (record.extraEmails || []).map((m) => ({ ...m }));
      const emailsBox = el('div', { class: 'field-stack' });
      function renderEmails() {
        clear(emailsBox);
        extraEmails.forEach((m, i) => {
          const labelI = el('input', { type: 'text', class: 'field', value: m.label || '', placeholder: '用途（例: 経理）' });
          labelI.addEventListener('input', () => { m.label = labelI.value; });
          const addrI = el('input', { type: 'email', class: 'field', value: m.address || '', placeholder: 'メール' });
          addrI.addEventListener('input', () => { m.address = addrI.value; });
          const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { extraEmails.splice(i, 1); renderEmails(); } }, '削除');
          emailsBox.appendChild(el('div', { class: 'field-row' }, [labelI, addrI, delBtn]));
        });
      }
      form.appendChild(el('label', {}, [isCorp ? 'メール（代表）' : 'メール', emailInput]));
      if (isCorp) {
        renderEmails();
        form.appendChild(emailsBox);
        form.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => { extraEmails.push({ label: '', address: '' }); renderEmails(); } }, '＋メール追加'));
      }
      form.appendChild(el('label', {}, ['郵便番号', el('div', { class: 'field-row' }, [zipInput, zipLookupButton(ctx, zipInput, addrInput)])]));
      form.appendChild(el('label', {}, ['住所', el('div', { class: 'field-row' }, [addrInput, addressSearchButton(addrInput)])]));

      form.addEventListener('input', () => setDirty(true));
      collectors.push(() => {
        const edited = { phones: phoneRows, email: emailInput.value, mainZip: zipInput.value, mainAddr: addrInput.value };
        if (isCorp) edited.extraEmails = extraEmails.filter((m) => (m.address || '').trim());
        return edited;
      });

      section.appendChild(sectionHeader('連絡先'));
      section.appendChild(form);
    }

    editMode ? edit() : view();
    return section;
  }

  // ---------------- 詳細（個人/法人） ----------------
  function buildDetailSection() {
    const section = el('section', { class: 'section' });

    function view() {
      clear(section);
      section.appendChild(sectionHeader('詳細'));
      const stack = el('div', { class: 'field-stack' });
      if (record.type === 'individual') {
        if (record.retainerContract) stack.appendChild(el('div', {}, `顧問契約: ${record.retainerContract === 'yes' ? '有' : '無'}${record.retainerDate ? '（' + formatDate(record.retainerDate) + '）' : ''}`));
        if (record.birthday) {
          stack.appendChild(el('div', {}, `生年月日: ${formatDate(record.birthday)}（${toWareki(record.birthday)}／満${calcAge(record.birthday)}歳）`));
        }
        if (record.prevAddr) stack.appendChild(el('div', {}, `前住所: ${record.prevAddr}`));
        if (record.hkAddr) stack.appendChild(el('div', {}, `本籍: ${record.hkAddr}`));
        if (record.hoterasu) stack.appendChild(el('div', {}, `法テラス: ${{ no: '利用なし', yes: '利用あり', applied: '申請中' }[record.hoterasu] || record.hoterasu}`));
      } else {
        if (record.representative) stack.appendChild(el('div', {}, `代表者: ${record.repTitle || ''} ${record.representative}`));
        if (record.retainerContract) stack.appendChild(el('div', {}, `顧問契約: ${record.retainerContract === 'yes' ? '有' : '無'}${record.retainerDate ? '（' + formatDate(record.retainerDate) + '）' : ''}`));
        if (record.repIsContact) {
          stack.appendChild(el('div', {}, `担当者: 代表者${record.representative ? '（' + record.representative + '）' : ''}が兼任 ／ 電話・メールは「連絡先」欄`));
        }
        for (const p of record.contactPersons || []) {
          stack.appendChild(el('div', { class: 'field-row' }, `担当者: ${p.name || ''} ${p.title || ''} ${p.dept || ''} ${p.tel || ''} ${p.email || ''}`));
        }
        for (const b of record.branchOffices || []) {
          stack.appendChild(el('div', { class: 'field-row' }, `事業所: ${b.name || ''} ${b.addr || ''}`));
        }
        for (const r of record.relatedCompanies || []) {
          stack.appendChild(el('div', { class: 'field-row' }, `関連会社: ${r.name || ''} ${r.tel || ''} ${r.addr || ''}`));
        }
      }
      section.appendChild(stack);
      if (ctx.caps.ai) {
        section.appendChild(buildAiButtons());
      }
    }

    function buildAiButtons() {
      const row = el('div', { class: 'field-row' });
      // 読み取り結果をメモに書くときは、項目名を日本語にする（companyName: → 会社名:）
      const memoLine = (sel, fields) => Object.entries(sel)
        .map(([k, v]) => `${(fields.find((f) => f.key === k) || { label: k }).label}: ${v}`).join(' / ');
      const CARD_FIELDS = [
        { key: 'companyName', label: '会社名' },
        { key: 'title', label: '役職' },
        { key: 'department', label: '部署' },
        { key: 'name', label: '氏名' },
        { key: 'tel', label: '電話' },
        { key: 'email', label: 'メール' }
      ];
      const REGISTRY_FIELDS = [
        { key: 'established', label: '設立年月日' },
        { key: 'capital', label: '資本金' },
        { key: 'purpose', label: '目的' }
      ];
      row.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
        await runAiExtractFlow(ctx, { kind: 'card', clientType: record.type }, CARD_FIELDS, async (sel) => {
          if (record.type === 'individual') {
            const extra = memoLine(sel, CARD_FIELDS);
            await saveSection({ notes: (record.notes ? record.notes + '\n' : '') + `【名刺】${extra}` });
          } else {
            const cp = { name: sel.name || '', title: sel.title || '', dept: sel.department || '', tel: sel.tel || '', email: sel.email || '', homeAddr: '' };
            await saveSection({ contactPersons: [...(record.contactPersons || []), cp] });
          }
        });
      } }, '名刺AI読取'));
      if (record.type === 'corporate') {
        row.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
          await runAiExtractFlow(ctx, { kind: 'registry' }, REGISTRY_FIELDS, async (sel) => {
            const extra = memoLine(sel, REGISTRY_FIELDS);
            await saveSection({ notes: (record.notes ? record.notes + '\n' : '') + `【登記】${extra}` });
          });
        } }, '登記AI読取'));
      }
      return row;
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      let getEdited;
      if (record.type === 'individual') {
        const birthday = el('input', { type: 'date', class: 'field', value: record.birthday || '' });
        const prevAddr = el('input', { type: 'text', class: 'field', value: record.prevAddr || '' });
        const hkAddr = el('input', { type: 'text', class: 'field', value: record.hkAddr || '' });
        const hoterasu = el('select', { class: 'field' }, [
          el('option', { value: '', selected: !record.hoterasu }, '未設定'),
          el('option', { value: 'no', selected: record.hoterasu === 'no' }, '利用なし'),
          el('option', { value: 'yes', selected: record.hoterasu === 'yes' }, '利用あり'),
          el('option', { value: 'applied', selected: record.hoterasu === 'applied' }, '申請中')
        ]);
        form.appendChild(el('label', {}, ['生年月日', birthday]));
        form.appendChild(el('label', {}, ['前住所', prevAddr]));
        form.appendChild(el('label', {}, ['本籍', hkAddr]));
        form.appendChild(el('label', {}, ['法テラス', hoterasu]));
        const retainerContract = retainerSelect();
        const retainerDate = el('input', { type: 'date', class: 'field', value: record.retainerDate || '' });
        form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['顧問契約', retainerContract]), el('label', {}, ['契約日', retainerDate])]));
        getEdited = () => ({
          birthday: birthday.value, prevAddr: prevAddr.value, hkAddr: hkAddr.value, hoterasu: hoterasu.value,
          retainerContract: retainerContract.value, retainerDate: retainerDate.value
        });
      } else {
        const repTitle = el('input', { type: 'text', class: 'field', value: record.repTitle || '' });
        const representative = el('input', { type: 'text', class: 'field', value: record.representative || '' });
        const retainerContract = retainerSelect();
        const retainerDate = el('input', { type: 'date', class: 'field', value: record.retainerDate || '' });
        form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['役職', repTitle]), el('label', {}, ['代表者', representative])]));
        const repIsContact = el('input', { type: 'checkbox', checked: !!record.repIsContact });
        form.appendChild(el('label', { class: 'field-row' }, [repIsContact, '代表者が担当者を兼ねる（担当者の電話・メールは「連絡先」欄を使用）']));
        form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['顧問契約', retainerContract]), el('label', {}, ['契約日', retainerDate])]));

        const contactPersons = (record.contactPersons || []).map((p) => ({ ...p }));
        const cpBox = el('div', { class: 'field-stack' });
        function renderCp() {
          clear(cpBox);
          contactPersons.forEach((p, i) => {
            const nameI = el('input', { type: 'text', class: 'field', value: p.name || '', placeholder: '氏名' });
            nameI.addEventListener('input', () => { p.name = nameI.value; });
            const titleI = el('input', { type: 'text', class: 'field', value: p.title || '', placeholder: '役職' });
            titleI.addEventListener('input', () => { p.title = titleI.value; });
            const deptI = el('input', { type: 'text', class: 'field', value: p.dept || '', placeholder: '部署' });
            deptI.addEventListener('input', () => { p.dept = deptI.value; });
            const telI = el('input', { type: 'tel', class: 'field', value: p.tel || '', placeholder: '電話' });
            telI.addEventListener('input', () => { p.tel = telI.value; });
            const emailI = el('input', { type: 'email', class: 'field', value: p.email || '', placeholder: 'メール' });
            emailI.addEventListener('input', () => { p.email = emailI.value; });
            const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { contactPersons.splice(i, 1); renderCp(); } }, '削除');
            cpBox.appendChild(el('div', { class: 'field-row' }, [nameI, titleI, deptI, telI, emailI, delBtn]));
          });
        }
        renderCp();
        // 兼任チェック時は担当者欄を畳む（入力済みの担当者データは消さずに保持する）。
        const cpWrap = el('div', { class: 'field-stack' }, [
          el('label', {}, ['担当者（代表者以外）']),
          cpBox,
          el('button', { type: 'button', class: 'btn btn-small', onClick: () => { contactPersons.push({ name: '', title: '', dept: '', tel: '', email: '', homeAddr: '' }); renderCp(); } }, '＋担当者追加')
        ]);
        const syncCpWrap = () => { cpWrap.hidden = repIsContact.checked && contactPersons.length === 0; };
        repIsContact.addEventListener('change', syncCpWrap);
        syncCpWrap();
        form.appendChild(cpWrap);

        const branchOffices = (record.branchOffices || []).map((b) => ({ ...b }));
        const boBox = el('div', { class: 'field-stack' });
        function renderBo() {
          clear(boBox);
          branchOffices.forEach((b, i) => {
            const nameI = el('input', { type: 'text', class: 'field', value: b.name || '', placeholder: '名称' });
            nameI.addEventListener('input', () => { b.name = nameI.value; });
            const addrI = el('input', { type: 'text', class: 'field', value: b.addr || '', placeholder: '住所' });
            addrI.addEventListener('input', () => { b.addr = addrI.value; });
            const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { branchOffices.splice(i, 1); renderBo(); } }, '削除');
            boBox.appendChild(el('div', { class: 'field-row' }, [nameI, addrI, delBtn]));
          });
        }
        renderBo();
        form.appendChild(el('label', {}, ['事業所']));
        form.appendChild(boBox);
        form.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => { branchOffices.push({ name: '', zip: '', addr: '' }); renderBo(); } }, '＋事業所追加'));

        const relatedCompanies = (record.relatedCompanies || []).map((r) => ({ ...r }));
        const rcBox = el('div', { class: 'field-stack' });
        function renderRc() {
          clear(rcBox);
          relatedCompanies.forEach((r, i) => {
            const nameI = el('input', { type: 'text', class: 'field', value: r.name || '', placeholder: '名称' });
            nameI.addEventListener('input', () => { r.name = nameI.value; });
            const telI = el('input', { type: 'tel', class: 'field', value: r.tel || '', placeholder: '電話' });
            telI.addEventListener('input', () => { r.tel = telI.value; });
            const addrI = el('input', { type: 'text', class: 'field', value: r.addr || '', placeholder: '住所' });
            addrI.addEventListener('input', () => { r.addr = addrI.value; });
            const delBtn = el('button', { type: 'button', class: 'btn btn-small', onClick: () => { relatedCompanies.splice(i, 1); renderRc(); } }, '削除');
            rcBox.appendChild(el('div', { class: 'field-row' }, [nameI, telI, addrI, delBtn]));
          });
        }
        renderRc();
        form.appendChild(el('label', {}, ['関連会社']));
        form.appendChild(rcBox);
        form.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => { relatedCompanies.push({ name: '', tel: '', addr: '' }); renderRc(); } }, '＋関連会社追加'));

        getEdited = () => ({
          repTitle: repTitle.value,
          representative: representative.value,
          repIsContact: repIsContact.checked,
          retainerContract: retainerContract.value,
          retainerDate: retainerDate.value,
          contactPersons, branchOffices, relatedCompanies
        });
      }

      form.addEventListener('input', () => setDirty(true));
      form.addEventListener('change', () => setDirty(true));
      collectors.push(getEdited);

      section.appendChild(sectionHeader('詳細'));
      section.appendChild(form);
    }

    function retainerSelect() {
      return el('select', { class: 'field' }, [
        el('option', { value: '', selected: !record.retainerContract }, '未設定'),
        el('option', { value: 'yes', selected: record.retainerContract === 'yes' }, '有'),
        el('option', { value: 'no', selected: record.retainerContract === 'no' }, '無')
      ]);
    }

    editMode ? edit() : view();
    return section;
  }

  // ---------------- 関連案件 ----------------
  function buildCasesSection() {
    const section = el('section', { class: 'section' });
    section.appendChild(sectionHeader('関連案件'));
    const related = (all.cases || []).filter((c) => (c.clientIds || []).includes(record.id));
    const list = el('ul', { class: 'list' });
    for (const c of related) {
      list.appendChild(el('li', { class: 'list-row', onClick: () => ctx.navigate(`#/cases/${c.id}`) }, c.caseName || '(無題の案件)'));
    }
    section.appendChild(list);
    if (!related.length) section.appendChild(el('p', { class: 'text-muted' }, '関連案件はありません'));
    section.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
      const created = await quickCreateCaseDialog(ctx, [record]);
      if (created) ctx.navigate(`#/cases/${created.id}`);
    } }, '＋新規案件'));
    return section;
  }

  // ---------------- 名刺・添付 ----------------
  function buildFilesSection() {
    const section = el('section', { class: 'section' });
    section.appendChild(sectionHeader('名刺・添付'));

    function fileRow(list, ref) {
      const url = ctx.store.fileUrl ? ctx.store.fileUrl(ref) : (ref.dataUrl || '#');
      return el('div', { class: 'field-row' }, [
        el('a', { href: url, target: '_blank', rel: 'noopener' }, ref.originalName || ref.label || ref.filename),
        el('span', { class: 'text-muted' }, ref.addedAt ? ref.addedAt.slice(0, 10) : '')
      ]);
    }

    const cardsBox = el('div', { class: 'field-stack' });
    for (const ref of record.cards || []) cardsBox.appendChild(fileRow('cards', ref));
    const cardInput = el('input', { type: 'file', accept: 'image/*,application/pdf' });
    cardInput.addEventListener('change', async () => {
      const file = cardInput.files[0];
      if (!file) return;
      try {
        const ref = await ctx.store.uploadFile(file);
        await saveSection({ cards: [...(record.cards || []), ref] });
      } catch (e) {
        ctx.toast('アップロードに失敗しました: ' + e.message, 'error');
      }
    });
    section.appendChild(el('div', { class: 'section-sub' }, '名刺'));
    section.appendChild(cardsBox);
    section.appendChild(el('label', { class: 'btn btn-small file-btn' }, [cardInput, '＋名刺を追加']));

    const attachBox = el('div', { class: 'field-stack' });
    for (const ref of record.attachments || []) attachBox.appendChild(fileRow('attachments', ref));
    const attachInput = el('input', { type: 'file' });
    attachInput.addEventListener('change', async () => {
      const file = attachInput.files[0];
      if (!file) return;
      try {
        const ref = await ctx.store.uploadFile(file);
        await saveSection({ attachments: [...(record.attachments || []), ref] });
      } catch (e) {
        ctx.toast('アップロードに失敗しました: ' + e.message, 'error');
      }
    });
    section.appendChild(el('div', { class: 'section-sub' }, '添付（登記情報・住民票・免許証等）'));
    section.appendChild(attachBox);
    section.appendChild(el('label', { class: 'btn btn-small file-btn' }, [attachInput, '＋ファイルを添付']));

    return section;
  }

  // ---------------- 備考・紹介者 ----------------
  function buildNotesSection() {
    const section = el('section', { class: 'section' });

    function view() {
      clear(section);
      section.appendChild(sectionHeader('備考・紹介者'));
      // 空の項目は「紹介者: 」のような空行を出さない
      const referrer = [record.referrer, record.referrerAttr].filter(Boolean).join(' ');
      const envelope = { ok: '可', ng: '不可', unknown: '不明' }[record.envelope] || '';
      if (record.notes) section.appendChild(el('p', { style: 'white-space:pre-line' }, record.notes));
      if (referrer) section.appendChild(el('p', { class: 'text-muted' }, `紹介者: ${referrer}`));
      if (envelope) section.appendChild(el('p', { class: 'text-muted' }, `事務所封筒: ${envelope}`));
      if (!record.notes && !referrer && !envelope) section.appendChild(el('p', { class: 'text-muted' }, '未入力'));
    }

    function edit() {
      clear(section);
      const form = el('form', { class: 'quick-form' });
      const notes = el('textarea', { class: 'field', rows: 4 }, record.notes || '');
      const referrer = el('input', { type: 'text', class: 'field', value: record.referrer || '' });
      const referrerAttr = el('input', { type: 'text', class: 'field', value: record.referrerAttr || '' });
      const envelope = el('select', { class: 'field' }, [
        el('option', { value: '', selected: !record.envelope }, '未設定'),
        el('option', { value: 'ok', selected: record.envelope === 'ok' }, '可'),
        el('option', { value: 'ng', selected: record.envelope === 'ng' }, '不可'),
        el('option', { value: 'unknown', selected: record.envelope === 'unknown' }, '不明')
      ]);
      form.appendChild(el('label', {}, ['備考', notes]));
      form.appendChild(el('label', {}, ['紹介者', referrer]));
      form.appendChild(el('label', {}, ['紹介者属性', referrerAttr]));
      form.appendChild(el('label', {}, ['事務所封筒郵送', envelope]));
      form.addEventListener('input', () => setDirty(true));
      collectors.push(() => ({ notes: notes.value, referrer: referrer.value, referrerAttr: referrerAttr.value, envelope: envelope.value }));
      section.appendChild(sectionHeader('備考・紹介者'));
      section.appendChild(form);
    }

    editMode ? edit() : view();
    return section;
  }

  void reload;
  renderAll();
}
