import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

test('ledger, workplaces, courses and trips are operable through safe agent tools', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-agent-modules-'));
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: dir, SHUNSHOU_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway startup timeout')), 10000);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('gateway exited')); });
  });
  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const { token: session } = await login.json();
  const created = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '模块测试', scope: 'write' }) });
  const { token } = await created.json();
  const invoke = async (tool, args, key) => {
    const response = await fetch(`${url}/api/v1/agent/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify({ tool, arguments: args }),
    });
    return { status: response.status, body: await response.json() };
  };
  const ok = async (tool, args, key) => {
    const result = await invoke(tool, args, key);
    assert.equal(result.status, 200, `${tool}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.ok, true);
    return result.body.result;
  };
  const today = new Date();
  const todayKey = dayKey(today);
  const tomorrowKey = dayKey(new Date(today.getTime() + 86400_000));
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const mondayKey = dayKey(monday);
  const sundayKey = dayKey(new Date(monday.getTime() + 6 * 86400_000));

  const manifest = await (await fetch(`${url}/api/v1/agent/manifest`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.ok(manifest.tools.some((tool) => tool.name === 'ledger_add_expense'));
  assert.ok(manifest.tools.some((tool) => tool.name === 'trips_add_packing'));
  assert.equal(manifest.tools.some((tool) => /delete/.test(tool.name)), false);

  assert.deepEqual((await ok('ledger_workplaces')), { workplaces: [] });
  const unit = await ok('workplaces_add', { name: '图书馆', hourlyRateYuan: 25, description: '整理书架' }, 'unit-0001');
  const unitId = unit.workplace.id;
  assert.equal(unit.workplace.hourlyRateCents, 2500);
  const unitAgain = await ok('workplaces_add', { name: '图书馆', hourlyRateYuan: 25, description: '整理书架' }, 'unit-0001');
  assert.equal(unitAgain.workplace.id, unitId);
  assert.equal((await ok('ledger_workplaces')).workplaces.length, 1);
  assert.equal((await ok('workplaces_update', { id: unitId, hourlyRateYuan: 30 }, 'unit-update-1')).workplace.hourlyRateCents, 3000);

  const expense = await ok('ledger_add_expense', { title: '午饭', amountYuan: 18.5, category: '吃饭', date: todayKey }, 'expense-1');
  const expenseId = expense.record.id;
  assert.equal(expense.record.amountCents, 1850);
  const expenseAgain = await ok('ledger_add_expense', { title: '午饭', amountYuan: 18.5, category: '吃饭', date: todayKey }, 'expense-1');
  assert.equal(expenseAgain.record.id, expenseId);
  assert.equal((await invoke('ledger_add_expense', { title: '改了', amountYuan: 20, category: '吃饭', date: todayKey }, 'expense-1')).status, 409);
  assert.equal((await ok('ledger_update_expense', { id: expenseId, amountYuan: 20 }, 'expense-update-1')).record.amountCents, 2000);

  const work = await ok('ledger_add_work', { workplaceId: unitId, title: '整理书架', date: todayKey, startTime: '09:00', endTime: '12:30' }, 'work-0001');
  const workId = work.record.id;
  assert.equal(work.record.durationMinutes, 210);
  assert.equal(work.record.hourlyRateCents, 3000);
  assert.equal(work.record.amountCents, 10500);
  const workAgain = await ok('ledger_add_work', { workplaceId: unitId, title: '整理书架', date: todayKey, startTime: '09:00', endTime: '12:30' }, 'work-0001');
  assert.equal(workAgain.record.id, workId);
  const updatedWork = await ok('ledger_update_work', { id: workId, endTime: '13:00' }, 'work-update-1');
  assert.equal(updatedWork.record.durationMinutes, 240);
  assert.equal(updatedWork.record.amountCents, 12000);
  const records = await ok('ledger_records', { from: todayKey, to: todayKey, type: 'work' });
  assert.equal(records.items[0].workplaceName, '图书馆');
  const month = await ok('ledger_monthly', { month: todayKey.slice(0, 7) });
  assert.equal(month.incomeCents, 12000);
  assert.equal(month.expenseCents, 2000);
  assert.equal(month.byWorkplace[0].name, '图书馆');

  const course = await ok('courses_create', { title: '英语', semesterStart: mondayKey, weekday: 3, startTime: '14:00', endTime: '16:00', firstWeek: 1, lastWeek: 16, parity: 'all', location: 'A101' }, 'course-1');
  const courseId = course.course.id;
  assert.equal(course.course.title, '英语');
  const timeline = await ok('schedule_list', { from: mondayKey, to: sundayKey });
  const english = timeline.items.find((item) => item.title === '英语' && item.kind === 'course');
  assert.ok(english);
  assert.match(english.start, /T14:00:00\+08:00$/);
  assert.match(english.end, /T16:00:00\+08:00$/);
  assert.equal((await ok('courses_update', { id: courseId, location: 'B202' }, 'course-update-1')).course.location, 'B202');

  const trip = await ok('trips_create', { title: '上海周末', startDate: todayKey, endDate: tomorrowKey, notes: '看展' }, 'trip-0001');
  const tripId = trip.trip.id;
  assert.equal(trip.trip.days.length, 2);
  const dayItem = await ok('trips_add_day_item', { tripId, date: tomorrowKey, text: '外滩' }, 'trip-day-1');
  assert.equal(dayItem.item.text, '外滩');
  const packing = await ok('trips_add_packing', { tripId, text: '充电器' }, 'trip-pack-1');
  await ok('trips_set_packing', { tripId, itemId: packing.item.id, checked: true }, 'trip-pack-check-1');
  await ok('trips_add_visit', { tripId, city: '上海', date: tomorrowKey, visited: true }, 'trip-visit-1');
  const detail = await ok('trips_get', { id: tripId });
  assert.equal(detail.trip.title, '上海周末');
  assert.ok(detail.trip.days.find((day) => day.date === tomorrowKey).items.some((item) => item.text === '外滩'));
  assert.equal(detail.trip.packing[0].checked, true);
  assert.equal(detail.trip.visits[0].city, '上海');
  const list = await ok('trips_list');
  assert.equal(list.trips[0].title, '上海周末');
  const updatedTrip = await ok('trips_update', { id: tripId, title: '上海两日', notes: '看展和散步' }, 'trip-update-1');
  assert.equal(updatedTrip.trip.title, '上海两日');
  const conflict = await invoke('trips_update', { id: tripId, endDate: todayKey }, 'trip-update-2');
  assert.equal(conflict.status, 400);
  assert.match(conflict.body.message, /范围外/);

  const audit = await (await fetch(`${url}/api/agent/audit`, { headers: { Authorization: `Bearer ${session}` } })).json();
  assert.ok(audit.entries.some((entry) => entry.tool === 'ledger_add_work' && entry.ok));
});
