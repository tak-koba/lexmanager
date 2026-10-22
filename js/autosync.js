// web/js/autosync.js
// iPhone版の自動同期（OneDrive経由）。DESIGN.md §14
// 1. この端末の変更があれば mobile/inbox に書き出す（PCが1分ごとに取り込み、processed へ移す）
// 2. 書き出したファイルがPCに取り込まれた（inbox から消えた）かを確かめる
// 3. 取り込み待ちがなく、PCのデータ（mobile/snapshot.json）が新しくなっていれば読み込む
//    （この端末の未送信の変更を、古いPCデータで上書きしないため。shouldImportSnapshot 参照）
//    ダウンロード中に変更が入ることがあるので、読み込む直前（store.importSnapshot の中でも）もう一度確かめる
import { ReauthError, refreshTokens, itemPath, getItem, downloadText, putText } from './util/onedrive.js';

const t = (iso) => (iso ? new Date(iso).getTime() : 0);

/**
 * PCのデータを読み込んでよいか。
 * - この端末に未送信の変更がない
 * - 送った変更がすべてPCに取り込まれた（inbox から消えた）
 * - PCのデータが前回読み込んだものと違い、かつ最後に変更を送った時刻より新しい（取り込み後に作り直されたもの）
 */
export function shouldImportSnapshot({ hasUnexported, waitingUploads, snapshotModified, lastSnapshotModified, lastSentAt }) {
  if (hasUnexported || waitingUploads > 0 || !snapshotModified) return false;
  if (snapshotModified === lastSnapshotModified) return false;
  return t(snapshotModified) > t(lastSentAt);
}

export class AutoSync {
  constructor(store, { onStatus } = {}) {
    this.store = store;
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.timer = null;
  }

  connected() {
    const od = this.store.getOd();
    return !!(od.clientId && od.refreshToken);
  }

  /** 保存のたびに呼ぶ（数秒まとめてから同期） */
  soon(ms = 4000) {
    if (!this.connected()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  async token() {
    const od = this.store.getOd();
    if (od.accessToken && Date.now() < (od.accessExpiresAt || 0) - 60000) return od.accessToken;
    const tok = await refreshTokens(od.clientId, od.refreshToken);
    if (!tok.refreshToken) delete tok.refreshToken; // 新しい更新用の鍵が来なければ今のものを使い続ける
    await this.store.setOd({ ...tok, needLogin: false });
    return tok.accessToken;
  }

  /** 1回分の同期。結果は store の od.lastSync / lastError / needLogin に残す */
  async run() {
    if (this.running || !this.connected() || (this.store.isLocked && this.store.isLocked())) return null;
    if (this.store.isStale && this.store.isStale()) return null; // 別の画面で更新された（開き直すまで同期しない）
    if (!navigator.onLine) return null;
    this.running = true;
    const result = { sent: 0, imported: false };
    try {
      const token = await this.token();
      const od = this.store.getOd();
      const root = od.root;
      let uploads = [...(od.uploads || [])];

      // 1. この端末の変更を送る（PCが取り込むまで同じ内容でも残る。名前は毎回別にする）
      if (await this.store.hasUnexportedChanges()) {
        const ex = this.store.exportPayload();
        const name = `${ex.filename.replace(/\.json$/, '')}-${Date.now()}-auto.json`;
        await putText(token, itemPath(root, `mobile/inbox/${name}`), JSON.stringify(ex.payload));
        await this.store.markExported(ex);
        uploads.push({ name, at: new Date().toISOString() });
        result.sent = ex.count;
        await this.store.setOd({ uploads, lastSentAt: new Date().toISOString() });
      }

      // 2. PCに取り込まれた（inbox から消えた）ものは待ち一覧から外す
      const still = [];
      for (const u of uploads) {
        if (await getItem(token, itemPath(root, `mobile/inbox/${u.name}`))) still.push(u);
      }
      uploads = still;
      await this.store.setOd({ uploads });

      // 3. PCのデータを読み込む（条件は shouldImportSnapshot）
      const snap = await getItem(token, itemPath(root, 'mobile/snapshot.json'));
      const info = this.store.getSyncInfo();
      const ok = shouldImportSnapshot({
        hasUnexported: await this.store.hasUnexportedChanges(), waitingUploads: uploads.length,
        snapshotModified: snap && snap.lastModifiedDateTime, lastSnapshotModified: this.store.getOd().snapshotModified,
        lastSentAt: [this.store.getOd().lastSentAt, info.lastExportAt].sort().pop()
      });
      if (ok) {
        const text = await downloadText(snap);
        // ダウンロードしている間に、この端末で変更されていたら読み込まない（次回の同期で先に送る）
        if (!(await this.store.hasUnexportedChanges())) {
          const r = await this.store.importSnapshot({ text: async () => text }, { onlyIfNoUnexported: true });
          if (!(r && r.skipped)) {
            await this.store.setOd({ snapshotModified: snap.lastModifiedDateTime });
            result.imported = true;
          }
        }
      }
      // PCのGoogleカレンダー連携の状態（設定画面の表示用。読めなくても同期は成功扱い）
      try {
        const g = await getItem(token, itemPath(root, 'gcal/status.json'));
        if (g) await this.store.setOd({ gcal: JSON.parse(await downloadText(g)) });
      } catch (e) { /* 表示用なので無視 */ }
      await this.store.setOd({ lastSync: new Date().toISOString(), lastError: '', waiting: uploads.length });
    } catch (e) {
      const needLogin = e instanceof ReauthError;
      await this.store.setOd({ lastError: needLogin ? '' : String(e.message || e), needLogin: needLogin || this.store.getOd().needLogin });
    } finally {
      this.running = false;
      this.onStatus(this.store.getOd(), result);
    }
    return result;
  }
}
