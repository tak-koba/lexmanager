// web/js/util/zip.js
// 郵便番号検索（サーバー経由 / ローカル直接fetch）とマップ・逆引きURL生成。

/**
 * @param {string} code 7桁の郵便番号（ハイフン等含んでいてもよい）
 * @param {'server'|'local'} mode
 * @returns {Promise<Array<{pref:string, city:string, town:string}>|null>}
 */
export async function lookupZip(code, mode) {
  const digits = String(code || '').replace(/\D/g, '');
  if (!digits) return [];

  if (mode === 'server') {
    try {
      const res = await fetch(`./api/zip?code=${digits}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!data || !data.ok) return [];
      return data.results || [];
    } catch (err) {
      return [];
    }
  }

  // mode === 'local'
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.results)) return null;
    return data.results.map((r) => ({
      pref: r.address1 || '',
      city: r.address2 || '',
      town: r.address3 || '',
    }));
  } catch (err) {
    return null;
  }
}

/**
 * @param {string} addr
 * @returns {string} Googleマップ検索URL
 */
export function googleMapsUrl(addr) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr || '')}`;
}

/**
 * 住所→郵便番号の逆引き（Google検索を別タブで開く）
 * @param {string} addr
 * @returns {string}
 */
export function addressSearchUrl(addr) {
  return `https://www.google.com/search?q=${encodeURIComponent((addr || '') + ' 郵便番号')}`;
}
