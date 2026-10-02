import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent, eventTypeRegistry, EventLedgerError, listEvents, replayEntity, replayEvents, OperationEvent } from './events.js';
import { assignTask, containers, createContainer, createGateAppointment, editGateAppointment, updateContainer, updateVoyageProgress } from './domain.js';

let craftedSequence = 100000;
const crafted = (partial: Partial<OperationEvent> & Pick<OperationEvent, 'entity' | 'entityId' | 'type'>): OperationEvent => ({
  id: `CRAFTED-${++craftedSequence}`, version: 1, at: new Date().toISOString(), actor: '测试员', source: 'test',
  payload: {}, related: [], sequence: craftedSequence, recordedAt: new Date().toISOString(), ...partial
});

test('repeated submission of the same event id is deduplicated and replays only once', () => {
  const first = appendEvent({ id: 'TEST-IDEMP-1', entity: 'container', entityId: 'TEST-IDEMP-BOX', type: 'container.created', actor: '测试员', source: 'test', payload: { status: 'in-yard', yardSlot: 'C03-R01-T1', customs: 'released' } });
  assert.equal(first.deduplicated, false);
  const second = appendEvent({ id: 'TEST-IDEMP-1', entity: 'container', entityId: 'TEST-IDEMP-BOX', type: 'container.created', actor: '测试员', source: 'test', payload: { status: 'in-yard', yardSlot: 'C03-R01-T1', customs: 'released' } });
  assert.equal(second.deduplicated, true);
  assert.equal(listEvents({ entityId: 'TEST-IDEMP-BOX' }).length, 1);
  appendEvent({ id: 'TEST-IDEMP-2', entity: 'container', entityId: 'TEST-IDEMP-BOX', type: 'container.status-changed', actor: '测试员', source: 'test', payload: { from: 'in-yard', to: 'hold' } });
  appendEvent({ id: 'TEST-IDEMP-2', entity: 'container', entityId: 'TEST-IDEMP-BOX', type: 'container.status-changed', actor: '测试员', source: 'test', payload: { from: 'in-yard', to: 'hold' } });
  const replay = replayEntity('container', 'TEST-IDEMP-BOX');
  assert.equal(replay?.applied, 2);
  assert.equal(replay?.state.status, 'hold');
  assert.equal(replay?.ok, true);
});

test('event query filters by entity, type and time range', () => {
  appendEvent({ id: 'TEST-FILTER-1', entity: 'voyage', entityId: 'TEST-FILTER-VOY', type: 'voyage.progress', at: '2026-10-02T08:00:00.000Z', actor: '测试员', source: 'test', payload: { from: 0, to: 10 } });
  appendEvent({ id: 'TEST-FILTER-2', entity: 'voyage', entityId: 'TEST-FILTER-VOY', type: 'voyage.progress', at: '2026-10-02T12:00:00.000Z', actor: '测试员', source: 'test', payload: { from: 10, to: 20 } });
  assert.equal(listEvents({ entity: 'voyage', entityId: 'TEST-FILTER-VOY' }).length, 2);
  assert.equal(listEvents({ entity: 'container', entityId: 'TEST-FILTER-VOY' }).length, 0);
  assert.equal(listEvents({ entityId: 'TEST-FILTER-VOY', type: 'voyage.status-changed' }).length, 0);
  assert.equal(listEvents({ entityId: 'TEST-FILTER-VOY', from: '2026-10-02T09:00:00.000Z' }).length, 1);
  assert.equal(listEvents({ entityId: 'TEST-FILTER-VOY', to: '2026-10-02T09:00:00.000Z' }).length, 1);
  assert.equal(listEvents({ entityId: 'TEST-FILTER-VOY', from: '2026-10-02T07:00:00.000Z', to: '2026-10-02T13:00:00.000Z' }).length, 2);
});

test('seed baseline lets the ledger rebuild current container and task views', () => {
  const container = containers.find(item => item.id === 'MSCU-4829017');
  const replay = replayEntity('container', 'MSCU-4829017');
  assert.ok(replay && replay.applied >= 1);
  assert.equal(replay.state.status, container?.status);
  assert.equal(replay.state.yardSlot, container?.yardSlot);
  const taskReplay = replayEntity('yard-task', 'TASK-101');
  assert.equal(taskReplay?.state.status, 'assigned');
  assert.equal(taskReplay?.state.equipmentId, 'YC-12');
});

