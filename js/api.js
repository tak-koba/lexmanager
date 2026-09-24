// LexManager 4 - storage adapter selection.
// Tries the local server first; falls back to the in-browser (IndexedDB) store.

export class ConflictError extends Error {
  constructor(current, fields) {
    super('競合');
    this.name = 'ConflictError';
    this.current = current;
    this.fields = fields;
  }
}

export async function getStore() {
  let serverAvailable = false;
  try {
    const res = await fetch('./api/meta', { signal: AbortSignal.timeout(1500) });
    serverAvailable = !!(res && res.ok);
  } catch (e) {
    serverAvailable = false;
  }

  if (serverAvailable) {
    const mod = await import('./store-server.js');
    const store = new mod.ServerStore();
    await store.init();
    return store;
  }

  const mod = await import('./store-local.js');
  const store = new mod.LocalStore();
  await store.init();
  return store;
}
