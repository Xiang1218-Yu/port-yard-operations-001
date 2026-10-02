import express from 'express';
import { appointments, assignTask, blocks, containerDetail, containers, createContainer, createGateAppointment, createYardTask, dashboard, deleteContainer, deleteGateAppointment, deleteYardTask, editGateAppointment, equipment, gateConflicts, prioritizeTasks, tasks, updateContainer, updateVoyageProgress, updateYardTask, voyages, yardHeatmap } from './domain.js';
import { appendEvent, diffWithLive, eventTypeRegistry, EventLedgerError, listEvents, replayEntity } from './events.js';
const app = express(); app.use(express.json());
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/voyages', (_req, res) => res.json(voyages));
app.get('/api/containers', (req, res) => res.json(req.query.status ? containers.filter(c => c.status === req.query.status) : containers));
app.post('/api/containers', (req, res) => { try { res.status(201).json(createContainer(req.body)); } catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : '创建箱务记录失败' }); } });
app.patch('/api/containers/:id', (req, res) => { try { const result = updateContainer(req.params.id, req.body); if (!result) return res.status(404).json({ message: '箱号不存在' }); res.json(result); } catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : '更新箱务记录失败' }); } });
app.delete('/api/containers/:id', (req, res) => { const result = deleteContainer(req.params.id); if (!result) return res.status(404).json({ message: '箱号不存在' }); res.json({ deleted: true, id: result.id }); });
app.get('/api/containers/:id', (req, res) => { const result = containerDetail(req.params.id); if (!result) return res.status(404).json({ message: '箱号不存在' }); res.json(result); });
app.get('/api/yard/heatmap', (_req, res) => res.json(yardHeatmap()));
app.get('/api/yard/blocks', (_req, res) => res.json(blocks));
app.get('/api/gate/appointments', (_req, res) => res.json(appointments));
app.get('/api/gate/conflicts', (_req, res) => res.json(gateConflicts()));
app.post('/api/gate/appointments', (req, res) => { try { res.status(201).json(createGateAppointment(req.body)); } catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : '预约失败' }); } });
app.patch('/api/gate/appointments/:id', (req, res) => { try { const result = editGateAppointment(req.params.id, req.body); if (!result) return res.status(404).json({ message: '预约不存在' }); res.json(result); } catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : '更新预约失败' }); } });
app.delete('/api/gate/appointments/:id', (req, res) => { const result = deleteGateAppointment(req.params.id); if (!result) return res.status(404).json({ message: '预约不存在' }); res.json({ deleted: true, id: result.id }); });
app.get('/api/equipment', (_req, res) => res.json(equipment));
app.get('/api/tasks', (_req, res) => res.json(prioritizeTasks()));
app.post('/api/tasks', (req, res) => { try { res.status(201).json(createYardTask(req.body)); } catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : '创建作业任务失败' }); } });
app.patch('/api/tasks/:id', (req, res) => { try { const result = updateYardTask(req.params.id, req.body); if (!result) return res.status(404).json({ message: '作业任务不存在' }); res.json(result); } catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : '更新作业任务失败' }); } });
app.delete('/api/tasks/:id', (req, res) => { const result = deleteYardTask(req.params.id); if (!result) return res.status(404).json({ message: '作业任务不存在' }); res.json({ deleted: true, id: result.id }); });
app.patch('/api/tasks/:id/assign', (req, res) => { const result = assignTask(req.params.id, req.body.equipmentId); if (!result) return res.status(404).json({ message: '任务或设备不存在' }); res.json(result); });
app.patch('/api/voyages/:id/progress', (req, res) => { try { const result = updateVoyageProgress(req.params.id, req.body); if (!result) return res.status(404).json({ message: '航次不存在' }); res.json(result); } catch (error) { res.status(409).json({ message: error instanceof Error ? error.message : '航次进度回填失败' }); } });
app.get('/api/events/types', (_req, res) => res.json(eventTypeRegistry()));
app.get('/api/events/replay/:entity/:entityId', (req, res) => {
  try {
    const result = replayEntity(req.params.entity, req.params.entityId);
    if (!result) return res.status(404).json({ message: '该实体在账本中没有任何事件记录' });
    const live = ({ container: containers, appointment: appointments, 'yard-task': tasks, equipment, voyage: voyages }[result.entity] as unknown as Record<string, unknown>[]).find(item => item.id === result.entityId);
    res.json({ ...result, live, mismatches: diffWithLive(result.entity, result.state, live) });
  } catch (error) { res.status(error instanceof EventLedgerError ? 400 : 500).json({ message: error instanceof Error ? error.message : '事件重放失败' }); }
});
app.get('/api/events', (req, res) => {
  const { entity, entityId, type, from, to } = req.query;
  if (entity && typeof entity === 'string' && !['container', 'appointment', 'yard-task', 'equipment', 'voyage'].includes(entity)) return res.status(400).json({ message: `未知实体类型 ${entity}` });
  res.json(listEvents({ entity: entity as string | undefined, entityId: entityId as string | undefined, type: type as string | undefined, from: from as string | undefined, to: to as string | undefined }));
});
app.post('/api/events', (req, res) => {
  try {
    const result = appendEvent(req.body);
    res.status(result.deduplicated ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof EventLedgerError) return res.status(422).json({ message: error.message, code: error.code });
    res.status(409).json({ message: error instanceof Error ? error.message : '事件入账失败' });
  }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'port-yard-operations' }));
const port = Number(process.env.PORT || 4107); app.listen(port, () => console.log(`port yard API listening on ${port}`));
