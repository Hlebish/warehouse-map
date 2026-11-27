const test = require('node:test');
const assert = require('node:assert/strict');
const { saveComparedValue, planCellEdit } = require('../warehouse-edits.js');

function ref(initial, { race, reject } = {}) {
  let value = initial, calls = 0, listening = false, detached = 0;
  return {
    on(event, listener) { assert.equal(event, 'value'); listening = true; this.listener = listener; },
    off(event, listener) { assert.equal(event, 'value'); assert.equal(listener, this.listener); listening = false; detached++; },
    once: async () => ({ val: () => value }),
    async transaction(update, complete, applyLocally) {
      calls++;
      assert.equal(listening, true, 'transaction must retain its cache listener');
      assert.equal(applyLocally, false);
      if (reject) throw reject;
      if (race !== undefined) value = race;
      const next = update(value);
      if (next !== undefined) value = next;
      return { committed: next !== undefined, snapshot: { val: () => value } };
    },
    get value() { return value; }, get calls() { return calls; }, get detached() { return detached; }
  };
}

test('saves an unchanged baseline and returns the committed value', async () => {
  const cell = ref('A');
  assert.equal(await saveComparedValue(cell, 'A', 'A\nB'), 'A\nB');
  assert.equal(cell.value, 'A\nB');
  assert.equal(cell.detached, 1);
});
test('does not overwrite an edit received before saving', async () => {
  const cell = ref('A\nother');
  await assert.rejects(saveComparedValue(cell, 'A', 'mine'), error =>
    error.code === 'warehouse/conflict' && error.currentValue === 'A\nother');
  assert.equal(cell.calls, 0);
  assert.equal(cell.value, 'A\nother');
  assert.equal(cell.detached, 1);
});
test('transaction retry protects an edit arriving after the initial read', async () => {
  const cell = ref('A', { race: 'A\nother' });
  await assert.rejects(saveComparedValue(cell, 'A', 'mine'), { code: 'warehouse/conflict' });
  assert.equal(cell.value, 'A\nother');
});
test('Firebase write errors remain failures and do not change the cell', async () => {
  const cell = ref('A', { reject: new Error('permission denied') });
  await assert.rejects(saveComparedValue(cell, 'A', 'mine'), /permission denied/);
  assert.equal(cell.value, 'A');
  assert.equal(cell.detached, 1);
});
test('empty Firebase values can be edited', async () => {
  const cell = ref(null);
  assert.equal(await saveComparedValue(cell, '', 'A'), 'A');
});
test('metadata changes only touch edited lines and never mutate the source cache', () => {
  const keyForLine = (address, line) => address + ':' + line;
  const metadata = { 'S2-A-3:A': { addedAt: 1 }, 'S3-B-4:X': { addedAt: 2 } };
  const original = structuredClone(metadata);
  const plan = planCellEdit({ address: 'S2-A-3', previousValue: 'A', nextValue: 'B',
    metadata, keyForLine, now: 10 });
  assert.deepEqual(metadata, original);
  assert.deepEqual(plan.metadataUpdates, {
    'itemMeta/S2-A-3:B': { addedAt: 10, updatedAt: null }, 'itemMeta/S2-A-3:A': null
  });
  assert.deepEqual(plan.nextMetadata['S3-B-4:X'], { addedAt: 2 });
  assert.deepEqual(plan.events.map(event => event.type), ['add', 'remove']);
});
test('a formatting-only edit preserves original addedAt', () => {
  const plan = planCellEdit({ address: 'a', previousValue: 'A\nB', nextValue: 'B\nA',
    metadata: { A: { addedAt: 1 }, B: { addedAt: 2 } }, keyForLine: (_, line) => line, now: 10 });
  assert.equal(plan.nextMetadata.A.addedAt, 1);
  assert.equal(plan.nextMetadata.A.updatedAt, 10);
  assert.equal(plan.events[0].type, 'edit');
});
