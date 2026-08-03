// Minimal in-memory stand-in for a KV namespace binding. The rate-limit and
// generation-slot helpers only ever call get()/put() and read the record
// values they wrote themselves, so a bare Map is enough — no need to model
// KV's real eventual-consistency or expiration behavior for these tests.
export function createTestKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    _store: store,
  };
}
