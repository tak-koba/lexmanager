// LexManager 4 - domain model helpers (schema 4, DESIGN.md §3)

export const PHONE_TYPES = ['携帯電話', '自宅', '会社', 'FAX', 'その他'];

export function displayName(client) {
  if (!client) return '';
  if (client.type === 'corporate') {
    return client.companyName || '';
  }
  return `${client.lastName || ''} ${client.firstName || ''}`.trim();
}

export function kanaName(client) {
  if (!client) return '';
  if (client.type === 'corporate') {
    return client.companyNameKana || client.companyName || '';
  }
  const kana = `${client.lastNameKana || ''} ${client.firstNameKana || ''}`.trim();
  return kana || displayName(client);
}

// かな空欄は並び順の末尾に来るようにする（レガシー版のバグ修正）。
export function sortByKana(list, getKana) {
  return list.sort((a, b) => {
    const ka = getKana(a) || '';
    const kb = getKana(b) || '';
    if (!ka && !kb) return 0;
    if (!ka) return 1;
    if (!kb) return -1;
    return ka.localeCompare(kb, 'ja', { sensitivity: 'base' });
  });
}

export function opponentName(o) {
  if (!o) return '';
  if (o.type === 'corporate') {
    return o.corpName || '';
  }
  return `${o.lastName || ''}${o.firstName || ''}`;
}

export function normalizePhone(s) {
  if (!s) return '';
  return String(s).replace(/-/g, '');
}

// today基準。soonは3日以内。
export function deadlineBadge(dateStr) {
  if (!dateStr) return '';
  const datePart = dateStr.slice(0, 10);
  const d = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = d.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 3) return 'soon';
  return 'later';
}

export function newId(prefix) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}_${r}`;
}

export function defaultClient(type) {
  const base = {
    id: '',
    type: type === 'corporate' ? 'corporate' : 'individual',
    registeredAt: '',
    isArchived: false,
    tags: [],
    notes: '',
    referrer: '',
    referrerAttr: '',
    email: '',
    envelope: '',
    phones: [],
    cards: [],
    attachments: []
  };
  if (base.type === 'corporate') {
    return Object.assign(base, {
      companyName: '',
      companyNameKana: '',
      repTitle: '',
      representative: '',
      mainZip: '',
      mainAddr: '',
      retainerContract: '',
      retainerDate: '',
      contactPersons: [],
      branchOffices: [],
      relatedCompanies: []
    });
  }
  return Object.assign(base, {
    lastName: '',
    firstName: '',
    lastNameKana: '',
    firstNameKana: '',
    birthday: '',
    mainZip: '',
    mainAddr: '',
    prevZip: '',
    prevAddr: '',
    hkAddr: '',
    hoterasu: '',
    altContacts: []
  });
}

export function defaultCase(caseType) {
  const base = {
    id: '',
    caseType: caseType === 'court' ? 'court' : 'client',
    caseName: '',
    clientIds: [],
    registeredAt: '',
    isArchived: false,
    notes: '',
    trialCourt: '',
    trialDept: '',
    trialClerk: '',
    trialTel: '',
    trialFax: '',
    nextDate: '',
    minutes: []
  };
  if (base.caseType === 'court') {
    return Object.assign(base, {
      courtRole: ''
    });
  }
  return Object.assign(base, {
    caseCategory: 'document',
    overview: '',
    requestContent: '',
    commissionSigned: '',
    opponents: [],
    trialType: '',
    trialMethod: '',
    trialPrep: ''
  });
}

export function defaultTodo() {
  return {
    id: '',
    title: '',
    caseId: '',
    deadline: '',
    done: false,
    doneAt: '',
    notes: ''
  };
}
