// 不可变作业事件账本（append-only event ledger）
// 记录箱务、闸口预约、场内任务、设备指派、航次进度的关键状态变化。
// 任何已写入事件只能追加新版本事件进行补偿，不能修改或删除。

export const CURRENT_EVENT_VERSION = 1 as const;
export const SUPPORTED_EVENT_VERSIONS = [1] as const;

export type LedgerEntity = 'container' | 'appointment' | 'task' | 'equipment' | 'voyage';

export type LedgerEventType =
  // 箱务
  | 'container.created'
  | 'container.updated'
  | 'container.deleted'
  | 'container.status-changed'
  | 'container.slot-changed'
  | 'container.customs-changed'
  // 闸口预约
  | 'gate.appointment-created'
  | 'gate.appointment-updated'
  | 'gate.appointment-status-changed'
  | 'gate.appointment-deleted'
  // 场内任务
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.assigned'
  | 'task.status-changed'
  | 'task.replanned'
  // 设备
  | 'equipment.status-changed'
  // 航次
  | 'voyage.status-changed'
  | 'voyage.progress'
  | 'voyage.eta-changed'
  | 'voyage.etd-changed';

export const EVENT_TYPES: LedgerEventType[] = [
  'container.created', 'container.updated', 'container.deleted',
  'container.status-changed', 'container.slot-changed', 'container.customs-changed',
  'gate.appointment-created', 'gate.appointment-updated', 'gate.appointment-status-changed', 'gate.appointment-deleted',
  'task.created', 'task.updated', 'task.deleted', 'task.assigned', 'task.status-changed', 'task.replanned',
  'equipment.status-changed',
  'voyage.status-changed', 'voyage.progress', 'voyage.eta-changed', 'voyage.etd-changed',
];

const EVENT_ENTITIES: Record<LedgerEventType, LedgerEntity> = {
  'container.created': 'container', 'container.updated': 'container', 'container.deleted': 'container',
  'container.status-changed': 'container', 'container.slot-changed': 'container', 'container.customs-changed': 'container',
  'gate.appointment-created': 'appointment', 'gate.appointment-updated': 'appointment',
  'gate.appointment-status-changed': 'appointment', 'gate.appointment-deleted': 'appointment',
  'task.created': 'task', 'task.updated': 'task', 'task.deleted': 'task',
  'task.assigned': 'task', 'task.status-changed': 'task', 'task.replanned': 'task',
  'equipment.status-changed': 'equipment',
  'voyage.status-changed': 'voyage', 'voyage.progress': 'voyage',
  'voyage.eta-changed': 'voyage', 'voyage.etd-changed': 'voyage',
};

export function entityOfEventType(type: string): LedgerEntity {
  const entity = EVENT_ENTITIES[type as LedgerEventType];
  if (!entity) throw new LedgerError('UNKNOWN_EVENT_TYPE', `未知事件类型：${type}（当前账本支持 ${EVENT_TYPES.length} 种事件）`);
  return entity;
}

// 控制台 / API 中展示的中文事件名
export const EVENT_LABELS: Record<LedgerEventType, string> = {
  'container.created': '箱务建档',
  'container.updated': '箱务字段更新',
  'container.deleted': '箱务删除',
  'container.status-changed': '箱体状态变更',
  'container.slot-changed': '换堆位',
  'container.customs-changed': '海关状态变更（查验/放行/挂起）',
  'gate.appointment-created': '闸口预约创建',
  'gate.appointment-updated': '闸口预约更新',
  'gate.appointment-status-changed': '闸口预约状态变更（签到/完成/取消）',
  'gate.appointment-deleted': '闸口预约删除',
  'task.created': '场内任务创建',
  'task.updated': '场内任务更新',
  'task.deleted': '场内任务删除',
  'task.assigned': '设备指派',
  'task.status-changed': '任务状态变更',
  'task.replanned': '任务重排',
  'equipment.status-changed': '设备状态变更',
  'voyage.status-changed': '航次状态变更',
  'voyage.progress': '航次作业进度',
  'voyage.eta-changed': '航次 ETA 变更',
  'voyage.etd-changed': '航次 ETD 变更',
};

export interface EventRef { entity: LedgerEntity; entityId: string; role?: string; }

