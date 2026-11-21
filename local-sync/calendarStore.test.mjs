import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCalendarStore } from './calendarStore.mjs';

test('calendar uploads persist independently per source and replay lost responses safely', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-calendar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createCalendarStore(dir);
  const now = Date.now();
  const upload = { sourceId: 'phone-a', requestId: 'one', baseRevision: 0, rangeStart: now, rangeEnd: now + 86400_000, calendarAvailable: true, complete: true, fetchedAt: now, events: [] };
  const first = store.upload(upload);
  assert.equal(first.revision, 1);
  assert.deepEqual(createCalendarStore(dir).upload(upload), first);
  assert.throws(() => store.upload({ ...upload, fetchedAt: now + 1 }), /operation_reused/);
  store.upload({ ...upload, sourceId: 'phone-b', requestId: 'two' });
  assert.equal(store.read().length, 2);
  fs.writeFileSync(path.join(dir, 'calendar.json'), '{broken');
  assert.throws(() => createCalendarStore(dir));
  assert.equal(fs.readFileSync(path.join(dir, 'calendar.json'), 'utf8'), '{broken');
});
