import express, { type Request } from 'express';
import { appointments, assignTask, blocks, containerDetail, containers, createContainer, createGateAppointment, createYardTask, dashboard, deleteContainer, deleteGateAppointment, deleteYardTask, editGateAppointment, equipment, EVENT_TYPES, gateConflicts, LedgerError, prioritizeTasks, queryEvents, replayEntity, submitEvent, tasks, updateContainer, updateYardTask, voyages, yardHeatmap } from './domain.js';
import type { ActorContext } from './domain.js';
import type { LedgerEntity } from './ledger.js';

const app = express(); app.use(express.json());

const ENTITY_SET = new Set(['container', 'appointment', 'task', 'equipment', 'voyage']);

/** 从请求头提取操作者 / 来源 / 幂等键，控制台与外部系统共用；未传时不覆盖请求体字段。 */
function actorContext(req: Request): ActorContext {
  const ctx: ActorContext = {};
  const actor = (req.header('x-actor') || '').trim();
  const source = (req.header('x-source') || '').trim();
  const idempotencyKey = (req.header('idempotency-key') || '').trim();
  if (actor) ctx.actor = actor;
  if (source) ctx.source = source;
  if (idempotencyKey) ctx.idempotencyKey = idempotencyKey;
  return ctx;
}

function fail(res: express.Response, error: unknown) {
  if (error instanceof LedgerError) {
    const status = {
      DUPLICATE_EVENT: 200,
      UNKNOWN_EVENT_VERSION: 422,
      UNKNOWN_EVENT_TYPE: 422,
      INVALID_EVENT: 422,
      OUT_OF_ORDER: 409,
      REPLAY_FAILED: 422,
      ENTITY_NOT_FOUND: 422,
    }[error.code] ?? 400;
    return res.status(status).json({ code: error.code, message: error.message, details: error.details });
  }
  return res.status(409).json({ message: error instanceof Error ? error.message : '操作失败' });
}

app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/voyages', (_req, res) => res.json(voyages));
app.get('/api/containers', (req, res) => res.json(req.query.status ? containers.filter(c => c.status === req.query.status) : containers));
app.post('/api/containers', (req, res) => { try { const result = createContainer(req.body, actorContext(req)); res.status(201).json(result); } catch (error) { fail(res, error); } });
app.patch('/api/containers/:id', (req, res) => { try { const result = updateContainer(req.params.id, req.body, actorContext(req)); if (!result) return res.status(404).json({ message: '箱号不存在' }); res.json(result); } catch (error) { fail(res, error); } });
app.delete('/api/containers/:id', (req, res) => { try { const result = deleteContainer(req.params.id, actorContext(req)); if (!result) return res.status(404).json({ message: '箱号不存在' }); res.json({ deleted: true, id: result.id }); } catch (error) { fail(res, error); } });
app.get('/api/containers/:id', (req, res) => { const result = containerDetail(req.params.id); if (!result) return res.status(404).json({ message: '箱号不存在' }); res.json(result); });
app.get('/api/yard/heatmap', (_req, res) => res.json(yardHeatmap()));
app.get('/api/yard/blocks', (_req, res) => res.json(blocks));
app.get('/api/gate/appointments', (_req, res) => res.json(appointments));
app.get('/api/gate/conflicts', (_req, res) => res.json(gateConflicts()));
app.post('/api/gate/appointments', (req, res) => { try { res.status(201).json(createGateAppointment(req.body, actorContext(req))); } catch (error) { fail(res, error); } });
app.patch('/api/gate/appointments/:id', (req, res) => { try { const result = editGateAppointment(req.params.id, req.body, actorContext(req)); if (!result) return res.status(404).json({ message: '预约不存在' }); res.json(result); } catch (error) { fail(res, error); } });
app.delete('/api/gate/appointments/:id', (req, res) => { try { const result = deleteGateAppointment(req.params.id, actorContext(req)); if (!result) return res.status(404).json({ message: '预约不存在' }); res.json({ deleted: true, id: result.id }); } catch (error) { fail(res, error); } });
app.get('/api/equipment', (_req, res) => res.json(equipment));
app.get('/api/tasks', (_req, res) => res.json(prioritizeTasks()));
app.post('/api/tasks', (req, res) => { try { res.status(201).json(createYardTask(req.body, actorContext(req))); } catch (error) { fail(res, error); } });
app.patch('/api/tasks/:id', (req, res) => { try { const result = updateYardTask(req.params.id, req.body, actorContext(req)); if (!result) return res.status(404).json({ message: '作业任务不存在' }); res.json(result); } catch (error) { fail(res, error); } });
app.delete('/api/tasks/:id', (req, res) => { try { const result = deleteYardTask(req.params.id, actorContext(req)); if (!result) return res.status(404).json({ message: '作业任务不存在' }); res.json({ deleted: true, id: result.id }); } catch (error) { fail(res, error); } });
app.patch('/api/tasks/:id/assign', (req, res) => { try { const result = assignTask(req.params.id, req.body.equipmentId, actorContext(req)); if (!result) return res.status(404).json({ message: '任务或设备不存在' }); res.json(result); } catch (error) { fail(res, error); } });