export interface JobEvent {
  /** 事件唯一编号（去重幂等键） */
  id: string;
  /** 事件 schema 版本；账本无法识别更高版本时拒绝写入 */
  version: 1;
  type: LedgerEventType;
  /** 事件主实体 */
  entity: LedgerEntity;
  entityId: string;
  /** ISO-8601 事件发生时间（业务时间，不是写入时间） */
  at: string;
  /** 事件实际写入账本的时间（服务器时钟） */
  recordedAt: string;
  /** 操作者：调度员、闸口值班员、TOS、OCR、海关系统等 */
  actor: string;
  /** 来源系统：terminal-console / tos / gate-ocr / customs / telemetry ... */
  source: string;
  payload: Record<string, unknown>;
  /** 关联实体，例如任务事件关联的箱子、设备与航次 */
  refs: EventRef[];
  /** 同一写请求传入的幂等键，重复提交直接返回原事件 */
  idempotencyKey?: string;
  /** 事件在账本中的全局递增序号 */
  seq: number;
  /** 乱序到达但被允许写入时标记，回放与审计界面可见 */
  warnings: string[];
}

export type LedgerErrorCode =
  | 'DUPLICATE_EVENT'
  | 'UNKNOWN_EVENT_VERSION'
  | 'UNKNOWN_EVENT_TYPE'
  | 'INVALID_EVENT'
  | 'OUT_OF_ORDER'
  | 'REPLAY_FAILED'
  | 'ENTITY_NOT_FOUND';

export class LedgerError extends Error {
  code: LedgerErrorCode;
  details?: Record<string, unknown>;
  constructor(code: LedgerErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.details = details;
  }
}

export interface EventInput {
  id?: string;
  version?: number;
  type: LedgerEventType;
  entity?: LedgerEntity;
  entityId: string;
  at?: string;
  actor?: string;
  source?: string;
  payload?: Record<string, unknown>;
  refs?: EventRef[];
  idempotencyKey?: string;
}

export interface AppendOptions {
  /** 允许业务时间早于该实体最后一条事件，事件会被标记 out-of-order；默认拒绝（409） */
  allowOutOfOrder?: boolean;
  /** 允许自定义事件 id 之外的缺省 actor/source */
  defaultActor?: string;
  defaultSource?: string;
}

export interface AppendResult {
  event: JobEvent;
  duplicate: boolean;
  warnings: string[];
}

export interface EventQuery {
  entity?: LedgerEntity;
  entityId?: string;
  types?: LedgerEventType[];
  from?: string;
  to?: string;
  source?: string;
  actor?: string;
  /** 实体查询是否同时返回 refs / payload 中关联到该实体的事件，默认 true */
  includeRelated?: boolean;
  /** 时间正序（默认）或倒序 */
  order?: 'asc' | 'desc';
  limit?: number;
}

let eventSerial = 0;
const nextSerial = () => ++eventSerial;

function byTimeSeq(a: JobEvent, b: JobEvent) {
  return new Date(a.at).getTime() - new Date(b.at).getTime() || a.seq - b.seq;
}

/** 事件是否直接或通过 refs / payload.containerId 关联到某实体 */
export function eventRelatesTo(event: JobEvent, entity: LedgerEntity, id: string): boolean {
  if (event.entity === entity && event.entityId === id) return true;
  if (event.refs.some(ref => ref.entity === entity && ref.entityId === id)) return true;
  if (entity === 'container' && typeof event.payload?.containerId === 'string' && event.payload.containerId === id) return true;
  if (entity === 'voyage' && typeof event.payload?.voyageId === 'string' && event.payload.voyageId === id) return true;
  return false;
}

class EventLedger {
  private events: JobEvent[] = [];
  private idempotencyKeys = new Map<string, string>();

