// LexManager 4 - server-backed storage adapter (talks to the local Python server).

import { ConflictError } from './api.js';

const POLL_MS = 5000;

export class ServerStore {
  constructor() {
    this.capabilities = {
      ai: true,
      csv: true,
      update: true,
      migrate: true,
      trash: true,
      conflicts: true,
      mobileImport: true
    };
    this._lastStamp = null;
    this._pollTimer = null;
    this._changeCbs = [];
  }

  async init() {
    const m = await this.meta();
    return m;
  }

  async _req(path, opts) {
    const res = await fetch(path, opts);
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    if (!res.ok) {
      const err = new Error((body && body.error) || `HTTPエラー (${res.status})`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  async meta() {
    return this._req('./api/meta');
  }

  async all() {
    const data = await this._req('./api/all');
    this._lastStamp = data.stamp;
    return { clients: data.clients || [], cases: data.cases || [], todos: data.todos || [] };
  }

  async create(coll, record) {
    const data = await this._req(`./api/${coll}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record })
    });
    return data.record;
  }

  async update(coll, record, base) {
    let data;
    try {
      data = await this._req(`./api/${coll}/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record, base })
      });
    } catch (err) {
      if (err.status === 409 && err.body && err.body.conflict) {
        throw new ConflictError(err.body.conflict.current, err.body.conflict.fields);
      }
      throw err;
    }
    return { record: data.record, merged: !!data.merged };
  }

  async remove(coll, record) {
    return this._req(`./api/${coll}/${record.id}?rev=${encodeURIComponent(record.rev)}`, {
      method: 'DELETE'
    });
  }

  async uploadFile(file) {
    const data = await this._req('./api/files', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(file.name) },
      body: file
    });
    return data.file;
  }

  fileUrl(ref) {
    return `./files/${ref.filename}`;
  }

  onChange(cb) {
    this._changeCbs.push(cb);
    if (!this._pollTimer) {
      this._pollTimer = setInterval(() => this._poll(), POLL_MS);
    }
    return () => {
      this._changeCbs = this._changeCbs.filter((c) => c !== cb);
    };
  }

  async _poll() {
    try {
      const data = await this._req('./api/stamp');
      if (this._lastStamp !== null && data.stamp !== this._lastStamp) {
        this._lastStamp = data.stamp;
        this._changeCbs.forEach((cb) => {
          try {
            cb();
          } catch (e) {
            // ignore listener errors
          }
        });
      } else if (this._lastStamp === null) {
        this._lastStamp = data.stamp;
      }
    } catch (e) {
      // network hiccup - ignore, try again next tick
    }
  }

  // --- 設定・ツール系 ---

  async getSettings() {
    return this._req('./api/settings');
  }

  async postSettings(partial) {
    return this._req('./api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial)
    });
  }

  async getTrash() {
    return this._req('./api/trash');
  }

  async restoreTrash({ coll, id, name }) {
    return this._req('./api/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coll, id, name })
    });
  }

  async getConflicts() {
    return this._req('./api/conflicts');
  }

  async resolveConflict(payload) {
    return this._req('./api/conflicts/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async getMobileStatus() {
    return this._req('./api/mobile/status');
  }

  async importMobile() {
    return this._req('./api/mobile/import', { method: 'POST' });
  }

  async aiExtract(payload) {
    return this._req('./api/ai/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async zipLookup(code) {
    return this._req(`./api/zip?code=${encodeURIComponent(code)}`);
  }

  exportCsvUrl(target, ids) {
    let url = `./api/export/csv?target=${encodeURIComponent(target)}`;
    if (ids && ids.length) {
      url += `&ids=${encodeURIComponent(ids.join(','))}`;
    }
    return url;
  }

  exportJsonUrl() {
    return './api/export/json';
  }

  async migrationStatus() {
    return this._req('./api/migration/status');
  }

  async migrationRun() {
    return this._req('./api/migration/run', { method: 'POST' });
  }

  async updateStatus() {
    return this._req('./api/update/status');
  }

  async updateApply() {
    return this._req('./api/update/apply', { method: 'POST' });
  }
}