// -------------------------------------------------------------------------
// 不可变作业事件账本
// -------------------------------------------------------------------------

app.get('/api/ledger/event-types', (_req, res) => res.json(EVENT_TYPES));

app.get('/api/ledger/events', (req, res) => {
  const entity = req.query.entity ? String(req.query.entity) : undefined;
  if (entity && !ENTITY_SET.has(entity)) return res.status(400).json({ code: 'INVALID_EVENT', message: `未知实体类型：${entity}` });
  const types = typeof req.query.types === 'string'
    ? req.query.types.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  if (types) {
    const allowed = new Set(EVENT_TYPES);
    const unknown = types.filter(t => !allowed.has(t as never));
    if (unknown.length) return res.status(400).json({ code: 'UNKNOWN_EVENT_TYPE', message: `未知事件类型：${unknown.join('、')}`, details: { unknown } });
  }
  const rows = queryEvents({
    ...(entity ? { entity: entity as LedgerEntity } : {}),
    ...(req.query.entityId ? { entityId: String(req.query.entityId) } : {}),
    ...(types?.length ? { types: types as never } : {}),
    ...(req.query.from ? { from: String(req.query.from) } : {}),
    ...(req.query.to ? { to: String(req.query.to) } : {}),
    ...(req.query.source ? { source: String(req.query.source) } : {}),
    ...(req.query.actor ? { actor: String(req.query.actor) } : {}),
    includeRelated: req.query.related === 'false' ? false : undefined,
    order: req.query.order === 'desc' ? 'desc' : undefined,
    limit: req.query.limit ? Math.min(1000, Number(req.query.limit)) : undefined,
  });
  res.json({ count: rows.length, events: rows });
});

app.post('/api/ledger/events', (req, res) => {
  try {
    const result = submitEvent({
      ...req.body,
      ...actorContext(req),
      ...(req.body.at ? { at: req.body.at } : {}),
      allowOutOfOrder: req.body.allowOutOfOrder === true || req.header('x-allow-out-of-order') === 'true',
    });
    res.setHeader('Idempotent-Replay', result.duplicate ? 'true' : 'false');
    res.status(result.duplicate ? 200 : 201).json({
      accepted: true, duplicate: result.duplicate, warnings: result.warnings, event: result.event,
      message: result.duplicate ? '重复提交：事件已存在，未产生第二次状态变化' : '事件已入帐并投影到内存基线',
    });
  } catch (error) { fail(res, error); }
});

app.get('/api/ledger/replay/:entity/:id', (req, res) => {
  const entity = req.params.entity;
  if (!ENTITY_SET.has(entity)) return res.status(400).json({ code: 'INVALID_EVENT', message: `未知实体类型：${entity}` });
  try {
    res.json(replayEntity(entity as LedgerEntity, req.params.id));
  } catch (error) { fail(res, error); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'port-yard-operations' }));
const port = Number(process.env.PORT || 4107); app.listen(port, () => console.log(`port yard API listening on ${port}`));