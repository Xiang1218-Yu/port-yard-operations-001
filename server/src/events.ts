// 不可变作业事件账本：把箱务、闸口预约、场内任务、设备指派与航次进度的关键状态变化
// 记录为带时间、操作者、来源和关联实体的事件，支持按实体/时间范围/事件类型回溯，
// 并能从事件流重建某个箱子或任务的当前视图。重复提交同一事件 id 会被幂等去重。

export type EventEntity = 'container' | 'appointment' | 'yard-task' | 'equipment' | 'voyage';

export interface RelatedEntity { entity: EventEntity; id: string; }

export interface OperationEvent {
  id: string;
  version: number;
  entity: EventEntity;
  entityId: string;
  type: string;
  at: string;
  actor: string;
  source: string;
  payload: Record<string, unknown>;
  related: RelatedEntity[];
  sequence: number;
  recordedAt: string;
}

export interface EventInput {
  id?: string;
  version?: number;
  entity: EventEntity;
  entityId: string;
  type: string;
  at?: string;
  actor?: string;
  source?: string;
  payload?: Record<string, unknown>;
  related?: RelatedEntity[];
}

export interface EventFilter { entity?: string; entityId?: string; type?: string; from?: string; to?: string; }

export const EVENT_SCHEMA_VERSION = 1;
export const EVENT_ENTITIES: EventEntity[] = ['container', 'appointment', 'yard-task', 'equipment', 'voyage'];

export type EventErrorCode = 'UNKNOWN_VERSION' | 'UNKNOWN_TYPE' | 'INVALID_EVENT';
export class EventLedgerError extends Error {
  constructor(message: string, readonly code: EventErrorCode) { super(message); this.name = 'EventLedgerError'; }
}

type ViewState = Record<string, unknown>;
type Reducer = (state: ViewState, payload: Record<string, unknown>) => ViewState;

const requireField = (payload: Record<string, unknown>, field: string) => {
  const value = payload[field];
  if (value === undefined || value === null) throw new Error(`事件载荷缺少 ${field} 字段`);
  return value;
};
const mergeSnapshot: Reducer = (state, payload) => ({ ...state, ...payload });
const mergePatch: Reducer = (state, payload) => {
  const patch = payload.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('事件载荷缺少 patch 对象');
  return { ...state, ...(patch as Record<string, unknown>) };
};
const setTo = (field: string): Reducer => (state, payload) => ({ ...state, [field]: requireField(payload, 'to') });
const tombstone: Reducer = state => ({ ...state, deleted: true });

interface EventTypeDef { label: string; versions: number[]; reducer: Reducer; }
const registry: Record<string, EventTypeDef> = {
  'container.created': { label: '箱子建档', versions: [1], reducer: mergeSnapshot },
  'container.updated': { label: '箱务台账更新', versions: [1], reducer: mergePatch },
  'container.status-changed': { label: '箱状态变更', versions: [1], reducer: setTo('status') },
  'container.relocated': { label: '换堆位', versions: [1], reducer: (state, payload) => ({ ...state, yardSlot: requireField(payload, 'to') }) },
  'container.customs-changed': { label: '海关状态变更', versions: [1], reducer: setTo('customs') },
  'container.deleted': { label: '箱务删除', versions: [1], reducer: tombstone },
  'appointment.created': { label: '闸口预约创建', versions: [1], reducer: mergeSnapshot },
  'appointment.updated': { label: '预约更新', versions: [1], reducer: mergePatch },
  'appointment.status-changed': { label: '预约状态变更', versions: [1], reducer: setTo('status') },
  'appointment.deleted': { label: '预约删除', versions: [1], reducer: tombstone },
  'yard-task.created': { label: '场内任务创建', versions: [1], reducer: mergeSnapshot },
  'yard-task.updated': { label: '任务更新', versions: [1], reducer: mergePatch },
  'yard-task.status-changed': { label: '任务状态变更', versions: [1], reducer: setTo('status') },
  'yard-task.reassigned': { label: '任务重排 / 设备改派', versions: [1], reducer: (state, payload) => ({ ...state, equipmentId: requireField(payload, 'equipmentId') }) },
  'yard-task.deleted': { label: '任务删除', versions: [1], reducer: tombstone },
  'equipment.created': { label: '设备建档', versions: [1], reducer: mergeSnapshot },
  'equipment.assigned': { label: '设备指派', versions: [1], reducer: (state, payload) => ({ ...state, currentTaskId: requireField(payload, 'taskId'), lastContainerId: requireField(payload, 'containerId') }) },
  'voyage.created': { label: '航次建档', versions: [1], reducer: mergeSnapshot },
  'voyage.progress': { label: '航次进度回填', versions: [1], reducer: (state, payload) => ({ ...state, movesDone: requireField(payload, 'to') }) },
  'voyage.status-changed': { label: '航次状态变更', versions: [1], reducer: setTo('status') }
};

// 重放视图与内存实时态做一致性比对时只关注这些关键字段
const COMPARE_KEYS: Record<EventEntity, string[]> = {
  container: ['status', 'yardSlot', 'customs', 'voyageId'],
  appointment: ['status', 'containerId', 'lane', 'windowStart', 'windowEnd'],
  'yard-task': ['status', 'equipmentId', 'priority', 'from', 'to'],
  equipment: ['status', 'location', 'currentTaskId'],
  voyage: ['status', 'movesDone']
};

