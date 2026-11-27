(function (root) {
  'use strict';
  const text = value => value == null ? '' : String(value);
  function conflict(currentValue) {
    const error = new Error('Данные изменились у другого сотрудника. Ваш текст остался в форме.');
    error.code = 'warehouse/conflict';
    error.currentValue = text(currentValue);
    return error;
  }
  async function saveComparedValue(ref, expectedValue, nextValue) {
    // Keep this location's cache alive until the transaction finishes. A lone
    // once() listener detaches before its promise resumes, so a cold-cache
    // transaction could otherwise receive null and falsely report a conflict.
    const listener = () => {};
    ref.on('value', listener);
    try {
      const latest = await ref.once('value');
      if (text(latest.val()) !== text(expectedValue)) throw conflict(latest.val());
      const result = await ref.transaction(current => {
        if (text(current) !== text(expectedValue)) return;
        return text(nextValue);
      }, undefined, false);
      if (!result.committed) throw conflict(result.snapshot.val());
      return result.snapshot.val();
    } finally {
      ref.off('value', listener);
    }
  }
  function planCellEdit({ address, previousValue, nextValue, metadata, keyForLine, now }) {
    const lines = value => text(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const before = new Set(lines(previousValue)), after = new Set(lines(nextValue));
    const nextMetadata = { ...metadata }, metadataUpdates = {}, events = [];
    for (const line of after) {
      if (before.has(line)) continue;
      const key = keyForLine(address, line);
      const meta = metadata[key] || { addedAt: now, updatedAt: null };
      nextMetadata[key] = meta;
      metadataUpdates['itemMeta/' + key] = meta;
      events.push({ type: 'add', detail: line, article: line, address, addedAt: meta.addedAt });
    }
    for (const line of before) {
      if (after.has(line)) continue;
      const key = keyForLine(address, line);
      delete nextMetadata[key];
      metadataUpdates['itemMeta/' + key] = null;
      events.push({ type: 'remove', detail: line, article: line, address });
    }
    if (!events.length && text(previousValue) !== text(nextValue)) {
      for (const line of after) {
        const key = keyForLine(address, line);
        if (!metadata[key]) continue;
        const meta = { ...metadata[key], updatedAt: now };
        nextMetadata[key] = meta;
        metadataUpdates['itemMeta/' + key] = meta;
      }
      events.push({ type: 'edit', detail: 'Изменено содержимое ячейки', address,
        oldValue: text(previousValue), newValue: text(nextValue) });
    }
    return { nextMetadata, metadataUpdates, events };
  }
  const api = { saveComparedValue, planCellEdit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WarehouseEdits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