  /** 追加事件。重复 event id / 幂等键返回原事件，不产生第二次状态变化。 */
  append(input: EventInput, options: AppendOptions = {}): AppendResult {
    if (input.version !== undefined && input.version !== CURRENT_EVENT_VERSION) {
      throw new LedgerError(
        'UNKNOWN_EVENT_VERSION',
        `未知事件版本 v${input.version}：当前账本仅支持 v${SUPPORTED_EVENT_VERSIONS.join('/')}，请升级调度台或转交人工处理`,
        { received: input.version, supported: [...SUPPORTED_EVENT_VERSIONS] },
      );
    }
    const entity = input.entity ?? safeEntityOf(input.type);
    const type = input.type;
    if (!EVENT_TYPES.includes(type)) {
      throw new LedgerError('UNKNOWN_EVENT_TYPE', `未知事件类型：${String(type)}，账本无法保证回放语义`, { received: type, knownTypes: EVENT_TYPES });
    }
    if (EVENT_ENTITIES[type] !== entity) {
      throw new LedgerError('INVALID_EVENT', `事件类型 ${type} 的主实体必须是 ${EVENT_ENTITIES[type]}，收到 ${entity}`);
    }
    if (!input.entityId || typeof input.entityId !== 'string') {
      throw new LedgerError('INVALID_EVENT', '事件缺少 entityId');
    }
    const at = input.at ?? new Date().toISOString();
    if (Number.isNaN(new Date(at).getTime())) {
      throw new LedgerError('INVALID_EVENT', `事件时间无法解析：${String(at)}`, { at: input.at });
    }
    if (input.payload !== undefined && (typeof input.payload !== 'object' || input.payload === null || Array.isArray(input.payload))) {
      throw new LedgerError('INVALID_EVENT', '事件 payload 必须是对象');
    }
    if (input.refs?.some(ref => !ref.entity || !ref.entityId)) {
      throw new LedgerError('INVALID_EVENT', '事件 refs 中存在缺少 entity/entityId 的关联');
    }

    if (input.id) {
      const existing = this.events.find(event => event.id === input.id);
      if (existing) return { event: existing, duplicate: true, warnings: ['duplicate-event-id'] };
    }
    if (input.idempotencyKey) {
      const existingId = this.idempotencyKeys.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.events.find(event => event.id === existingId);
        if (existing) return { event: existing, duplicate: true, warnings: ['duplicate-idempotency-key'] };
      }
    }

    // 顺序错乱检测：与同一主实体流上最后一条业务事件比较
    const warnings: string[] = [];
    const last = [...this.events].reverse().find(event => event.entity === entity && event.entityId === input.entityId);
    if (last && new Date(at).getTime() < new Date(last.at).getTime()) {
      const detail = `事件乱序：${type}@${at} 早于该实体上一条事件 ${last.type}@${last.at}（${last.id}）`;
      if (!options.allowOutOfOrder) {
        throw new LedgerError('OUT_OF_ORDER', `${detail}。如确认补录历史事件，请显式允许乱序写入（allowOutOfOrder），事件将被标记后按业务时间回放`, {
          previousEventId: last.id, previousAt: last.at, attemptedAt: at,
        });
      }
      warnings.push('out-of-order', detail);
    }

    const event: JobEvent = {
      id: input.id ?? `EVT-${Date.now().toString(36).toUpperCase()}-${nextSerial().toString(36).toUpperCase()}`,
      version: CURRENT_EVENT_VERSION,
      type,
      entity,
      entityId: input.entityId,
      at,
      recordedAt: new Date().toISOString(),
      actor: input.actor?.trim() || options.defaultActor || 'unknown-actor',
      source: input.source?.trim() || options.defaultSource || 'unknown-source',
      payload: input.payload ?? {},
      refs: input.refs ?? [],
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      seq: nextSerial(),
      warnings,
    };
    this.events.push(event);
    if (input.idempotencyKey) this.idempotencyKeys.set(input.idempotencyKey, event.id);
    return { event, duplicate: false, warnings };
  }

  /** 种子/快照批量导入：按业务时间排序后入帐，不做乱序拦截（仅启动基线使用）。 */
  bootstrap(items: Array<EventInput & { id: string; at: string; actor: string; source: string }>): number {
    let imported = 0;
    const sorted = [...items].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    for (const item of sorted) {
      if (this.events.some(event => event.id === item.id)) continue;
      const entity = item.entity ?? safeEntityOf(item.type);
      const event: JobEvent = {
        id: item.id, version: CURRENT_EVENT_VERSION, type: item.type, entity,
        entityId: item.entityId, at: item.at, recordedAt: new Date().toISOString(),
        actor: item.actor, source: item.source, payload: item.payload ?? {},
        refs: item.refs ?? [], seq: nextSerial(), warnings: [],
      };
      this.events.push(event);
      if (item.idempotencyKey) this.idempotencyKeys.set(item.idempotencyKey, event.id);
      imported += 1;
    }
    return imported;
  }

  query(filter: EventQuery = {}): JobEvent[] {
    let rows = this.events.slice();
    if (filter.entity && filter.entityId) {
      const includeRelated = filter.includeRelated !== false;
      rows = rows.filter(event => includeRelated
        ? eventRelatesTo(event, filter.entity!, filter.entityId!)
        : event.entity === filter.entity && event.entityId === filter.entityId);
    } else if (filter.entityId) {
      rows = rows.filter(event => event.entityId === filter.entityId || event.refs.some(ref => ref.entityId === filter.entityId));
    }
    if (filter.types?.length) {
      const set = new Set(filter.types);
      rows = rows.filter(event => set.has(event.type));
    }
    if (filter.from) {
      const from = new Date(filter.from).getTime();
      rows = rows.filter(event => new Date(event.at).getTime() >= from);
    }
    if (filter.to) {
      const to = new Date(filter.to).getTime();
      rows = rows.filter(event => new Date(event.at).getTime() <= to);
    }
    if (filter.source) rows = rows.filter(event => event.source === filter.source);
    if (filter.actor) rows = rows.filter(event => event.actor === filter.actor);
    rows.sort(byTimeSeq);
    if (filter.order === 'desc') rows.reverse();
    if (filter.limit !== undefined) rows = rows.slice(0, filter.limit);
    return rows;
  }

  count() { return this.events.length; }
  all() { return this.events.slice().sort(byTimeSeq); }
}