const ledger: OperationEvent[] = [];
const byId = new Map<string, OperationEvent>();
let sequence = 0;
let idCounter = 0;

export function appendEvent(input: EventInput): { event: OperationEvent; deduplicated: boolean } {
  if (!EVENT_ENTITIES.includes(input.entity)) throw new EventLedgerError(`未知实体类型 ${input.entity}`, 'INVALID_EVENT');
  if (!input.entityId || !input.type) throw new EventLedgerError('事件缺少 entityId 或 type', 'INVALID_EVENT');
  const version = input.version ?? EVENT_SCHEMA_VERSION;
  if (version !== EVENT_SCHEMA_VERSION) throw new EventLedgerError(`未知事件版本 v${version}，当前账本仅支持 v${EVENT_SCHEMA_VERSION}`, 'UNKNOWN_VERSION');
  if (!registry[input.type]) throw new EventLedgerError(`未注册的事件类型 ${input.type}`, 'UNKNOWN_TYPE');
  const id = input.id ?? `EVT-${Date.now().toString(36)}-${++idCounter}`;
  const existing = byId.get(id);
  if (existing) return { event: existing, deduplicated: true };
  const event: OperationEvent = Object.freeze({
    id, version, entity: input.entity, entityId: input.entityId, type: input.type,
    at: input.at ?? new Date().toISOString(),
    actor: input.actor ?? '系统', source: input.source ?? 'unknown',
    payload: Object.freeze({ ...(input.payload ?? {}) }),
    related: Object.freeze([...(input.related ?? [])]) as RelatedEntity[],
    sequence: ++sequence, recordedAt: new Date().toISOString()
  });
  ledger.push(event);
  byId.set(id, event);
  return { event, deduplicated: false };
}

export function listEvents(filter: EventFilter = {}): OperationEvent[] {
  return ledger.filter(event =>
    (!filter.entity || event.entity === filter.entity) &&
    (!filter.entityId || event.entityId === filter.entityId) &&
    (!filter.type || event.type === filter.type) &&
    (!filter.from || event.at >= filter.from) &&
    (!filter.to || event.at <= filter.to));
}

export function eventTypeRegistry() {
  return Object.entries(registry).map(([type, def]) => ({ type, label: def.label, versions: def.versions }));
}

export interface ReplayIssue { eventId: string; kind: 'out-of-order' | 'unknown-version' | 'unknown-type' | 'apply-failed'; message: string; at: string; }
export interface ReplayResult {
  entity: EventEntity; entityId: string;
  state: ViewState; applied: number; skipped: number;
  anomalies: ReplayIssue[]; errors: ReplayIssue[]; ok: boolean;
}

// 纯函数：按账本顺序折叠事件。乱序事件仍然入账但会留下可见告警；
// 未知版本/未知类型/载荷校验失败会记入 errors 并跳过，不会中断整条事件流。
export function replayEvents(entity: EventEntity, entityId: string, events: OperationEvent[]): ReplayResult {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let state: ViewState = {};
  let applied = 0;
  let skipped = 0;
  let maxAt = '';
  const anomalies: ReplayIssue[] = [];
  const errors: ReplayIssue[] = [];
  for (const event of ordered) {
    if (maxAt && event.at < maxAt) {
      anomalies.push({ eventId: event.id, kind: 'out-of-order', at: event.at, message: `事件时间 ${event.at} 早于已入账事件时间 ${maxAt}，疑似乱序提交，已按账本顺序入账` });
    }
    if (event.at > maxAt) maxAt = event.at;
    const def = registry[event.type];
    if (!def) {
      errors.push({ eventId: event.id, kind: 'unknown-type', at: event.at, message: `未注册的事件类型 ${event.type}，已跳过` });
      skipped++; continue;
    }
    if (!def.versions.includes(event.version)) {
      errors.push({ eventId: event.id, kind: 'unknown-version', at: event.at, message: `未知事件版本 v${event.version}（${event.type} 仅支持 ${def.versions.map(v => `v${v}`).join('/')}），已跳过` });
      skipped++; continue;
    }
    try {
      state = def.reducer(state, event.payload);
      applied++;
    } catch (error) {
      errors.push({ eventId: event.id, kind: 'apply-failed', at: event.at, message: `重放 ${event.type} 失败：${error instanceof Error ? error.message : String(error)}` });
      skipped++;
    }
  }
  return { entity, entityId, state, applied, skipped, anomalies, errors, ok: errors.length === 0 };
}

export function replayEntity(entity: string, entityId: string): ReplayResult | undefined {
  if (!EVENT_ENTITIES.includes(entity as EventEntity)) throw new EventLedgerError(`未知实体类型 ${entity}`, 'INVALID_EVENT');
  const events = listEvents({ entity, entityId });
  if (!events.length) return undefined;
  return replayEvents(entity as EventEntity, entityId, events);
}

// 把重建视图与内存实时态按关键字段比对，审计页面可以直接看到是否一致
export function diffWithLive(entity: EventEntity, state: ViewState, live: Record<string, unknown> | undefined): string[] {
  if (!live) return state.deleted ? [] : ['live-missing'];
  if (state.deleted) return ['live-still-exists'];
  return COMPARE_KEYS[entity].filter(key => key in state && JSON.stringify(state[key]) !== JSON.stringify(live[key]));
}
