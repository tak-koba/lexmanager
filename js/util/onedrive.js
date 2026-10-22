// web/js/util/onedrive.js
// iPhone版（ローカルモード）とOneDrive（Microsoft Graph）の接続。自動同期（web/js/autosync.js）で使う。DESIGN.md §14
// - ログインは OAuth 2.0 認可コード + PKCE（秘密情報なし。Azureに「シングルページアプリ」として登録したアプリID を使う）
// - 個人用Microsoftアカウント（consumers）。Microsoftの決まりで、このログインは24時間で切れる → 再ログイン（通常は1タップ）
// - ファイルの読み出しは @microsoft.graph.downloadUrl 経由（/content はブラウザから読めないため。Microsoftの公式手順）

const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Files.ReadWrite offline_access';
const PKCE_KEY = 'lm_od_pkce';

export const DEFAULT_ROOT = 'Business/個人事件/#顧客管理/LexManagerData';

export class ReauthError extends Error {}

export function redirectUri() {
  return location.origin + location.pathname;
}

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

/** Microsoftのログイン画面へ移る（戻り先はこのアプリ自身）。 */
export async function startLogin(clientId) {
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, clientId, returnHash: location.hash || '#/settings' }));
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state
  });
  location.href = `${AUTH}/authorize?${q}`;
}

/** ログイン画面から戻ってきたところなら、その内容（code/state/error）を返す。 */
export function pendingCallback() {
  const q = new URLSearchParams(location.search);
  if (!q.get('code') && !q.get('error')) return null;
  return { code: q.get('code'), state: q.get('state'), error: q.get('error'), description: q.get('error_description') };
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error_description || body.error || `HTTP ${res.status}`;
    if (body.error === 'invalid_grant' || body.error === 'interaction_required') throw new ReauthError(msg);
    throw new Error(msg);
  }
  return {
    accessToken: body.access_token, refreshToken: body.refresh_token,
    accessExpiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000
  };
}

/** 戻ってきた認可コードを鍵（トークン）に交換し、アドレス欄から code を消す。返り値: {clientId, accessToken, refreshToken, accessExpiresAt} */
export async function finishLogin(cb) {
  const saved = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  localStorage.removeItem(PKCE_KEY);
  history.replaceState(null, '', redirectUri() + ((saved && saved.returnHash) || '#/settings'));
  if (cb.error) throw new Error(`ログインできませんでした（${cb.description || cb.error}）`);
  if (!saved || saved.state !== cb.state) throw new Error('ログインの手続きが見つかりません。もう一度［Microsoftでログイン］を押してください');
  const tok = await tokenRequest({
    client_id: saved.clientId, grant_type: 'authorization_code', code: cb.code,
    redirect_uri: redirectUri(), code_verifier: saved.verifier, scope: SCOPE
  });
  return { clientId: saved.clientId, ...tok };
}

/** 更新用の鍵で新しい鍵をもらう（使うたびに更新用の鍵も新しくなる）。切れていれば ReauthError。 */
export function refreshTokens(clientId, refreshToken) {
  return tokenRequest({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE });
}

/** OneDrive上の場所（データフォルダ＋相対パス）→ Graph のパス指定。「#」などは1区切りずつエンコードする。 */
export function itemPath(root, rel) {
  const parts = [...String(root || DEFAULT_ROOT).split('/'), ...String(rel).split('/')].filter(Boolean);
  return `/me/drive/root:/${parts.map(encodeURIComponent).join('/')}:`;
}

async function graph(token, method, path, { body, headers, query } = {}) {
  const res = await fetch(GRAPH + path + (query ? `?${query}` : ''), {
    method, body, headers: { Authorization: `Bearer ${token}`, ...(headers || {}) }
  });
  if (res.status === 404) return null;
  if (res.status === 401) throw new ReauthError('OneDriveへの再ログインが必要です');
  if (!res.ok) throw new Error(`OneDriveの操作に失敗しました（HTTP ${res.status}）`);
  return res.status === 204 ? {} : res.json();
}

/** ファイルの情報（なければ null）。更新日時と、読み出し用の一時アドレスを含む。 */
export function getItem(token, path) {
  return graph(token, 'GET', path, { query: 'select=id,lastModifiedDateTime,@microsoft.graph.downloadUrl' });
}

/** 一時アドレスからファイルの中身を読む（認証ヘッダーは付けない） */
export async function downloadText(item) {
  const url = item && item['@microsoft.graph.downloadUrl'];
  if (!url) throw new Error('OneDriveのファイルを読めませんでした');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OneDriveのファイルを読めませんでした（HTTP ${res.status}）`);
  return res.text();
}

/** ファイルを書く（4MBまで。変更データは小さいので足りる） */
export function putText(token, path, text) {
  return graph(token, 'PUT', `${path}/content`, { body: text, headers: { 'Content-Type': 'application/json' } });
}