function safeEntityOf(type: LedgerEventType): LedgerEntity {
  return entityOfEventType(type);
}

export const ledger = new EventLedger();

// ---------------------------------------------------------------------------
// 回放：从事件流重建实体当前视图
// ---------------------------------------------------------------------------

export interface TimelineStep {
  eventId: string;
  seq: number;
  type: LedgerEventType;
  label: string;
  at: string;
  actor: string;
  source: string;
  summary: string;
  warnings: string[];
}

export interface ReplayedContainer {
  exists: boolean;
  id: string;
  voyageId?: string;
  size?: string;
  isoType?: string;
  direction?: string;
  status?: string;
  customs?: string;
  yardSlot?: string;
  weightT?: number;
  reefer?: boolean;
  temperature?: number;
  hazmatClass?: string;
  priority?: string;
  appointmentId?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface ReplayedTask {
  exists: boolean;
  id: string;
  kind?: string;
  containerId?: string;
  from?: string;
  to?: string;
  equipmentId?: string;
  priority?: number;
  status?: string;
  scheduledAt?: string;
  estimatedMinutes?: number;
  blockingReasons: string[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface ReplayedAppointment {
  exists: boolean;
  id: string;
  containerId?: string;
  truckNo?: string;
  driver?: string;
  type?: string;
  windowStart?: string;
  windowEnd?: string;
  lane?: string;
  status?: string;
  sealVerified?: boolean;
  weightVerified?: boolean;
  exception?: string;
  createdAt?: string;
  deletedAt?: string;
}

export interface ReplayedVoyage {
  exists: boolean;
  id: string;
  status?: string;
  movesPlanned?: number;
  movesDone?: number;
  eta?: string;
  etd?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReplayResult<T> {
  entity: LedgerEntity;
  entityId: string;
  current: T;
  eventCount: number;
  outOfOrderCount: number;
  appliedEventIds: string[];
  timeline: TimelineStep[];
}

function fail(event: JobEvent | undefined, message: string): never {
  throw new LedgerError('REPLAY_FAILED', message, event ? {
    eventId: event.id, type: event.type, at: event.at, entity: event.entity, entityId: event.entityId,
  } : undefined);
}

function requirePayloadValue(event: JobEvent, key: string): unknown {
  const value = event.payload[key];
  if (value === undefined || value === null || value === '') {
    fail(event, `回放失败：事件 ${event.id}（${event.type}）缺少必填字段 payload.${key}`);
  }
  return value;
}

function step(event: JobEvent, summary: string): TimelineStep {
  return { eventId: event.id, seq: event.seq, type: event.type, label: EVENT_LABELS[event.type], at: event.at, actor: event.actor, source: event.source, summary, warnings: event.warnings };
}

const CONTAINER_MERGE_KEYS = ['voyageId', 'size', 'isoType', 'direction', 'status', 'weightT', 'reefer', 'temperature', 'hazmatClass', 'customs', 'priority', 'yardSlot'] as const;

export function replayContainer(containerId: string): ReplayResult<ReplayedContainer> {
  const events = ledger.query({ entity: 'container', entityId: containerId }).sort((a, b) => a.seq - b.seq);
  if (!events.length) throw new LedgerError('ENTITY_NOT_FOUND', `箱子 ${containerId} 在事件账本中没有任何事件，无法回放`);
  let state: ReplayedContainer | null = null;
  const timeline: TimelineStep[] = [];
  let outOfOrderCount = 0;
  const ensure = (event: JobEvent): ReplayedContainer => {
    if (!state) fail(event, `回放失败：箱子 ${containerId} 缺少 container.created 基线事件，却收到 ${event.type}`);
    if (!state.exists) fail(event, `回放失败：箱子 ${containerId} 已删除，之后不能再应用 ${event.type}（请使用补录事件流程）`);
    return state;
  };
  for (const event of events) {
    if (event.warnings.includes('out-of-order')) outOfOrderCount += 1;
    switch (event.type) {
      case 'container.created': {
        if (state) fail(event, `回放失败：箱子 ${containerId} 被重复建档`);
        for (const key of ['voyageId', 'size', 'isoType', 'direction', 'status', 'weightT', 'reefer', 'customs', 'priority', 'yardSlot']) {
          requirePayloadValue(event, key);
        }
        state = {
          exists: true, id: containerId,
          voyageId: String(event.payload.voyageId), size: String(event.payload.size),
          isoType: String(event.payload.isoType), direction: String(event.payload.direction),
          status: String(event.payload.status), weightT: Number(event.payload.weightT),
          reefer: Boolean(event.payload.reefer), customs: String(event.payload.customs),
          priority: String(event.payload.priority), yardSlot: String(event.payload.yardSlot),
          ...(event.payload.temperature !== undefined ? { temperature: Number(event.payload.temperature) } : {}),
          ...(event.payload.hazmatClass ? { hazmatClass: String(event.payload.hazmatClass) } : {}),
          createdAt: event.at, updatedAt: event.at,
        };
        timeline.push(step(event, `建档：${event.payload.direction} / ${event.payload.size}ft，初始堆位 ${event.payload.yardSlot}`));
        break;
      }
      case 'container.updated': {
        const current = ensure(event);
        const fields = event.payload.fields as Record<string, unknown> | undefined;
        if (!fields || typeof fields !== 'object') fail(event, '回放失败：container.updated 缺少 payload.fields');
        for (const key of CONTAINER_MERGE_KEYS) if (fields[key] !== undefined) (current as unknown as Record<string, unknown>)[key] = fields[key];
        current.updatedAt = event.at;
        timeline.push(step(event, `字段更新：${Object.keys(fields).join('、')}`));
        break;
      }
      case 'container.status-changed': {
        const current = ensure(event);
        const from = event.payload.from, to = requirePayloadValue(event, 'to');
        current.status = String(to); current.updatedAt = event.at;
        timeline.push(step(event, `状态：${from ?? '?'} → ${to}`));
        break;
      }
      case 'container.slot-changed': {
        const current = ensure(event);
        const to = requirePayloadValue(event, 'to');
        timeline.push(step(event, `换堆位：${event.payload.from ?? current.yardSlot} → ${to}${event.payload.reason ? `（${event.payload.reason}）` : ''}`));
        current.yardSlot = String(to); current.updatedAt = event.at;
        break;
      }
      case 'container.customs-changed': {
        const current = ensure(event);
        const to = requirePayloadValue(event, 'to');
        timeline.push(step(event, `海关状态：${event.payload.from ?? current.customs} → ${to}${event.payload.reason ? `（${event.payload.reason}）` : ''}`));
        current.customs = String(to); current.updatedAt = event.at;
        break;
      }
      case 'container.deleted': {
        const current = ensure(event);
        current.exists = false; current.deletedAt = event.at;
        timeline.push(step(event, `删除箱务记录${event.payload.reason ? `（${event.payload.reason}）` : ''}`));
        break;
      }
      case 'gate.appointment-created': {
        if (state?.exists) {
          state.appointmentId = event.entityId; state.updatedAt = event.at;
        }
        timeline.push(step(event, `关联预约 ${event.entityId}（${event.payload.type ?? ''}）创建`));
        break;
      }
      case 'gate.appointment-status-changed': {
        if (state?.exists) {
          const to = String(requirePayloadValue(event, 'to'));
          if (to === 'checked-in') state.status = 'at-gate';
          if (to === 'completed') state.status = event.payload.type === 'pickup' ? 'released' : 'in-yard';
          if (to === 'cancelled' && state.appointmentId === event.entityId) state.appointmentId = undefined;
          state.updatedAt = event.at;
        }
        timeline.push(step(event, `关联预约 ${event.entityId} 状态 → ${event.payload.to}`));
        break;
      }
      case 'gate.appointment-deleted': {
        if (state && state.appointmentId === event.entityId) state.appointmentId = undefined;
        timeline.push(step(event, `关联预约 ${event.entityId} 删除`));
        break;
      }
      case 'task.status-changed': {
        timeline.push(step(event, `关联任务 ${event.entityId} 状态 → ${event.payload.to ?? '?'}${event.payload.kind ? `（${event.payload.kind}）` : ''}`));
        break;
      }
      case 'task.assigned': {
        timeline.push(step(event, `关联任务 ${event.entityId} 指派 ${event.payload.equipmentId ?? '?'}${event.payload.feasible === false ? '，但资源不可用已阻塞' : ''}`));
        break;
      }
      case 'task.replanned': {
        timeline.push(step(event, `关联任务 ${event.entityId} 重排${event.payload.reason ? `：${event.payload.reason}` : ''}`));
        break;
      }
      default:
        timeline.push(step(event, EVENT_LABELS[event.type]));
    }
  }
  if (!state) fail(undefined, `回放失败：箱子 ${containerId} 的事件流中没有建档事件`);
  return { entity: 'container', entityId: containerId, current: state!, eventCount: events.length, outOfOrderCount, appliedEventIds: events.map(e => e.id), timeline: timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.seq - b.seq) };
}

export function replayTask(taskId: string): ReplayResult<ReplayedTask> {
  const events = ledger.query({ entity: 'task', entityId: taskId, includeRelated: false }).sort((a, b) => a.seq - b.seq);
  if (!events.length) throw new LedgerError('ENTITY_NOT_FOUND', `任务 ${taskId} 在事件账本中没有任何事件，无法回放`);
  let state: ReplayedTask | null = null;
  const timeline: TimelineStep[] = [];
  let outOfOrderCount = 0;
  const ensure = (event: JobEvent): ReplayedTask => {
    if (!state) fail(event, `回放失败：任务 ${taskId} 缺少 task.created 基线事件，却收到 ${event.type}`);
    if (!state.exists) fail(event, `回放失败：任务 ${taskId} 已删除，之后不能再应用 ${event.type}`);
    return state;
  };
  for (const event of events) {
    if (event.warnings.includes('out-of-order')) outOfOrderCount += 1;
    switch (event.type) {
      case 'task.created': {
        if (state) fail(event, `回放失败：任务 ${taskId} 被重复创建`);
        for (const key of ['kind', 'containerId', 'from', 'to', 'scheduledAt', 'estimatedMinutes']) requirePayloadValue(event, key);
        state = {
          exists: true, id: taskId, kind: String(event.payload.kind), containerId: String(event.payload.containerId),
          from: String(event.payload.from), to: String(event.payload.to),
          ...(event.payload.equipmentId ? { equipmentId: String(event.payload.equipmentId) } : {}),
          priority: Number(event.payload.priority ?? 50),
          status: event.payload.status ? String(event.payload.status) : (event.payload.equipmentId ? 'assigned' : 'queued'),
          scheduledAt: String(event.payload.scheduledAt), estimatedMinutes: Number(event.payload.estimatedMinutes),
          blockingReasons: Array.isArray(event.payload.blockingReasons) ? event.payload.blockingReasons.map(String) : [],
          createdAt: event.at, updatedAt: event.at,
        };
        timeline.push(step(event, `创建 ${event.payload.kind} 任务：${event.payload.from} → ${event.payload.to}`));
        break;
      }
      case 'task.updated': {
        const current = ensure(event);
        const fields = event.payload.fields as Record<string, unknown> | undefined;
        if (!fields || typeof fields !== 'object') fail(event, '回放失败：task.updated 缺少 payload.fields');
        for (const key of ['kind', 'from', 'to', 'equipmentId', 'priority', 'scheduledAt', 'estimatedMinutes']) {
          if (fields[key] !== undefined) (current as unknown as Record<string, unknown>)[key] = fields[key];
        }
        current.updatedAt = event.at;
        timeline.push(step(event, `字段更新：${Object.keys(fields).join('、')}`));
        break;
      }
      case 'task.assigned': {
        const current = ensure(event);
        const equipmentId = String(requirePayloadValue(event, 'equipmentId'));
        const reasons = Array.isArray(event.payload.reasons) ? event.payload.reasons.map(String) : [];
        current.equipmentId = equipmentId;
        current.blockingReasons = Array.from(new Set([...current.blockingReasons.filter(r => !/当前不可用/.test(r)), ...reasons]));
        current.status = event.payload.feasible === false ? 'blocked' : 'assigned';
        current.updatedAt = event.at;
        timeline.push(step(event, `指派设备 ${equipmentId}${event.payload.feasible === false ? '，设备不可用 → blocked' : ''}`));
        break;
      }
      case 'task.status-changed': {
        const current = ensure(event);
        const to = String(requirePayloadValue(event, 'to'));
        current.status = to;
        if (Array.isArray(event.payload.reasons)) current.blockingReasons = event.payload.reasons.map(String);
        current.updatedAt = event.at;
        timeline.push(step(event, `任务状态 → ${to}${Array.isArray(event.payload.reasons) && event.payload.reasons.length ? `；阻塞原因：${event.payload.reasons.join('、')}` : ''}`));
        break;
      }
      case 'task.replanned': {
        const current = ensure(event);
        for (const key of ['from', 'to', 'scheduledAt', 'priority', 'equipmentId']) {
          if (event.payload[key] !== undefined && event.payload[key] !== null) (current as unknown as Record<string, unknown>)[key] = event.payload[key];
        }
        if (Array.isArray(event.payload.reasons)) current.blockingReasons = event.payload.reasons.map(String);
        current.updatedAt = event.at;
        timeline.push(step(event, `任务重排${event.payload.reason ? `：${event.payload.reason}` : ''}`));
        break;
      }
      case 'task.deleted': {
        const current = ensure(event);
        current.exists = false; current.deletedAt = event.at;
        timeline.push(step(event, '删除任务'));
        break;
      }
      default:
        timeline.push(step(event, EVENT_LABELS[event.type]));
    }
  }
  if (!state) fail(undefined, `回放失败：任务 ${taskId} 的事件流中没有创建事件`);
  return { entity: 'task', entityId: taskId, current: state!, eventCount: events.length, outOfOrderCount, appliedEventIds: events.map(e => e.id), timeline: timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.seq - b.seq) };
}

export function replayAppointment(appointmentId: string): ReplayResult<ReplayedAppointment> {
  const events = ledger.query({ entity: 'appointment', entityId: appointmentId, includeRelated: false }).sort((a, b) => a.seq - b.seq);
  if (!events.length) throw new LedgerError('ENTITY_NOT_FOUND', `预约 ${appointmentId} 在事件账本中没有任何事件，无法回放`);
  let state: ReplayedAppointment | null = null;
  const timeline: TimelineStep[] = [];
  let outOfOrderCount = 0;
  const ensure = (event: JobEvent): ReplayedAppointment => {
    if (!state) fail(event, `回放失败：预约 ${appointmentId} 缺少创建基线事件，却收到 ${event.type}`);
    if (!state.exists) fail(event, `回放失败：预约 ${appointmentId} 已删除，之后不能再应用 ${event.type}`);
    return state;
  };
  for (const event of events) {
    if (event.warnings.includes('out-of-order')) outOfOrderCount += 1;
    switch (event.type) {
      case 'gate.appointment-created': {
        if (state) fail(event, `回放失败：预约 ${appointmentId} 被重复创建`);
        for (const key of ['containerId', 'truckNo', 'driver', 'type', 'windowStart', 'windowEnd', 'lane']) requirePayloadValue(event, key);
        state = {
          exists: true, id: appointmentId, containerId: String(event.payload.containerId),
          truckNo: String(event.payload.truckNo), driver: String(event.payload.driver),
          type: String(event.payload.type), windowStart: String(event.payload.windowStart),
          windowEnd: String(event.payload.windowEnd), lane: String(event.payload.lane),
          status: 'booked', sealVerified: false, weightVerified: false, createdAt: event.at,
        };
        timeline.push(step(event, `预约创建：${event.payload.truckNo} / ${event.payload.lane} 闸口`));
        break;
      }
      case 'gate.appointment-updated': {
        const current = ensure(event);
        const fields = event.payload.fields as Record<string, unknown> | undefined;
        if (!fields || typeof fields !== 'object') fail(event, '回放失败：gate.appointment-updated 缺少 payload.fields');
        for (const key of ['truckNo', 'driver', 'windowStart', 'windowEnd', 'lane', 'sealVerified', 'weightVerified', 'exception']) {
          if (fields[key] !== undefined) (current as unknown as Record<string, unknown>)[key] = fields[key];
        }
        timeline.push(step(event, `预约更新：${Object.keys(fields).join('、')}`));
        break;
      }
      case 'gate.appointment-status-changed': {
        const current = ensure(event);
        current.status = String(requirePayloadValue(event, 'to'));
        if (event.payload.exception !== undefined) current.exception = event.payload.exception === null ? undefined : String(event.payload.exception);
        timeline.push(step(event, `预约状态 → ${event.payload.to}`));
        break;
      }
      case 'gate.appointment-deleted': {
        const current = ensure(event);
        current.exists = false; current.deletedAt = event.at;
        timeline.push(step(event, '预约删除'));
        break;
      }
      default:
        timeline.push(step(event, EVENT_LABELS[event.type]));
    }
  }
  if (!state) fail(undefined, `回放失败：预约 ${appointmentId} 的事件流中没有创建事件`);
  return { entity: 'appointment', entityId: appointmentId, current: state!, eventCount: events.length, outOfOrderCount, appliedEventIds: events.map(e => e.id), timeline: timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.seq - b.seq) };
}

export function replayVoyage(voyageId: string): ReplayResult<ReplayedVoyage> {
  const events = ledger.query({ entity: 'voyage', entityId: voyageId, includeRelated: false }).sort((a, b) => a.seq - b.seq);
  if (!events.length) throw new LedgerError('ENTITY_NOT_FOUND', `航次 ${voyageId} 在事件账本中没有任何事件，无法回放`);
  let state: ReplayedVoyage = { exists: true, id: voyageId, movesDone: 0 };
  const timeline: TimelineStep[] = [];
  let outOfOrderCount = 0;
  for (const event of events) {
    if (event.warnings.includes('out-of-order')) outOfOrderCount += 1;
    switch (event.type) {
      case 'voyage.status-changed':
        timeline.push(step(event, `航次状态：${event.payload.from ?? '?'} → ${requirePayloadValue(event, 'to')}`));
        state.status = String(event.payload.to); state.updatedAt = event.at;
        break;
      case 'voyage.progress': {
        const movesDone = Number(requirePayloadValue(event, 'movesDone'));
        timeline.push(step(event, `作业进度：${event.payload.from ?? state.movesDone} → ${movesDone} moves${event.payload.status ? `，航次状态 ${event.payload.status}` : ''}`));
        state.movesDone = movesDone;
        if (event.payload.movesPlanned !== undefined) state.movesPlanned = Number(event.payload.movesPlanned);
        if (event.payload.status) state.status = String(event.payload.status);
        state.updatedAt = event.at;
        break;
      }
      case 'voyage.eta-changed':
        state.eta = String(requirePayloadValue(event, 'to')); state.updatedAt = event.at;
        timeline.push(step(event, `ETA：${event.payload.from ?? '?'} → ${event.payload.to}${event.payload.reason ? `（${event.payload.reason}）` : ''}`));
        break;
      case 'voyage.etd-changed':
        state.etd = String(requirePayloadValue(event, 'to')); state.updatedAt = event.at;
        timeline.push(step(event, `ETD：${event.payload.from ?? '?'} → ${event.payload.to}${event.payload.reason ? `（${event.payload.reason}）` : ''}`));
        break;
      default:
        timeline.push(step(event, EVENT_LABELS[event.type]));
    }
  }
  return { entity: 'voyage', entityId: voyageId, current: state, eventCount: events.length, outOfOrderCount, appliedEventIds: events.map(e => e.id), timeline: timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.seq - b.seq) };
}
