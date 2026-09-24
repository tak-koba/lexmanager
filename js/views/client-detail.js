// LexManager 4 - 顧客詳細（閲覧が既定、セクション単位で編集）
import { el, clear } from '../ui/dom.js';
import { guardNavigation } from '../ui/forms.js';
import { ConflictError } from '../api.js';
import { toWareki, calcAge } from '../util/gengo.js';
import {
  displayName, kanaName, sortByKana, PHONE_TYPES, formatDate,
  telLink, mailLink, copyButton, addressDisplayRow, zipLookupButton, addressSearchButton,
  kanaAssistPair, sectionHeader, saveRecord, deleteRecordButton, quickCreateCaseDialog, runAiExtractFlow
} from './_shared.js';

export async function render(container, params, ctx) {
  clear(container);
  const id = params && params.id;
  if (!id) {
    container.appendChild(el('p', { class: 'text-error' }, '顧客IDが指定されていません'));
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
  let record = (all.clients || []).find((c) => c.id === id);
  clear(container);
  if (!record) {
    container.appendChild(el('p', { class: 'text-error' }, '顧客が見つかりません'));
    return;
  }

  let dirty = false;
  const setDirty = (v) => { dirty = v; };
  const guardBeforeNav = async () => guardNavigation(() => dirty);


  const root = el('div', { class: 'detail-root' });
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

  function renderAll() {
    clear(root);
    root.appendChild(buildHeaderSection());
    root.appendChild(buildContactSection());
    root.appendChild(buildDetailSection());
    root.appendChild(buildCasesSection());
    root.appendChild(buildFilesSection());
    root.appendChild(buildNotesSection());
  }

  // ---------------- 見出し ----------------
  function buildHeaderSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('基本情報', () => { editing = true; edit(); }));
      section.appendChild(el('h2', {}, displayName(record) || '(名称未設定)'));
      section.appendChild(el('p', { class: 'text-muted' }, kanaName(record)));
      section.appendChild(el('div', { class: 'field-row' }, [
        el('span', { class: 'chip' }, record.type === 'corporate' ? '法人' : '個人'),
        record.isArchived ? el('span', { class: 'chip' }, 'アーカイブ') : null,
        ...(record.tags || []).map((t) => el('span', { class: 'chip' }, t))
      ]));
      const related = (all.cases || []).filter((k) => (k.clientIds || []).includes(record.id));
      section.appendChild(el('div', { class: 'field-row', style: 'margin-top:8px' }, [
        deleteRecordButton(ctx, 'clients', () => record, displayName(record) || 'この顧客', '#/clients',
          related.length ? `この顧客は${related.length}件の案件の依頼者に登録されています。案件側の依頼者表示は「(不明)」になります。` : '')
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
      form.appendChild(el('label', { class: 'field-row' }, [archived, 'アーカイブ済み']));

      form.addEventListener('input', () => setDirty(true));

      const actions = el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          const edited = {};
          for (const k of Object.keys(fields)) edited[k] = fields[k].value;
          edited.tags = tagsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
          edited.isArchived = archived.checked;
          editing = false;
          await saveSection(edited);
        } }, '保存')
      ]);
      form.appendChild(actions);
      section.appendChild(sectionHeader('基本情報（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    Object.defineProperty(section, '_refresh', { value: () => (editing ? edit() : view()), configurable: true });
    return section;
  }

  // ---------------- 連絡先 ----------------
  function buildContactSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('連絡先', () => { editing = true; edit(); }));
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
      form.appendChild(el('label', {}, ['メール', emailInput]));
      form.appendChild(el('label', {}, ['郵便番号', el('div', { class: 'field-row' }, [zipInput, zipLookupButton(ctx, zipInput, addrInput)])]));
      form.appendChild(el('label', {}, ['住所', el('div', { class: 'field-row' }, [addrInput, addressSearchButton(addrInput)])]));

      form.addEventListener('input', () => setDirty(true));

      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          editing = false;
          await saveSection({ phones: phoneRows, email: emailInput.value, mainZip: zipInput.value, mainAddr: addrInput.value });
        } }, '保存')
      ]));

      section.appendChild(sectionHeader('連絡先（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  // ---------------- 詳細（個人/法人） ----------------
  function buildDetailSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('詳細', () => { editing = true; edit(); }));
      const stack = el('div', { class: 'field-stack' });
      if (record.type === 'individual') {
        if (record.birthday) {
          stack.appendChild(el('div', {}, `生年月日: ${formatDate(record.birthday)}（${toWareki(record.birthday)}／満${calcAge(record.birthday)}歳）`));
        }
        if (record.prevAddr) stack.appendChild(el('div', {}, `前住所: ${record.prevAddr}`));
        if (record.hkAddr) stack.appendChild(el('div', {}, `本籍: ${record.hkAddr}`));
        if (record.hoterasu) stack.appendChild(el('div', {}, `法テラス: ${{ no: '利用なし', yes: '利用あり', applied: '申請中' }[record.hoterasu] || record.hoterasu}`));
      } else {
        if (record.representative) stack.appendChild(el('div', {}, `代表者: ${record.repTitle || ''} ${record.representative}`));
        if (record.retainerContract) stack.appendChild(el('div', {}, `顧問契約: ${record.retainerContract === 'yes' ? '有' : '無'}${record.retainerDate ? '（' + formatDate(record.retainerDate) + '）' : ''}`));
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
      row.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
        await runAiExtractFlow(ctx, { kind: 'card', clientType: record.type }, [
          { key: 'companyName', label: '会社名' },
          { key: 'title', label: '役職' },
          { key: 'department', label: '部署' },
          { key: 'name', label: '氏名' },
          { key: 'tel', label: '電話' },
          { key: 'email', label: 'メール' }
        ], async (sel) => {
          if (record.type === 'individual') {
            const extra = Object.entries(sel).map(([k, v]) => `${k}: ${v}`).join(' / ');
            await saveSection({ notes: (record.notes ? record.notes + '\n' : '') + `【名刺】${extra}` });
          } else {
            const cp = { name: sel.name || '', title: sel.title || '', dept: sel.department || '', tel: sel.tel || '', email: sel.email || '', homeAddr: '' };
            await saveSection({ contactPersons: [...(record.contactPersons || []), cp] });
          }
        });
      } }, '名刺AI読取'));
      if (record.type === 'corporate') {
        row.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
          await runAiExtractFlow(ctx, { kind: 'registry' }, [
            { key: 'established', label: '設立年月日' },
            { key: 'capital', label: '資本金' },
            { key: 'purpose', label: '目的' }
          ], async (sel) => {
            const extra = Object.entries(sel).map(([k, v]) => `${k}: ${v}`).join(' / ');
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
        getEdited = () => ({ birthday: birthday.value, prevAddr: prevAddr.value, hkAddr: hkAddr.value, hoterasu: hoterasu.value });
      } else {
        const repTitle = el('input', { type: 'text', class: 'field', value: record.repTitle || '' });
        const representative = el('input', { type: 'text', class: 'field', value: record.representative || '' });
        const retainerContract = el('select', { class: 'field' }, [
          el('option', { value: '', selected: !record.retainerContract }, '未設定'),
          el('option', { value: 'yes', selected: record.retainerContract === 'yes' }, '有'),
          el('option', { value: 'no', selected: record.retainerContract === 'no' }, '無')
        ]);
        const retainerDate = el('input', { type: 'date', class: 'field', value: record.retainerDate || '' });
        form.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['役職', repTitle]), el('label', {}, ['代表者', representative])]));
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
        form.appendChild(el('label', {}, ['担当者']));
        form.appendChild(cpBox);
        form.appendChild(el('button', { type: 'button', class: 'btn btn-small', onClick: () => { contactPersons.push({ name: '', title: '', dept: '', tel: '', email: '', homeAddr: '' }); renderCp(); } }, '＋担当者追加'));

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
          retainerContract: retainerContract.value,
          retainerDate: retainerDate.value,
          contactPersons, branchOffices, relatedCompanies
        });
      }

      form.addEventListener('input', () => setDirty(true));
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          editing = false;
          await saveSection(getEdited());
        } }, '保存')
      ]));

      section.appendChild(sectionHeader('詳細（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
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
    section.appendChild(el('label', {}, ['名刺']));
    section.appendChild(cardsBox);
    section.appendChild(cardInput);

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
    section.appendChild(el('label', {}, ['添付（登記情報・住民票・免許証等）']));
    section.appendChild(attachBox);
    section.appendChild(attachInput);

    return section;
  }

  // ---------------- 備考・紹介者 ----------------
  function buildNotesSection() {
    const section = el('section', { class: 'section' });
    let editing = false;

    function view() {
      clear(section);
      section.appendChild(sectionHeader('備考・紹介者', () => { editing = true; edit(); }));
      section.appendChild(el('p', {}, record.notes || ''));
      section.appendChild(el('p', { class: 'text-muted' }, `紹介者: ${record.referrer || ''} ${record.referrerAttr || ''}`));
      section.appendChild(el('p', { class: 'text-muted' }, `事務所封筒: ${{ ok: '可', ng: '不可', unknown: '不明' }[record.envelope] || ''}`));
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
      form.appendChild(el('div', { class: 'field-row' }, [
        el('button', { type: 'button', class: 'btn', onClick: () => { editing = false; view(); } }, 'キャンセル'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          editing = false;
          await saveSection({ notes: notes.value, referrer: referrer.value, referrerAttr: referrerAttr.value, envelope: envelope.value });
        } }, '保存')
      ]));
      section.appendChild(sectionHeader('備考・紹介者（編集中）'));
      section.appendChild(form);
    }

    editing ? edit() : view();
    return section;
  }

  void reload;
  renderAll();
}
