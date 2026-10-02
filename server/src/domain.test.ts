import test from 'node:test'; import assert from 'node:assert/strict';
import { ledger } from './ledger.js';
import type { ReplayedContainer, ReplayedTask, ReplayedVoyage } from './domain.js';
import {
  assignTask, containerPlan, createContainer, createGateAppointment, createYardTask, dashboard, deleteContainer,
  deleteGateAppointment, deleteYardTask, editGateAppointment, gateConflicts, LedgerError, prioritizeTasks,
  queryEvents, replayEntity, submitEvent, tasks, updateContainer, updateYardTask,
} from './domain.js';

test('dashboard aggregates berth, yard, gate and exception signals', () => { const data = dashboard(); assert.equal(data.activeVoyages, 2); assert.ok(data.yardUtilization > 0.7); assert.ok(data.blockedTasks >= 1); });
test('gate conflict engine detects same truck overlap', () => { const conflicts = gateConflicts(); assert.ok(conflicts.some(item => item.appointmentId === 'APT-9001' || item.appointmentId === 'APT-9004')); });
test('yard planner respects reefer and hazmat constraints', () => { const plan = containerPlan('TGHU-9831204'); assert.equal(plan?.recommendedBlock?.hazmatAllowed, true); assert.ok(plan?.reasons.some(reason => reason.includes('危险品'))); });
test('priority queue promotes customs inspection work', () => { const ordered = prioritizeTasks(); assert.equal(ordered[0].containerId, 'TGHU-9831204'); });