test('domain mutations append structured events and replay follows the live state', () => {
  const created = createContainer({ id: 'TEST-EVT-BOX1', voyageId: 'VOY-AX7', size: '20', isoType: '22G1', direction: 'import', status: 'in-yard', weightT: 10, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R11-T1' });
  updateContainer(created.id, { status: 'hold', customs: 'inspection', yardSlot: 'D05-R01-T1' });
  const types = listEvents({ entity: 'container', entityId: created.id }).map(event => event.type);
  assert.ok(types.includes('container.created'));
  assert.ok(types.includes('container.status-changed'));
  assert.ok(types.includes('container.relocated'));
  assert.ok(types.includes('container.customs-changed'));
  const replay = replayEntity('container', created.id);
  assert.equal(replay?.state.status, 'hold');
  assert.equal(replay?.state.yardSlot, 'D05-R01-T1');
  assert.equal(replay?.state.customs, 'inspection');
});

test('gate check-in side effect is recorded as a container status event', () => {
  createContainer({ id: 'TEST-EVT-BOX2', voyageId: 'VOY-AX7', size: '40', isoType: '45G1', direction: 'export', status: 'in-yard', weightT: 20, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R02-T1' });
  const appointment = createGateAppointment({ containerId: 'TEST-EVT-BOX2', truckNo: 'TEST-TRUCK-1', driver: '测试司机', type: 'dropoff', windowStart: new Date(Date.now() + 3600000).toISOString(), windowEnd: new Date(Date.now() + 7200000).toISOString(), lane: 'north' });
  editGateAppointment(appointment.id, { status: 'checked-in' });
  const containerEvents = listEvents({ entity: 'container', entityId: 'TEST-EVT-BOX2' });
  assert.ok(containerEvents.some(event => event.type === 'container.status-changed' && event.payload.to === 'at-gate' && event.source === 'gate-console'));
  assert.equal(replayEntity('container', 'TEST-EVT-BOX2')?.state.status, 'at-gate');
});

test('task reassignment records both task and equipment events', () => {
  assignTask('TASK-102', 'YC-05');
  assert.equal(replayEntity('yard-task', 'TASK-102')?.state.equipmentId, 'YC-05');
  const equipmentReplay = replayEntity('equipment', 'YC-05');
  assert.equal(equipmentReplay?.state.currentTaskId, 'TASK-102');
  assert.equal(equipmentReplay?.state.lastContainerId, 'EISU-1288420');
});

test('voyage progress backfill is validated and recorded', () => {
  const voyage = updateVoyageProgress('VOY-AX7', { movesDone: 900 });
  assert.equal(voyage?.movesDone, 900);
  assert.equal(replayEntity('voyage', 'VOY-AX7')?.state.movesDone, 900);
  assert.throws(() => updateVoyageProgress('VOY-AX7', { movesDone: 99999 }));
});

test('out-of-order events are flagged as anomalies but still applied in ledger order', () => {
  const late = crafted({ entity: 'container', entityId: 'TEST-OOO-BOX', type: 'container.created', at: '2026-10-02T10:00:00.000Z', payload: { status: 'in-yard' } });
  const early = crafted({ entity: 'container', entityId: 'TEST-OOO-BOX', type: 'container.status-changed', at: '2026-10-02T09:00:00.000Z', payload: { from: 'in-yard', to: 'hold' } });
  const result = replayEvents('container', 'TEST-OOO-BOX', [late, early]);
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].kind, 'out-of-order');
  assert.equal(result.applied, 2);
  assert.equal(result.state.status, 'hold');
  assert.equal(result.ok, true);
});

test('unknown event version is rejected on append and visible during replay', () => {
  assert.throws(() => appendEvent({ entity: 'container', entityId: 'X', type: 'container.created', version: 99 }), (error: unknown) => error instanceof EventLedgerError && error.code === 'UNKNOWN_VERSION');
  const future = crafted({ entity: 'container', entityId: 'TEST-VER-BOX', type: 'container.created', version: 2, payload: { status: 'in-yard' } });
  const result = replayEvents('container', 'TEST-VER-BOX', [future]);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].kind, 'unknown-version');
  assert.equal(result.skipped, 1);
  assert.equal(result.applied, 0);
});

test('replay failure on a malformed payload surfaces as a visible error and does not corrupt state', () => {
  const created = crafted({ entity: 'container', entityId: 'TEST-FAIL-BOX', type: 'container.created', payload: { status: 'in-yard', yardSlot: 'C03-R01-T1' } });
  const broken = crafted({ entity: 'container', entityId: 'TEST-FAIL-BOX', type: 'container.relocated', payload: {} });
  const result = replayEvents('container', 'TEST-FAIL-BOX', [created, broken]);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].kind, 'apply-failed');
  assert.match(result.errors[0].message, /缺少 to 字段/);
  assert.equal(result.state.yardSlot, 'C03-R01-T1');
});

test('event type registry exposes labels and versions for the console', () => {
  const types = eventTypeRegistry();
  assert.ok(types.some(item => item.type === 'container.relocated' && item.versions.includes(1)));
  assert.ok(types.some(item => item.type === 'voyage.progress'));
});
