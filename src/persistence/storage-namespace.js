// Find an earlier same-origin namespace without embedding retired product names.
// Ambiguous sources require recovery instead of silently choosing a library.
export function storageKey(storage, preferred) {
  if (storage.getItem(preferred) != null) return preferred;
  const suffix = preferred.slice(preferred.indexOf(':'));
  const matches = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.endsWith(suffix)) matches.push(key);
  }
  if (matches.length > 1) throw new Error('Ambiguous browser storage');
  return matches[0] ?? preferred;
}