test('container create, update and delete form a complete audited CRUD cycle', () => {
  const created = createContainer({ id: 'TEST-CRUD-0001', voyageId: 'VOY-AX7', size: '20', isoType: '22G1', direction: 'import', status: 'in-yard', weightT: 10, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R11-T1' })!;
  assert.equal(created.id, 'TEST-CRUD-0001');
  assert.equal(updateContainer(created.id, { weightT: 12 })?.weightT, 12);
  assert.equal(deleteContainer(created.id)?.id, 'TEST-CRUD-0001');
});

test('appointment and task domain operations support create, update and delete', () => {
  const appointment = createGateAppointment({ containerId: 'MSCU-4829017', truckNo: 'TEST-CRUD-01', driver: '测试司机', type: 'pickup', windowStart: new Date(Date.now()+3600000).toISOString(), windowEnd: new Date(Date.now()+7200000).toISOString(), lane: 'north' })!;
  assert.equal(editGateAppointment(appointment.id, { driver: '更新司机' })?.driver, '更新司机');
  assert.equal(deleteGateAppointment(appointment.id)?.id, appointment.id);
  const task = createYardTask({ kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01-R01-T1', to: '南闸口', priority: 40, scheduledAt: new Date().toISOString(), estimatedMinutes: 12 })!;
  assert.equal(updateYardTask(task.id, { to: '北闸口' })?.to, '北闸口');
  assert.equal(deleteYardTask(task.id)?.id, task.id);
});

// ---------------------------------------------------------------------------
// 不可变作业事件账本
// ---------------------------------------------------------------------------

test('种子账本可以回放箱子从卸船到待闸口/查验挂起的完整操作流', () => {
  const hot = replayEntity('container', 'MSCU-4829017');
  assert.ok(hot.eventCount >= 9);
  const types = hot.timeline.map(s => s.type);
  assert.ok(types.includes('container.slot-changed'));
  assert.ok(types.includes('task.replanned'));
  assert.deepEqual((hot.current as ReplayedContainer).status, 'in-yard');
  assert.deepEqual((hot.current as ReplayedContainer).yardSlot, 'A01-R07-T3');
  assert.equal(hot.consistent, true, `回放视图与内存基线不一致：${hot.mismatches.join('；')}`);

  const hazmat = replayEntity('container', 'TGHU-9831204');
  const hazmatTypes = hazmat.timeline.map(s => s.type);
  assert.ok(hazmatTypes.filter(t => t === 'container.slot-changed').length >= 2, '危险品箱至少发生两次换堆位');
  assert.deepEqual((hazmat.current as ReplayedContainer).status, 'hold');
  assert.deepEqual((hazmat.current as ReplayedContainer).customs, 'inspection');
  assert.deepEqual((hazmat.current as ReplayedContainer).yardSlot, 'D05-R02-T1');
  assert.equal(hazmat.consistent, true, `危险品箱回放不一致：${hazmat.mismatches.join('；')}`);
});

test('任务、预约、航次回放视图均与内存基线一致', () => {
  for (const id of ['TASK-101', 'TASK-102', 'TASK-103', 'TASK-104']) {
    const view = replayEntity('task', id);
    assert.equal(view.consistent, true, `任务 ${id} 回放不一致：${view.mismatches.join('；')}`);
  }
  for (const id of ['APT-9001', 'APT-9002', 'APT-9003', 'APT-9004']) {
    const view = replayEntity('appointment', id);
    assert.equal(view.consistent, true, `预约 ${id} 回放不一致：${view.mismatches.join('；')}`);
  }
  for (const id of ['VOY-AX7', 'VOY-QF2', 'VOY-RD8']) {
    const view = replayEntity('voyage', id);
    assert.equal(view.consistent, true, `航次 ${id} 回放不一致：${view.mismatches.join('；')}`);
  }
  const ax7 = replayEntity('voyage', 'VOY-AX7');
  assert.deepEqual((ax7.current as ReplayedVoyage).movesDone, 886);
});

test('事件查询支持按实体、时间范围和事件类型过滤', () => {
  const all = queryEvents({ entity: 'container', entityId: 'TGHU-9831204' });
  const moves = queryEvents({ entity: 'container', entityId: 'TGHU-9831204', types: ['container.slot-changed'] });
  assert.ok(moves.length >= 2);
  assert.ok(moves.every(e => e.type === 'container.slot-changed'));
  const future = queryEvents({ entity: 'container', entityId: 'TGHU-9831204', from: new Date(Date.now() + 10_000_000).toISOString() });
  assert.equal(future.length, 0);
  const customsOnly = queryEvents({ types: ['container.customs-changed'], source: 'customs' });
  assert.ok(customsOnly.length >= 2);
  assert.ok(customsOnly.every(e => ['TGHU-9831204', 'TEMU-1774029'].includes(e.entityId)));
  assert.ok(all.length >= moves.length);
});

test('重复提交同一事件 id / 幂等键不会制造两次状态变化', () => {
  const before = queryEvents({ types: ['container.status-changed'] }).length;
  const id = 'EVT-IDEMPOTENT-0001';
  const payload = { from: 'in-yard', to: 'hold' };
  const first = submitEvent({ id, type: 'container.status-changed', entityId: 'MSCU-4829017', payload });
  assert.equal(first.duplicate, false);
  const second = submitEvent({ id, type: 'container.status-changed', entityId: 'MSCU-4829017', payload });
  assert.equal(second.duplicate, true);
  assert.equal(second.event.id, first.event.id);

  const before2 = queryEvents({ types: ['container.customs-changed'] }).length;
  const opts = { type: 'container.customs-changed' as const, entityId: 'MSCU-4829017', payload: { from: 'released', to: 'hold' }, idempotencyKey: 'key-0001' };
  const a = submitEvent(opts); const b = submitEvent(opts);
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true);
  assert.equal(queryEvents({ types: ['container.customs-changed'] }).length, before2 + 1);
  assert.equal(queryEvents({ types: ['container.status-changed'] }).length, before + 1);
  // 恢复现场，避免污染其他用例的一致性断言
  submitEvent({ type: 'container.status-changed', entityId: 'MSCU-4829017', payload: { from: 'hold', to: 'in-yard' }, idempotencyKey: 'key-restore-1' });
  submitEvent({ type: 'container.customs-changed', entityId: 'MSCU-4829017', payload: { from: 'hold', to: 'released' }, idempotencyKey: 'key-restore-2' });
  assert.equal(replayEntity('container', 'MSCU-4829017').consistent, true);
});

test('事件乱序默认拒绝并给出可见错误，显式允许时标记 out-of-order 仍可回放', () => {
  const oldAt = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  assert.throws(() => submitEvent({ type: 'container.status-changed', entityId: 'EISU-1288420', at: oldAt, payload: { from: 'in-yard', to: 'hold' }, idempotencyKey: 'ooo-reject' }), (error: unknown) => {
    assert.ok(error instanceof LedgerError);
    assert.equal(error.code, 'OUT_OF_ORDER');
    return true;
  });
  const accepted = submitEvent({ type: 'container.status-changed', entityId: 'EISU-1288420', at: oldAt, payload: { from: 'in-yard', to: 'hold' }, allowOutOfOrder: true, idempotencyKey: 'ooo-accept' });
  assert.deepEqual(accepted.warnings.includes('out-of-order'), true);
  const view = replayEntity('container', 'EISU-1288420');
  assert.ok(view.outOfOrderCount >= 1);
  // 恢复现场
  submitEvent({ type: 'container.status-changed', entityId: 'EISU-1288420', payload: { from: 'hold', to: 'in-yard' }, idempotencyKey: 'ooo-restore' });
});

test('未知事件版本、未知事件类型和缺失字段返回可见错误且不入帐', () => {
  const before = queryEvents({}).length;
  assert.throws(() => submitEvent({ type: 'container.status-changed', entityId: 'MSCU-4829017', version: 99, payload: { to: 'hold' } }), (error: unknown) => {
    assert.ok(error instanceof LedgerError);
    assert.equal(error.code, 'UNKNOWN_EVENT_VERSION');
    return true;
  });
  assert.throws(() => ledgerAppendUnknownType(), (error: unknown) => {
    assert.ok(error instanceof LedgerError);
    assert.equal(error.code, 'UNKNOWN_EVENT_TYPE');
    return true;
  });
  assert.throws(() => submitEvent({ type: 'container.status-changed', entityId: 'MSCU-4829017', payload: {} }), (error: unknown) => {
    assert.ok(error instanceof LedgerError);
    assert.equal(error.code, 'INVALID_EVENT');
    return true;
  });
  assert.throws(() => submitEvent({ type: 'container.status-changed', entityId: 'NOT-EXIST', payload: { to: 'hold' } }), (error: unknown) => {
    assert.ok(error instanceof LedgerError);
    assert.equal(error.code, 'ENTITY_NOT_FOUND');
    return true;
  });
  assert.equal(queryEvents({}).length, before);
});

test('回放缺基线的实体流时抛出 REPLAY_FAILED 可见错误', () => {
  assert.throws(() => replayEntity('container', 'NEVER-EXIST-BOX'), (error: unknown) => {
    assert.ok(error instanceof LedgerError);
    assert.equal(error.code, 'ENTITY_NOT_FOUND');
    return true;
  });
});

test('设备指派不可行时事件带 feasible=false，回放任务为 blocked', () => {
  const task = createYardTask({ kind: 'inspect', containerId: 'TGHU-9831204', from: 'D05-R02-T1', to: 'D05-R02-T1', priority: 60, scheduledAt: new Date().toISOString(), estimatedMinutes: 20 })!;
  assignTask(task.id, 'RS-02');
  const view = replayEntity('task', task.id);
  assert.deepEqual((view.current as ReplayedTask).status, 'blocked');
  assert.ok(((view.current as ReplayedTask).blockingReasons).some(r => r.includes('当前不可用')));
  assert.equal(view.consistent, true, view.mismatches.join('；'));
  deleteYardTask(task.id);
});

test('新建箱务/预约/任务的 CRUD 操作都会写入带操作者与来源的事件', () => {
  const created = createContainer(
    { id: 'TEST-LEDGER-01', voyageId: 'VOY-AX7', size: '20', isoType: '22G1', direction: 'import', status: 'in-yard', weightT: 11, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R10-T1' },
    { actor: '审计测试员', source: 'terminal-console' },
  )!;
  const events = queryEvents({ entity: 'container', entityId: created.id, includeRelated: false });
  assert.equal(events[0].actor, '审计测试员');
  assert.equal(events[0].source, 'terminal-console');
  assert.ok(events[0].at && events[0].recordedAt);
  assert.equal(deleteContainer(created.id)?.id, created.id);
  assert.deepEqual(replayEntity('container', created.id).current.exists, false);
});

function ledgerAppendUnknownType() {
  // 通过账本边界验证未知类型（submitEvent 的 TS 类型本身不允许）
  ledger.append({ type: 'container.teleported' as never, entityId: 'X' });
}
