// LexManager 4 - ツール（和暦・年齢・年齢早見表・CSV出力・ごみ箱）
import { el, clear } from '../ui/dom.js';
import { toWareki, toSeireki, calcAge } from '../util/gengo.js';
import { todayIso } from './_shared.js';

const ERA_NAMES = ['令和', '平成', '昭和', '大正', '明治'];

export async function render(container, params, ctx) {
  clear(container);
  container.appendChild(el('h1', { class: 'view-title' }, 'ツール'));

  container.appendChild(buildGengoSection());
  container.appendChild(buildAgeSection());
  container.appendChild(buildHayamiSection());
  if (ctx.caps.csv) container.appendChild(buildCsvSection(ctx));
  if (ctx.caps.trash) container.appendChild(await buildTrashSection(ctx));
}

function buildGengoSection() {
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, '和暦⇔西暦変換'));

  const westBox = el('div', { class: 'field-row' });
  const dateInput = el('input', { type: 'date', class: 'field' });
  const westResult = el('span', { class: 'result' }, '');
  dateInput.addEventListener('input', () => {
    westResult.textContent = dateInput.value ? toWareki(dateInput.value) : '';
  });
  westBox.appendChild(el('label', {}, ['西暦 → 和暦', dateInput]));
  westBox.appendChild(westResult);
  section.appendChild(westBox);

  const eraBox = el('div', { class: 'field-row' });
  const eraSelect = el('select', { class: 'field' }, ERA_NAMES.map((e) => el('option', { value: e }, e)));
  const kanenInput = el('input', { type: 'text', class: 'field', placeholder: '例: 7 または 元' });
  const eraResult = el('span', { class: 'result' }, '');
  function updateEra() {
    if (!kanenInput.value) { eraResult.textContent = ''; return; }
    const y = toSeireki(eraSelect.value, kanenInput.value);
    eraResult.textContent = Number.isNaN(y) ? '' : `${y}年`;
  }
  eraSelect.addEventListener('change', updateEra);
  kanenInput.addEventListener('input', updateEra);
  eraBox.appendChild(el('label', {}, ['和暦 → 西暦', el('span', {}, [eraSelect, kanenInput])]));
  eraBox.appendChild(eraResult);
  section.appendChild(eraBox);

  return section;
}

function buildAgeSection() {
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, '年齢計算'));
  const birthdayInput = el('input', { type: 'date', class: 'field' });
  const result = el('span', { class: 'result' }, '');
  birthdayInput.addEventListener('input', () => {
    if (!birthdayInput.value) { result.textContent = ''; return; }
    const age = calcAge(birthdayInput.value);
    result.textContent = Number.isNaN(age) ? '' : `満${age}歳（${toWareki(birthdayInput.value)}生）`;
  });
  section.appendChild(el('div', { class: 'field-row' }, [el('label', {}, ['生年月日', birthdayInput]), result]));
  return section;
}

function buildHayamiSection() {
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, '年齢早見表'));
  const currentYear = Number(todayIso().slice(0, 4));
  const yearInput = el('input', { type: 'number', class: 'field', value: currentYear });
  const linksBox = el('div', { class: 'field-row' });
  function renderLinks() {
    clear(linksBox);
    const y = Number(yearInput.value) || currentYear;
    for (let i = -1; i <= 4; i++) {
      const yy = y + i;
      linksBox.appendChild(el('a', { href: `https://www.nenrei-hayami.net/${yy}.pdf`, target: '_blank', rel: 'noopener' }, `${yy}年`));
    }
  }
  yearInput.addEventListener('input', renderLinks);
  renderLinks();
  section.appendChild(el('label', {}, ['基準年', yearInput]));
  section.appendChild(linksBox);
  return section;
}

function buildCsvSection(ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, 'CSV出力'));
  const targetSelect = el('select', { class: 'field' }, [
    el('option', { value: 'clients' }, '顧客'),
    el('option', { value: 'cases' }, '案件'),
    el('option', { value: 'todos' }, 'ToDo')
  ]);
  const idsInput = el('input', { type: 'text', class: 'field', placeholder: 'IDをカンマ区切りで指定（空欄で全件）' });
  const exportBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: () => {
    const ids = idsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    const url = ctx.store.exportCsvUrl(targetSelect.value, ids);
    window.open(url, '_blank', 'noopener');
  } }, 'CSVダウンロード');
  section.appendChild(el('div', { class: 'field-row' }, [targetSelect, idsInput, exportBtn]));
  return section;
}

async function buildTrashSection(ctx) {
  const section = el('section', { class: 'section' });
  section.appendChild(el('h3', {}, 'ごみ箱'));
  const listBox = el('div', { class: 'list-box' });
  section.appendChild(listBox);

  async function reload() {
    clear(listBox);
    let items = [];
    try {
      const res = await ctx.store.getTrash();
      items = (res && res.items) || res || [];
    } catch (e) {
      listBox.appendChild(el('p', { class: 'text-error' }, '取得に失敗しました: ' + e.message));
      return;
    }
    if (!items.length) {
      listBox.appendChild(el('p', { class: 'text-muted' }, 'ごみ箱は空です'));
      return;
    }
    const list = el('ul', { class: 'list' });
    for (const item of items) {
      const label = item.name || `${item.coll}/${item.id}`;
      list.appendChild(el('li', { class: 'list-row' }, [
        el('span', {}, label),
        el('button', { type: 'button', class: 'btn btn-small', onClick: async () => {
          try {
            await ctx.store.restoreTrash({ coll: item.coll, id: item.id, name: item.name });
            ctx.toast('復元しました', 'success');
            reload();
          } catch (e) {
            ctx.toast('復元に失敗しました: ' + e.message, 'error');
          }
        } }, '復元')
      ]));
    }
    listBox.appendChild(list);
  }

  await reload();
  return section;
}
