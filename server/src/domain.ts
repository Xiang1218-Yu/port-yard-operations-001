import {
  EVENT_LABELS, ledger, LedgerError, replayAppointment, replayContainer, replayTask, replayVoyage,
  type AppendResult, type EventInput, type EventRef, type EventQuery, type JobEvent, type LedgerEntity, type LedgerEventType,
  type ReplayedAppointment, type ReplayedContainer, type ReplayedTask, type ReplayedVoyage, type TimelineStep,
} from './ledger.js';

export type ContainerStatus = 'in-transit' | 'at-gate' | 'in-yard' | 'on-quay' | 'released' | 'hold';
export type EquipmentKind = 'quay-crane' | 'yard-crane' | 'terminal-truck' | 'reach-stacker';
export type TaskStatus = 'queued' | 'assigned' | 'executing' | 'blocked' | 'done';
export type AppointmentStatus = 'booked' | 'checked-in' | 'completed' | 'cancelled' | 'exception';

export interface Voyage { id: string; vessel: string; imo: string; service: string; eta: string; etd: string; status: 'approaching' | 'berthed' | 'loading' | 'departed'; berth: string; movesPlanned: number; movesDone: number; lateRisk: 'low' | 'medium' | 'high'; }
export interface Container { id: string; voyageId: string; size: '20' | '40' | '45'; isoType: string; direction: 'import' | 'export' | 'transshipment'; status: ContainerStatus; weightT: number; reefer: boolean; temperature?: number; hazmatClass?: string; customs: 'released' | 'inspection' | 'hold'; priority: 'normal' | 'hot' | 'reefer' | 'hazmat'; yardSlot: string; appointmentId?: string; lastEvent: string; }
export interface YardBlock { id: string; zone: string; rows: number; tiers: number; capacity: number; occupied: number; reeferPlugs: number; usedPlugs: number; hazmatAllowed: boolean; equipment: EquipmentKind[]; heat: number; }
export interface GateAppointment { id: string; containerId: string; truckNo: string; driver: string; type: 'pickup' | 'dropoff'; windowStart: string; windowEnd: string; lane: 'north' | 'south' | 'rail'; status: AppointmentStatus; sealVerified: boolean; weightVerified: boolean; exception?: string; }
export interface Equipment { id: string; name: string; kind: EquipmentKind; status: 'available' | 'working' | 'maintenance' | 'offline'; location: string; battery: number; queue: number; movesPerHour: number; }
export interface YardTask { id: string; kind: 'receive' | 'deliver' | 'rehandle' | 'load' | 'discharge' | 'inspect'; containerId: string; from: string; to: string; equipmentId?: string; priority: number; status: TaskStatus; scheduledAt: string; blockingReasons: string[]; estimatedMinutes: number; }
export interface AuditEvent { id: string; actor: string; action: string; entity: string; entityId: string; at: string; details: string; }

const start = Date.now(); const iso = (minutes: number) => new Date(start + minutes * 60000).toISOString();
export const voyages: Voyage[] = [
  { id: 'VOY-AX7', vessel: 'MSC Aurora', imo: 'IMO9382014', service: 'AE-3', eta: iso(-90), etd: iso(350), status: 'berthed', berth: 'B07', movesPlanned: 1240, movesDone: 886, lateRisk: 'medium' },
  { id: 'VOY-QF2', vessel: 'Ever Quartz', imo: 'IMO9721103', service: 'TP9', eta: iso(190), etd: iso(890), status: 'approaching', berth: 'B04', movesPlanned: 760, movesDone: 0, lateRisk: 'high' },
  { id: 'VOY-RD8', vessel: 'ONE Redwood', imo: 'IMO9812340', service: 'PNW', eta: iso(-700), etd: iso(-330), status: 'departed', berth: 'B02', movesPlanned: 520, movesDone: 520, lateRisk: 'low' }
];
export const blocks: YardBlock[] = [
  { id: 'A01', zone: 'North Import', rows: 14, tiers: 5, capacity: 280, occupied: 247, reeferPlugs: 18, usedPlugs: 16, hazmatAllowed: false, equipment: ['yard-crane', 'terminal-truck'], heat: 78 },
  { id: 'B07', zone: 'Central Transshipment', rows: 18, tiers: 5, capacity: 360, occupied: 302, reeferPlugs: 24, usedPlugs: 19, hazmatAllowed: true, equipment: ['yard-crane', 'reach-stacker', 'terminal-truck'], heat: 91 },
  { id: 'C03', zone: 'Export Pre-staging', rows: 12, tiers: 4, capacity: 192, occupied: 128, reeferPlugs: 8, usedPlugs: 3, hazmatAllowed: false, equipment: ['yard-crane', 'terminal-truck'], heat: 54 },
  { id: 'D05', zone: 'Inspection & Hold', rows: 8, tiers: 3, capacity: 96, occupied: 72, reeferPlugs: 5, usedPlugs: 4, hazmatAllowed: true, equipment: ['reach-stacker'], heat: 63 }
];
export const containers: Container[] = [
  { id: 'MSCU-4829017', voyageId: 'VOY-AX7', size: '40', isoType: '45G1', direction: 'import', status: 'in-yard', weightT: 22.4, reefer: false, customs: 'released', priority: 'hot', yardSlot: 'A01-R07-T3', appointmentId: 'APT-9002', lastEvent: '卸船完成 08:42' },
  { id: 'EISU-1288420', voyageId: 'VOY-AX7', size: '40', isoType: '45R1', direction: 'import', status: 'in-yard', weightT: 27.8, reefer: true, temperature: -18, customs: 'released', priority: 'reefer', yardSlot: 'B07-R03-T2', appointmentId: 'APT-9003', lastEvent: '温度回传正常 08:51' },
  { id: 'TGHU-9831204', voyageId: 'VOY-AX7', size: '20', isoType: '22K2', direction: 'transshipment', status: 'hold', weightT: 19.7, reefer: false, hazmatClass: '3', customs: 'inspection', priority: 'hazmat', yardSlot: 'D05-R02-T1', lastEvent: '海关查验挂起' },
  { id: 'OOLU-7734201', voyageId: 'VOY-AX7', size: '40', isoType: '45G1', direction: 'export', status: 'at-gate', weightT: 24.1, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R06-T1', appointmentId: 'APT-9001', lastEvent: '南闸口已称重' },
  { id: 'CMAU-6001722', voyageId: 'VOY-QF2', size: '40', isoType: '45G1', direction: 'import', status: 'in-transit', weightT: 23.5, reefer: false, customs: 'released', priority: 'hot', yardSlot: 'B07-R10-T1', lastEvent: '船期 ETA +35min' },
  { id: 'FCIU-9920310', voyageId: 'VOY-QF2', size: '20', isoType: '22G1', direction: 'export', status: 'in-yard', weightT: 12.2, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R04-T2', appointmentId: 'APT-9004', lastEvent: '待装船' },
  { id: 'TEMU-1774029', voyageId: 'VOY-AX7', size: '40', isoType: '45R1', direction: 'import', status: 'in-yard', weightT: 26.3, reefer: true, temperature: 4, customs: 'inspection', priority: 'reefer', yardSlot: 'D05-R05-T1', lastEvent: '待海关查验' }
];
export const appointments: GateAppointment[] = [
  { id: 'APT-9001', containerId: 'OOLU-7734201', truckNo: '沪A·7K229', driver: '陈海', type: 'dropoff', windowStart: iso(-14), windowEnd: iso(16), lane: 'south', status: 'checked-in', sealVerified: true, weightVerified: true },
  { id: 'APT-9002', containerId: 'MSCU-4829017', truckNo: '苏E·66218', driver: '王建国', type: 'pickup', windowStart: iso(34), windowEnd: iso(64), lane: 'north', status: 'booked', sealVerified: false, weightVerified: false },
  { id: 'APT-9003', containerId: 'EISU-1288420', truckNo: '沪B·02891', driver: '赵晨', type: 'pickup', windowStart: iso(38), windowEnd: iso(68), lane: 'north', status: 'booked', sealVerified: false, weightVerified: false },
  { id: 'APT-9004', containerId: 'FCIU-9920310', truckNo: '沪A·7K229', driver: '陈海', type: 'pickup', windowStart: iso(4), windowEnd: iso(22), lane: 'south', status: 'booked', sealVerified: false, weightVerified: false, exception: '同一车辆相邻窗口过短' }
];
export const equipment: Equipment[] = [
  { id: 'QC-07', name: '岸桥 QC-07', kind: 'quay-crane', status: 'working', location: 'B07 / MSC Aurora', battery: 96, queue: 4, movesPerHour: 31 },
  { id: 'YC-12', name: '场桥 YC-12', kind: 'yard-crane', status: 'working', location: 'B07-R03', battery: 72, queue: 9, movesPerHour: 24 },
  { id: 'YC-05', name: '场桥 YC-05', kind: 'yard-crane', status: 'available', location: 'C03-R06', battery: 88, queue: 3, movesPerHour: 27 },
  { id: 'TT-31', name: '集卡 TT-31', kind: 'terminal-truck', status: 'working', location: '南闸口', battery: 61, queue: 2, movesPerHour: 8 },
  { id: 'RS-02', name: '正面吊 RS-02', kind: 'reach-stacker', status: 'maintenance', location: 'D05', battery: 34, queue: 0, movesPerHour: 14 }
];
export const tasks: YardTask[] = [
  { id: 'TASK-101', kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01-R07-T3', to: '南闸口', equipmentId: 'YC-12', priority: 92, status: 'assigned', scheduledAt: iso(12), blockingReasons: [], estimatedMinutes: 18 },
  { id: 'TASK-102', kind: 'rehandle', containerId: 'EISU-1288420', from: 'B07-R03-T2', to: 'D05-R05-T1', equipmentId: 'YC-12', priority: 88, status: 'queued', scheduledAt: iso(24), blockingReasons: ['查验区插件余量接近阈值'], estimatedMinutes: 26 },
  { id: 'TASK-103', kind: 'inspect', containerId: 'TGHU-9831204', from: 'D05-R02-T1', to: 'D05-R02-T1', priority: 125, status: 'blocked', scheduledAt: iso(4), blockingReasons: ['RS-02 维护中', '待海关查验窗口'], estimatedMinutes: 32 },
  { id: 'TASK-104', kind: 'load', containerId: 'FCIU-9920310', from: 'C03-R04-T2', to: 'B07 / VOY-QF2', equipmentId: 'YC-05', priority: 75, status: 'assigned', scheduledAt: iso(76), blockingReasons: [], estimatedMinutes: 21 }
];
export const auditEvents: AuditEvent[] = [{ id: 'AUD-500', actor: '中控调度员', action: 'REPLAN', entity: 'voyage', entityId: 'VOY-AX7', at: new Date(start - 20 * 60000).toISOString(), details: '因 QC-07 瞬时降速，重新计算 14 个高优先级作业' }];

// ---------------------------------------------------------------------------
// 种子历史事件：让调度员能从“卸船”一路回溯到“待闸口/挂起/重排”
// ---------------------------------------------------------------------------

function seedLedger() {
  const t = (minutes: number) => iso(minutes);
  const box = (containerId: string, voyageId: string): EventRef[] => [
    { entity: 'container', entityId: containerId }, { entity: 'voyage', entityId: voyageId },
  ];
  ledger.bootstrap([
    // ---- MSCU-4829017：卸船 → 归位进口堆区 → 提箱任务待闸口 ----
    { id: 'EVT-S-4801', version: 1, type: 'container.created', entityId: 'MSCU-4829017', at: t(-150), actor: 'TOS 船图系统', source: 'tos', payload: { voyageId: 'VOY-AX7', size: '40', isoType: '45G1', direction: 'import', status: 'on-quay', weightT: 22.4, reefer: false, customs: 'released', priority: 'hot', yardSlot: 'B07 / MSC Aurora' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-4802', version: 1, type: 'task.created', entityId: 'TASK-DCH-4829', at: t(-112), actor: 'TOS 卸船计划', source: 'tos', payload: { kind: 'discharge', containerId: 'MSCU-4829017', from: 'B07 / MSC Aurora', to: 'B07-R12-T4', equipmentId: 'QC-07', priority: 90, scheduledAt: t(-110), estimatedMinutes: 14, status: 'assigned' }, refs: box('MSCU-4829017', 'VOY-AX7') },
    { id: 'EVT-S-4803', version: 1, type: 'task.assigned', entityId: 'TASK-DCH-4829', at: t(-110), actor: '中控调度员', source: 'terminal-console', payload: { equipmentId: 'QC-07', equipmentName: '岸桥 QC-07', containerId: 'MSCU-4829017', feasible: true, reasons: [] }, refs: box('MSCU-4829017', 'VOY-AX7') },
    { id: 'EVT-S-4804', version: 1, type: 'task.status-changed', entityId: 'TASK-DCH-4829', at: t(-107), actor: '岸桥 QC-07', source: 'telemetry', payload: { to: 'executing', from: 'assigned', containerId: 'MSCU-4829017' }, refs: box('MSCU-4829017', 'VOY-AX7') },
    { id: 'EVT-S-4805', version: 1, type: 'container.slot-changed', entityId: 'MSCU-4829017', at: t(-100), actor: '场桥 YC-12', source: 'tos', payload: { from: 'B07 / MSC Aurora', to: 'B07-R12-T4', reason: '卸船落位中转区' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-4806', version: 1, type: 'task.status-changed', entityId: 'TASK-DCH-4829', at: t(-96), actor: '岸桥 QC-07', source: 'telemetry', payload: { to: 'done', from: 'executing', containerId: 'MSCU-4829017' }, refs: box('MSCU-4829017', 'VOY-AX7') },
    { id: 'EVT-S-4807', version: 1, type: 'container.status-changed', entityId: 'MSCU-4829017', at: t(-96), actor: 'TOS 卸船确认', source: 'tos', payload: { from: 'on-quay', to: 'in-yard', reason: '卸船完成 08:42' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-4808', version: 1, type: 'container.slot-changed', entityId: 'MSCU-4829017', at: t(-20), actor: '中控调度员', source: 'terminal-console', payload: { from: 'B07-R12-T4', to: 'A01-R07-T3', reason: '归位北进口堆区（一次翻箱），释放 B07 热区' } },
    { id: 'EVT-S-4809', version: 1, type: 'gate.appointment-created', entityId: 'APT-9002', at: t(-30), actor: '集卡预约平台', source: 'gate-app', payload: { containerId: 'MSCU-4829017', truckNo: '苏E·66218', driver: '王建国', type: 'pickup', windowStart: t(34), windowEnd: t(64), lane: 'north' }, refs: [{ entity: 'container', entityId: 'MSCU-4829017' }] },
    { id: 'EVT-S-4810', version: 1, type: 'task.created', entityId: 'TASK-101', at: t(-22), actor: '中控调度员', source: 'terminal-console', payload: { kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01-R07-T3', to: '南闸口', equipmentId: 'YC-12', priority: 92, scheduledAt: t(12), estimatedMinutes: 18, status: 'assigned' }, refs: box('MSCU-4829017', 'VOY-AX7') },
    { id: 'EVT-S-4811', version: 1, type: 'task.replanned', entityId: 'TASK-101', at: t(-20), actor: '中控调度员', source: 'terminal-console', payload: { reason: '因 QC-07 瞬时降速，重新计算 14 个高优先级作业，TASK-101 提前至当前窗口', scheduledAt: t(12) }, refs: box('MSCU-4829017', 'VOY-AX7') },

    // ---- EISU-1288420：冷藏箱卸船、温控回传、翻箱任务受查验区电源约束 ----
    { id: 'EVT-S-EI01', version: 1, type: 'container.created', entityId: 'EISU-1288420', at: t(-140), actor: 'TOS 船图系统', source: 'tos', payload: { voyageId: 'VOY-AX7', size: '40', isoType: '45R1', direction: 'import', status: 'on-quay', weightT: 27.8, reefer: true, temperature: -18, customs: 'released', priority: 'reefer', yardSlot: 'B07 / MSC Aurora' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-EI02', version: 1, type: 'task.created', entityId: 'TASK-DCH-EISU', at: t(-104), actor: 'TOS 卸船计划', source: 'tos', payload: { kind: 'discharge', containerId: 'EISU-1288420', from: 'B07 / MSC Aurora', to: 'B07-R03-T2', equipmentId: 'QC-07', priority: 95, scheduledAt: t(-102), estimatedMinutes: 12, status: 'assigned' }, refs: box('EISU-1288420', 'VOY-AX7') },
    { id: 'EVT-S-EI03', version: 1, type: 'task.status-changed', entityId: 'TASK-DCH-EISU', at: t(-101), actor: '岸桥 QC-07', source: 'telemetry', payload: { to: 'executing', from: 'assigned', containerId: 'EISU-1288420' }, refs: box('EISU-1288420', 'VOY-AX7') },
    { id: 'EVT-S-EI04', version: 1, type: 'container.slot-changed', entityId: 'EISU-1288420', at: t(-95), actor: '场桥 YC-12', source: 'tos', payload: { from: 'B07 / MSC Aurora', to: 'B07-R03-T2', reason: '冷藏箱就近接入冷插位' } },
    { id: 'EVT-S-EI05', version: 1, type: 'task.status-changed', entityId: 'TASK-DCH-EISU', at: t(-92), actor: '岸桥 QC-07', source: 'telemetry', payload: { to: 'done', from: 'executing', containerId: 'EISU-1288420' }, refs: box('EISU-1288420', 'VOY-AX7') },
    { id: 'EVT-S-EI06', version: 1, type: 'container.status-changed', entityId: 'EISU-1288420', at: t(-92), actor: 'TOS 卸船确认', source: 'tos', payload: { from: 'on-quay', to: 'in-yard' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-EI07', version: 1, type: 'container.updated', entityId: 'EISU-1288420', at: t(-70), actor: '冷插监控', source: 'telemetry', payload: { fields: { temperature: -18 }, summary: '温度回传正常 08:51' } },
    { id: 'EVT-S-EI08', version: 1, type: 'gate.appointment-created', entityId: 'APT-9003', at: t(-25), actor: '集卡预约平台', source: 'gate-app', payload: { containerId: 'EISU-1288420', truckNo: '沪B·02891', driver: '赵晨', type: 'pickup', windowStart: t(38), windowEnd: t(68), lane: 'north' }, refs: [{ entity: 'container', entityId: 'EISU-1288420' }] },
    { id: 'EVT-S-EI09', version: 1, type: 'task.created', entityId: 'TASK-102', at: t(-18), actor: '中控调度员', source: 'terminal-console', payload: { kind: 'rehandle', containerId: 'EISU-1288420', from: 'B07-R03-T2', to: 'D05-R05-T1', priority: 88, scheduledAt: t(24), estimatedMinutes: 26, status: 'queued' }, refs: box('EISU-1288420', 'VOY-AX7') },
    { id: 'EVT-S-EI10', version: 1, type: 'task.replanned', entityId: 'TASK-102', at: t(-6), actor: '中控调度员', source: 'terminal-console', payload: { equipmentId: 'YC-12', reasons: ['查验区插件余量接近阈值'], reason: '指派 YC-12 但查验区冷插余量紧张，任务暂不升级为 assigned' }, refs: [{ entity: 'equipment', entityId: 'YC-12' }, ...box('EISU-1288420', 'VOY-AX7')] },
    // ---- TGHU-9831204：危险品中转 → 隔离移箱 → 海关查验挂起 ----
    { id: 'EVT-S-TG01', version: 1, type: 'container.created', entityId: 'TGHU-9831204', at: t(-130), actor: 'TOS 船图系统', source: 'tos', payload: { voyageId: 'VOY-AX7', size: '20', isoType: '22K2', direction: 'transshipment', status: 'on-quay', weightT: 19.7, reefer: false, hazmatClass: '3', customs: 'released', priority: 'hazmat', yardSlot: 'B07 / MSC Aurora' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-TG02', version: 1, type: 'task.created', entityId: 'TASK-DCH-TGHU', at: t(-108), actor: 'TOS 卸船计划', source: 'tos', payload: { kind: 'discharge', containerId: 'TGHU-9831204', from: 'B07 / MSC Aurora', to: 'B07-R09-T2', equipmentId: 'QC-07', priority: 96, scheduledAt: t(-106), estimatedMinutes: 10, status: 'assigned' }, refs: box('TGHU-9831204', 'VOY-AX7') },
    { id: 'EVT-S-TG03', version: 1, type: 'task.status-changed', entityId: 'TASK-DCH-TGHU', at: t(-105), actor: '岸桥 QC-07', source: 'telemetry', payload: { to: 'executing', from: 'assigned', containerId: 'TGHU-9831204' }, refs: box('TGHU-9831204', 'VOY-AX7') },
    { id: 'EVT-S-TG04', version: 1, type: 'container.slot-changed', entityId: 'TGHU-9831204', at: t(-98), actor: '场桥 YC-12', source: 'tos', payload: { from: 'B07 / MSC Aurora', to: 'B07-R09-T2', reason: '危险品卸船临时落位 B07（有隔离资质）' } },
    { id: 'EVT-S-TG05', version: 1, type: 'task.status-changed', entityId: 'TASK-DCH-TGHU', at: t(-94), actor: '岸桥 QC-07', source: 'telemetry', payload: { to: 'done', from: 'executing', containerId: 'TGHU-9831204' }, refs: box('TGHU-9831204', 'VOY-AX7') },
    { id: 'EVT-S-TG06', version: 1, type: 'container.status-changed', entityId: 'TGHU-9831204', at: t(-94), actor: 'TOS 卸船确认', source: 'tos', payload: { from: 'on-quay', to: 'in-yard' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-TG07', version: 1, type: 'container.slot-changed', entityId: 'TGHU-9831204', at: t(-60), actor: '安全合规员', source: 'terminal-console', payload: { from: 'B07-R09-T2', to: 'D05-R02-T1', reason: '3 类危险品隔离要求，移入查验监管区 D05' } },
    { id: 'EVT-S-TG08', version: 1, type: 'container.customs-changed', entityId: 'TGHU-9831204', at: t(-46), actor: '海关单一窗口', source: 'customs', payload: { from: 'released', to: 'inspection', reason: '海关布控查验，命中危化品随机抽查' } },
    { id: 'EVT-S-TG09', version: 1, type: 'container.status-changed', entityId: 'TGHU-9831204', at: t(-46), actor: '海关单一窗口', source: 'customs', payload: { from: 'in-yard', to: 'hold', reason: '海关查验挂起' } },
    { id: 'EVT-S-TG10', version: 1, type: 'task.created', entityId: 'TASK-103', at: t(-20), actor: '中控调度员', source: 'terminal-console', payload: { kind: 'inspect', containerId: 'TGHU-9831204', from: 'D05-R02-T1', to: 'D05-R02-T1', priority: 125, scheduledAt: t(4), estimatedMinutes: 32, status: 'queued' }, refs: box('TGHU-9831204', 'VOY-AX7') },
    { id: 'EVT-S-TG11', version: 1, type: 'task.replanned', entityId: 'TASK-103', at: t(-10), actor: '中控调度员', source: 'terminal-console', payload: { reasons: ['RS-02 维护中', '待海关查验窗口'], reason: '正面吊 RS-02 进入保养窗口，且海关查验窗口未确认' }, refs: [{ entity: 'equipment', entityId: 'RS-02' }] },
    { id: 'EVT-S-TG12', version: 1, type: 'task.status-changed', entityId: 'TASK-103', at: t(-5), actor: '调度规则引擎', source: 'terminal-console', payload: { to: 'blocked', from: 'queued', reasons: ['RS-02 维护中', '待海关查验窗口'] } },

    // ---- OOLU-7734201：出口箱进场，南闸口签到+称重 ----
    { id: 'EVT-S-OO01', version: 1, type: 'container.created', entityId: 'OOLU-7734201', at: t(-120), actor: '闸口 OCR 建档', source: 'gate-ocr', payload: { voyageId: 'VOY-AX7', size: '40', isoType: '45G1', direction: 'export', status: 'in-yard', weightT: 24.1, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R06-T1' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-OO02', version: 1, type: 'gate.appointment-created', entityId: 'APT-9001', at: t(-40), actor: '集卡预约平台', source: 'gate-app', payload: { containerId: 'OOLU-7734201', truckNo: '沪A·7K229', driver: '陈海', type: 'dropoff', windowStart: t(-14), windowEnd: t(16), lane: 'south' }, refs: [{ entity: 'container', entityId: 'OOLU-7734201' }] },
    { id: 'EVT-S-OO03', version: 1, type: 'gate.appointment-status-changed', entityId: 'APT-9001', at: t(-6), actor: '闸口值班员', source: 'gate-ocr', payload: { from: 'booked', to: 'checked-in', type: 'dropoff' }, refs: [{ entity: 'container', entityId: 'OOLU-7734201' }] },
    { id: 'EVT-S-OO04', version: 1, type: 'container.status-changed', entityId: 'OOLU-7734201', at: t(-6), actor: '闸口值班员', source: 'gate-ocr', payload: { from: 'in-yard', to: 'at-gate', reason: '车辆南闸口签到' } },
    { id: 'EVT-S-OO05', version: 1, type: 'gate.appointment-updated', entityId: 'APT-9001', at: t(-4), actor: '称重与封志系统', source: 'gate-ocr', payload: { fields: { sealVerified: true, weightVerified: true }, summary: '南闸口已称重，封志核验通过' } },

    // ---- CMAU-6001722：箱在船，ETA 延后 +35min ----
    { id: 'EVT-S-CM01', version: 1, type: 'container.created', entityId: 'CMAU-6001722', at: t(-60), actor: 'TOS 船图系统', source: 'tos', payload: { voyageId: 'VOY-QF2', size: '40', isoType: '45G1', direction: 'import', status: 'in-transit', weightT: 23.5, reefer: false, customs: 'released', priority: 'hot', yardSlot: 'B07-R10-T1' }, refs: [{ entity: 'voyage', entityId: 'VOY-QF2' }] },

    // ---- FCIU-9920310：出口待装船，装船任务 + 同车窗口冲突 ----
    { id: 'EVT-S-FC01', version: 1, type: 'container.created', entityId: 'FCIU-9920310', at: t(-90), actor: '闸口 OCR 建档', source: 'gate-ocr', payload: { voyageId: 'VOY-QF2', size: '20', isoType: '22G1', direction: 'export', status: 'in-yard', weightT: 12.2, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R04-T2' }, refs: [{ entity: 'voyage', entityId: 'VOY-QF2' }] },
    { id: 'EVT-S-FC02', version: 1, type: 'task.created', entityId: 'TASK-104', at: t(-35), actor: '中控调度员', source: 'terminal-console', payload: { kind: 'load', containerId: 'FCIU-9920310', from: 'C03-R04-T2', to: 'B07 / VOY-QF2', equipmentId: 'YC-05', priority: 75, scheduledAt: t(76), estimatedMinutes: 21, status: 'assigned' }, refs: box('FCIU-9920310', 'VOY-QF2') },
    { id: 'EVT-S-FC03', version: 1, type: 'gate.appointment-created', entityId: 'APT-9004', at: t(-22), actor: '集卡预约平台', source: 'gate-app', payload: { containerId: 'FCIU-9920310', truckNo: '沪A·7K229', driver: '陈海', type: 'pickup', windowStart: t(4), windowEnd: t(22), lane: 'south' }, refs: [{ entity: 'container', entityId: 'FCIU-9920310' }] },
    { id: 'EVT-S-FC04', version: 1, type: 'gate.appointment-updated', entityId: 'APT-9004', at: t(-12), actor: '闸口冲突检测', source: 'gate-app', payload: { fields: { exception: '同一车辆相邻窗口过短' } } },

    // ---- TEMU-1774029：冷藏箱抽检验温，海关挂起 ----
    { id: 'EVT-S-TE01', version: 1, type: 'container.created', entityId: 'TEMU-1774029', at: t(-135), actor: 'TOS 船图系统', source: 'tos', payload: { voyageId: 'VOY-AX7', size: '40', isoType: '45R1', direction: 'import', status: 'on-quay', weightT: 26.3, reefer: true, temperature: 4, customs: 'released', priority: 'reefer', yardSlot: 'B07 / MSC Aurora' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-TE02', version: 1, type: 'task.created', entityId: 'TASK-DCH-TEMU', at: t(-106), actor: 'TOS 卸船计划', source: 'tos', payload: { kind: 'discharge', containerId: 'TEMU-1774029', from: 'B07 / MSC Aurora', to: 'D05-R05-T1', equipmentId: 'QC-07', priority: 89, scheduledAt: t(-104), estimatedMinutes: 16, status: 'assigned' }, refs: box('TEMU-1774029', 'VOY-AX7') },
    { id: 'EVT-S-TE03', version: 1, type: 'container.slot-changed', entityId: 'TEMU-1774029', at: t(-90), actor: '场桥 YC-12', source: 'tos', payload: { from: 'B07 / MSC Aurora', to: 'D05-R05-T1', reason: '冷藏查验位预留落位' } },
    { id: 'EVT-S-TE04', version: 1, type: 'task.status-changed', entityId: 'TASK-DCH-TEMU', at: t(-88), actor: '岸桥 QC-07', source: 'telemetry', payload: { to: 'done', from: 'executing', containerId: 'TEMU-1774029' }, refs: box('TEMU-1774029', 'VOY-AX7') },
    { id: 'EVT-S-TE05', version: 1, type: 'container.status-changed', entityId: 'TEMU-1774029', at: t(-88), actor: 'TOS 卸船确认', source: 'tos', payload: { from: 'on-quay', to: 'in-yard' }, refs: [{ entity: 'voyage', entityId: 'VOY-AX7' }] },
    { id: 'EVT-S-TE06', version: 1, type: 'container.customs-changed', entityId: 'TEMU-1774029', at: t(-30), actor: '海关单一窗口', source: 'customs', payload: { from: 'released', to: 'inspection', reason: '抽检验温' } },
    { id: 'EVT-S-TE07', version: 1, type: 'container.status-changed', entityId: 'TEMU-1774029', at: t(-30), actor: '海关单一窗口', source: 'customs', payload: { from: 'in-yard', to: 'hold', reason: '待海关查验' } },

    // ---- 设备状态 ----
    { id: 'EVT-S-EQ01', version: 1, type: 'equipment.status-changed', entityId: 'QC-07', at: t(-118), actor: '设备遥测', source: 'telemetry', payload: { from: 'available', to: 'working', location: 'B07 / MSC Aurora' } },
    { id: 'EVT-S-EQ02', version: 1, type: 'equipment.status-changed', entityId: 'YC-12', at: t(-102), actor: '设备遥测', source: 'telemetry', payload: { from: 'available', to: 'working', location: 'B07-R03' } },
    { id: 'EVT-S-EQ03', version: 1, type: 'equipment.status-changed', entityId: 'TT-31', at: t(-50), actor: '设备遥测', source: 'telemetry', payload: { from: 'available', to: 'working', location: '南闸口' } },
    { id: 'EVT-S-EQ04', version: 1, type: 'equipment.status-changed', entityId: 'RS-02', at: t(-25), actor: '设备管理系统', source: 'eam', payload: { from: 'working', to: 'maintenance', location: 'D05', reason: '计划保养 2 小时，查验任务需等待' } },

    // ---- 航次进度 ----
    { id: 'EVT-S-VY01', version: 1, type: 'voyage.status-changed', entityId: 'VOY-RD8', at: t(-700), actor: '船期 AIS', source: 'ais', payload: { to: 'berthed', from: 'approaching' } },
    { id: 'EVT-S-VY02', version: 1, type: 'voyage.progress', entityId: 'VOY-RD8', at: t(-330), actor: 'TOS 船图系统', source: 'tos', payload: { movesDone: 520, from: 0, status: 'departed' } },
    { id: 'EVT-S-VY03', version: 1, type: 'voyage.status-changed', entityId: 'VOY-RD8', at: t(-330), actor: '船期 AIS', source: 'ais', payload: { to: 'departed', from: 'berthed' } },
    { id: 'EVT-S-VY04', version: 1, type: 'voyage.status-changed', entityId: 'VOY-QF2', at: t(-300), actor: '船期 AIS', source: 'ais', payload: { to: 'approaching', from: undefined } },
    { id: 'EVT-S-VY05', version: 1, type: 'voyage.status-changed', entityId: 'VOY-AX7', at: t(-120), actor: '船期 AIS', source: 'ais', payload: { to: 'berthed', from: 'approaching' } },
    { id: 'EVT-S-VY06', version: 1, type: 'voyage.progress', entityId: 'VOY-AX7', at: t(-90), actor: 'TOS 船图系统', source: 'tos', payload: { movesDone: 310, from: 0, status: 'berthed' } },
    { id: 'EVT-S-VY07', version: 1, type: 'voyage.progress', entityId: 'VOY-AX7', at: t(-60), actor: 'TOS 船图系统', source: 'tos', payload: { movesDone: 620, from: 310 } },
    { id: 'EVT-S-VY08', version: 1, type: 'voyage.progress', entityId: 'VOY-AX7', at: t(-20), actor: 'TOS 船图系统', source: 'tos', payload: { movesDone: 886, from: 620 } },
    { id: 'EVT-S-VY09', version: 1, type: 'voyage.eta-changed', entityId: 'VOY-QF2', at: t(-15), actor: '船期 AIS', source: 'ais', payload: { from: t(155), to: t(190), reason: '锚地等待引航窗口，ETA +35min' } },
  ]);
}
seedLedger();

function parseSlot(slot: string) { const match = slot.match(/^([A-Z]\d\d)-/); return match?.[1]; }

// ---------------------------------------------------------------------------
// 事件写入：所有领域操作统一构造事件 → 追加账本 → 投影到内存基线
// ---------------------------------------------------------------------------

export interface ActorContext {
  actor?: string;
  source?: string;
  idempotencyKey?: string;
  at?: string;
  allowOutOfOrder?: boolean;
}

function stamp(label: string) { return `${label} ${new Date().toLocaleString()}`; }

/** 把已入库事件投影到当前内存基线（种子数据本身已是投影结果，不经过此函数）。 */
function projectEvent(event: JobEvent): void {
  const p = event.payload;
  switch (event.type) {
    case 'container.created': {
      const item: Container = {
        id: event.entityId, voyageId: String(p.voyageId), size: p.size as Container['size'], isoType: String(p.isoType),
        direction: p.direction as Container['direction'], status: p.status as ContainerStatus, weightT: Number(p.weightT),
        reefer: Boolean(p.reefer), ...(p.temperature !== undefined ? { temperature: Number(p.temperature) } : {}),
        ...(p.hazmatClass ? { hazmatClass: String(p.hazmatClass) } : {}),
        customs: p.customs as Container['customs'], priority: p.priority as Container['priority'],
        yardSlot: String(p.yardSlot), lastEvent: stamp(EVENT_LABELS[event.type]),
      };
      containers.unshift(item);
      break;
    }
    case 'container.updated': {
      const item = mustFind(containers, event.entityId, '箱子');
      Object.assign(item, (p.fields ?? {}) as Partial<Container>);
      item.lastEvent = stamp(String(p.summary ?? '台账更新'));
      break;
    }
    case 'container.status-changed': {
      const item = mustFind(containers, event.entityId, '箱子');
      item.status = String(p.to) as ContainerStatus;
      item.lastEvent = stamp(`状态 → ${p.to}`);
      break;
    }
    case 'container.slot-changed': {
      const item = mustFind(containers, event.entityId, '箱子');
      item.yardSlot = String(p.to);
      item.lastEvent = stamp(`换堆位 → ${p.to}`);
      break;
    }
    case 'container.customs-changed': {
      const item = mustFind(containers, event.entityId, '箱子');
      item.customs = String(p.to) as Container['customs'];
      item.lastEvent = stamp(`海关状态 → ${p.to}`);
      break;
    }
    case 'container.deleted': {
      const index = containers.findIndex(c => c.id === event.entityId);
      if (index < 0) return;
      containers.splice(index, 1);
      const linkedAppointments = appointments.filter(a => a.containerId === event.entityId);
      const linkedTasks = tasks.filter(t => t.containerId === event.entityId);
      for (const a of linkedAppointments) {
        const child = ledger.append({ type: 'gate.appointment-deleted', entityId: a.id, at: event.at, actor: event.actor, source: event.source, payload: { cascade: true, containerId: event.entityId } });
        projectEvent(child.event);
      }
      for (const task of linkedTasks) {
        const child = ledger.append({ type: 'task.deleted', entityId: task.id, at: event.at, actor: event.actor, source: event.source, payload: { cascade: true, containerId: event.entityId } });
        projectEvent(child.event);
      }
      break;
    }
    case 'gate.appointment-created': {
      const item: GateAppointment = {
        id: event.entityId, containerId: String(p.containerId), truckNo: String(p.truckNo), driver: String(p.driver),
        type: p.type as GateAppointment['type'], windowStart: String(p.windowStart), windowEnd: String(p.windowEnd),
        lane: p.lane as GateAppointment['lane'], status: 'booked', sealVerified: false, weightVerified: false,
      };
      appointments.unshift(item);
      const box = containers.find(c => c.id === item.containerId);
      if (box) box.appointmentId = item.id;
      break;
    }
    case 'gate.appointment-updated': {
      const item = mustFind(appointments, event.entityId, '预约');
      Object.assign(item, (p.fields ?? {}) as Partial<GateAppointment>);
      break;
    }
    case 'gate.appointment-status-changed': {
      const item = mustFind(appointments, event.entityId, '预约');
      item.status = String(p.to) as AppointmentStatus;
      if (p.exception !== undefined) item.exception = p.exception === null ? undefined : String(p.exception);
      const box = containers.find(c => c.id === item.containerId);
      if (box) {
        if (item.status === 'checked-in') box.status = 'at-gate';
        if (item.status === 'completed') box.status = item.type === 'pickup' ? 'released' : 'in-yard';
        if (item.status === 'cancelled' && box.appointmentId === item.id) box.appointmentId = undefined;
      }
      break;
    }
    case 'gate.appointment-deleted': {
      const index = appointments.findIndex(a => a.id === event.entityId);
      if (index >= 0) {
        const [removed] = appointments.splice(index, 1);
        const box = containers.find(c => c.id === removed.containerId);
        if (box?.appointmentId === removed.id) box.appointmentId = undefined;
      }
      break;
    }
    case 'task.created': {
      const item: YardTask = {
        id: event.entityId, kind: p.kind as YardTask['kind'], containerId: String(p.containerId),
        from: String(p.from), to: String(p.to), ...(p.equipmentId ? { equipmentId: String(p.equipmentId) } : {}),
        priority: Number(p.priority ?? 50),
        status: (p.status ? String(p.status) : p.equipmentId ? 'assigned' : 'queued') as TaskStatus,
        scheduledAt: String(p.scheduledAt),
        blockingReasons: Array.isArray(p.blockingReasons) ? p.blockingReasons.map(String) : [],
        estimatedMinutes: Number(p.estimatedMinutes),
      };
      tasks.unshift(item);
      break;
    }
    case 'task.updated': {
      const item = mustFind(tasks, event.entityId, '任务');
      Object.assign(item, (p.fields ?? {}) as Partial<YardTask>);
      break;
    }
    case 'task.assigned': {
      const item = mustFind(tasks, event.entityId, '任务');
      item.equipmentId = String(p.equipmentId);
      const reasons = Array.isArray(p.reasons) ? p.reasons.map(String) : [];
      item.blockingReasons = Array.from(new Set([...item.blockingReasons.filter(r => !/当前不可用/.test(r)), ...reasons]));
      item.status = p.feasible === false ? 'blocked' : 'assigned';
      break;
    }
    case 'task.status-changed': {
      const item = mustFind(tasks, event.entityId, '任务');
      item.status = String(p.to) as TaskStatus;
      if (Array.isArray(p.reasons)) item.blockingReasons = p.reasons.map(String);
      break;
    }
    case 'task.replanned': {
      const item = mustFind(tasks, event.entityId, '任务');
      for (const key of ['from', 'to', 'scheduledAt', 'equipmentId'] as const) {
        if (p[key] !== undefined && p[key] !== null) (item as unknown as Record<string, unknown>)[key] = p[key];
      }
      if (p.priority !== undefined) item.priority = Number(p.priority);
      if (Array.isArray(p.reasons)) item.blockingReasons = p.reasons.map(String);
      break;
    }
    case 'task.deleted': {
      const index = tasks.findIndex(t => t.id === event.entityId);
      if (index >= 0) tasks.splice(index, 1);
      break;
    }
    case 'equipment.status-changed': {
      const item = mustFind(equipment, event.entityId, '设备');
      item.status = String(p.to) as Equipment['status'];
      if (typeof p.location === 'string') item.location = p.location;
      break;
    }
    case 'voyage.status-changed': {
      const item = mustFind(voyages, event.entityId, '航次');
      item.status = String(p.to) as Voyage['status'];
      break;
    }
    case 'voyage.progress': {
      const item = mustFind(voyages, event.entityId, '航次');
      item.movesDone = Number(p.movesDone);
      if (p.movesPlanned !== undefined) item.movesPlanned = Number(p.movesPlanned);
      if (typeof p.status === 'string') item.status = p.status as Voyage['status'];
      break;
    }
    case 'voyage.eta-changed': {
      mustFind(voyages, event.entityId, '航次').eta = String(p.to);
      break;
    }
    case 'voyage.etd-changed': {
      mustFind(voyages, event.entityId, '航次').etd = String(p.to);
      break;
    }
  }
}

function mustFind<T extends { id: string }>(rows: T[], id: string, label: string): T {
  const row = rows.find(item => item.id === id);
  if (!row) throw new LedgerError('REPLAY_FAILED', `${label} ${id} 在内存基线中不存在，事件无法投影`, { entityId: id });
  return row;
}

function record(input: EventInput, ctx: ActorContext = {}): AppendResult {
  const result = ledger.append(
    {
      ...input,
      ...(ctx.at ? { at: ctx.at } : {}),
      ...(ctx.actor ? { actor: ctx.actor } : {}),
      ...(ctx.source ? { source: ctx.source } : {}),
      ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
    },
    { defaultActor: '中控调度员', defaultSource: 'terminal-console', allowOutOfOrder: ctx.allowOutOfOrder },
  );
  if (!result.duplicate) {
    projectEvent(result.event);
    auditEvents.unshift({
      id: `AUD-${result.event.seq}`, actor: result.event.actor, action: result.event.type,
      entity: result.event.entity, entityId: result.event.entityId, at: result.event.at,
      details: `${EVENT_LABELS[result.event.type]} · ${JSON.stringify(result.event.payload).slice(0, 180)}`,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 通用事件提交（API /api/ledger/events）：先校验可投影性，再入帐
// ---------------------------------------------------------------------------

export interface SubmitEventInput {
  id?: string;
  version?: number;
  type: LedgerEventType;
  entityId: string;
  at?: string;
  actor?: string;
  source?: string;
  payload?: Record<string, unknown>;
  refs?: EventRef[];
  idempotencyKey?: string;
  allowOutOfOrder?: boolean;
}

const CONTAINER_STATUS_SET = new Set(['in-transit', 'at-gate', 'in-yard', 'on-quay', 'released', 'hold']);
const CUSTOMS_SET = new Set(['released', 'inspection', 'hold']);
const TASK_STATUS_SET = new Set(['queued', 'assigned', 'executing', 'blocked', 'done']);
const APPOINTMENT_STATUS_SET = new Set(['booked', 'checked-in', 'completed', 'cancelled', 'exception']);
const EQUIPMENT_STATUS_SET = new Set(['available', 'working', 'maintenance', 'offline']);

function preflightEvent(input: { type: LedgerEventType; entityId: string; payload?: Record<string, unknown> }): void {
  const p = input.payload ?? {};
  const requireFields = (keys: string[]) => {
    for (const key of keys) {
      if (p[key] === undefined || p[key] === null || p[key] === '') {
        throw new LedgerError('INVALID_EVENT', `事件 ${input.type} 缺少必填字段 payload.${key}`, { payload: p });
      }
    }
  };
  const enumValue = (key: string, allowed: Set<string>) => {
    if (p[key] !== undefined && !allowed.has(String(p[key]))) {
      throw new LedgerError('INVALID_EVENT', `事件 ${input.type} 的 payload.${key}=${String(p[key])} 不在允许取值内`, { allowed: [...allowed] });
    }
  };
  const findContainer = () => {
    const item = containers.find(c => c.id === input.entityId);
    if (!item) throw new LedgerError('ENTITY_NOT_FOUND', `箱子 ${input.entityId} 不存在，事件无法投影`);
    return item;
  };
  const findTask = () => {
    const item = tasks.find(t => t.id === input.entityId);
    if (!item) throw new LedgerError('ENTITY_NOT_FOUND', `任务 ${input.entityId} 不存在，事件无法投影`);
    return item;
  };
  const findAppointment = () => {
    const item = appointments.find(a => a.id === input.entityId);
    if (!item) throw new LedgerError('ENTITY_NOT_FOUND', `预约 ${input.entityId} 不存在，事件无法投影`);
    return item;
  };

  switch (input.type) {
    case 'container.created': {
      requireFields(['voyageId', 'size', 'isoType', 'direction', 'status', 'weightT', 'reefer', 'customs', 'priority', 'yardSlot']);
      enumValue('status', CONTAINER_STATUS_SET); enumValue('customs', CUSTOMS_SET);
      if (!voyages.some(v => v.id === p.voyageId)) throw new LedgerError('ENTITY_NOT_FOUND', `关联航次 ${String(p.voyageId)} 不存在`);
      if (containers.some(c => c.id === input.entityId)) throw new LedgerError('REPLAY_FAILED', `箱子 ${input.entityId} 已存在，container.created 不能重复应用`);
      validateYardSlot(String(p.yardSlot), p.hazmatClass ? String(p.hazmatClass) : undefined, Boolean(p.reefer));
      break;
    }
    case 'container.updated':
      if (!p.fields || typeof p.fields !== 'object') throw new LedgerError('INVALID_EVENT', 'container.updated 需要 payload.fields 对象');
      findContainer();
      break;
    case 'container.status-changed':
      requireFields(['to']); enumValue('to', CONTAINER_STATUS_SET); findContainer();
      break;
    case 'container.slot-changed': {
      requireFields(['to']);
      const item = findContainer();
      validateYardSlot(String(p.to), item.hazmatClass, item.reefer);
      break;
    }
    case 'container.customs-changed':
      requireFields(['to']); enumValue('to', CUSTOMS_SET); findContainer();
      break;
    case 'container.deleted':
      findContainer();
      break;
    case 'gate.appointment-created': {
      requireFields(['containerId', 'truckNo', 'driver', 'type', 'windowStart', 'windowEnd', 'lane']);
      if (!containers.some(c => c.id === p.containerId)) throw new LedgerError('ENTITY_NOT_FOUND', `关联箱号 ${String(p.containerId)} 不存在`);
      if (new Date(String(p.windowEnd)) <= new Date(String(p.windowStart))) throw new LedgerError('INVALID_EVENT', '预约结束时间必须晚于开始时间');
      if (appointments.some(a => a.id === input.entityId)) throw new LedgerError('REPLAY_FAILED', `预约 ${input.entityId} 已存在`);
      break;
    }
    case 'gate.appointment-updated':
      if (!p.fields || typeof p.fields !== 'object') throw new LedgerError('INVALID_EVENT', 'gate.appointment-updated 需要 payload.fields 对象');
      findAppointment();
      break;
    case 'gate.appointment-status-changed':
      requireFields(['to']); enumValue('to', APPOINTMENT_STATUS_SET); findAppointment();
      break;
    case 'gate.appointment-deleted':
      findAppointment();
      break;
    case 'task.created': {
      requireFields(['kind', 'containerId', 'from', 'to', 'scheduledAt', 'estimatedMinutes']);
      if (!containers.some(c => c.id === p.containerId)) throw new LedgerError('ENTITY_NOT_FOUND', `关联箱号 ${String(p.containerId)} 不存在`);
      if (tasks.some(t => t.id === input.entityId)) throw new LedgerError('REPLAY_FAILED', `任务 ${input.entityId} 已存在`);
      break;
    }
    case 'task.updated':
      if (!p.fields || typeof p.fields !== 'object') throw new LedgerError('INVALID_EVENT', 'task.updated 需要 payload.fields 对象');
      findTask();
      break;
    case 'task.assigned': {
      requireFields(['equipmentId']);
      findTask();
      if (!equipment.some(e => e.id === p.equipmentId)) throw new LedgerError('ENTITY_NOT_FOUND', `设备 ${String(p.equipmentId)} 不存在`);
      break;
    }
    case 'task.status-changed':
      requireFields(['to']); enumValue('to', TASK_STATUS_SET); findTask();
      break;
    case 'task.replanned':
      findTask();
      break;
    case 'task.deleted':
      findTask();
      break;
    case 'equipment.status-changed':
      requireFields(['to']); enumValue('to', EQUIPMENT_STATUS_SET);
      if (!equipment.some(e => e.id === input.entityId)) throw new LedgerError('ENTITY_NOT_FOUND', `设备 ${input.entityId} 不存在`);
      break;
    case 'voyage.status-changed':
      requireFields(['to']);
      if (!voyages.some(v => v.id === input.entityId)) throw new LedgerError('ENTITY_NOT_FOUND', `航次 ${input.entityId} 不存在`);
      break;
    case 'voyage.progress':
      requireFields(['movesDone']);
      if (!voyages.some(v => v.id === input.entityId)) throw new LedgerError('ENTITY_NOT_FOUND', `航次 ${input.entityId} 不存在`);
      break;
    case 'voyage.eta-changed':
    case 'voyage.etd-changed':
      requireFields(['to']);
      if (!voyages.some(v => v.id === input.entityId)) throw new LedgerError('ENTITY_NOT_FOUND', `航次 ${input.entityId} 不存在`);
      break;
  }
}

function validateYardSlot(yardSlot: string, hazmatClass: string | undefined, reefer: boolean) {
  const blockId = parseSlot(yardSlot);
  if (blockId && !blocks.some(block => block.id === blockId)) throw new LedgerError('REPLAY_FAILED', '堆位所属区块不存在', { yardSlot, blockId });
  if (hazmatClass && blockId && !blocks.find(block => block.id === blockId)?.hazmatAllowed) throw new LedgerError('REPLAY_FAILED', '危险品不能进入当前堆场区块', { yardSlot });
  if (reefer && blockId) {
    const block = blocks.find(item => item.id === blockId);
    if (block && block.reeferPlugs <= block.usedPlugs) throw new LedgerError('REPLAY_FAILED', '当前区块没有可用冷藏插座', { yardSlot });
  }
}

function inferRefs(type: LedgerEventType, p: Record<string, unknown>): EventRef[] {
  const refs: EventRef[] = [];
  if (typeof p.containerId === 'string') refs.push({ entity: 'container', entityId: p.containerId });
  if (typeof p.voyageId === 'string') refs.push({ entity: 'voyage', entityId: p.voyageId });
  if (typeof p.equipmentId === 'string' && type.startsWith('task.')) refs.push({ entity: 'equipment', entityId: p.equipmentId });
  return refs;
}

export function submitEvent(input: SubmitEventInput) {
  const payload = input.payload ?? {};
  preflightEvent({ type: input.type, entityId: input.entityId, payload });
  const refs = [...inferRefs(input.type, payload), ...(input.refs ?? [])];
  const result = record(
    { ...(input.id ? { id: input.id } : {}), ...(input.version !== undefined ? { version: input.version } : {}), type: input.type, entityId: input.entityId, payload, refs },
    {
      actor: input.actor, source: input.source, at: input.at, idempotencyKey: input.idempotencyKey,
      allowOutOfOrder: input.allowOutOfOrder,
    },
  );
  return { event: result.event, duplicate: result.duplicate, warnings: result.warnings };
}

// ---------------------------------------------------------------------------
// 事件查询与“事件重建当前视图”
// ---------------------------------------------------------------------------

export { EVENT_TYPES } from './ledger.js';
export { EVENT_LABELS, LedgerError };
export type { JobEvent, EventQuery, TimelineStep, LedgerEntity, ReplayedContainer, ReplayedTask, ReplayedAppointment, ReplayedVoyage };

export function queryEvents(filter: EventQuery) {
  return ledger.query(filter);
}

export interface ReplayView {
  entity: LedgerEntity;
  entityId: string;
  current: ReplayedContainer | ReplayedTask | ReplayedAppointment | ReplayedVoyage;
  eventCount: number;
  outOfOrderCount: number;
  appliedEventIds: string[];
  timeline: TimelineStep[];
  live: unknown;
  consistent: boolean;
  mismatches: string[];
  replayedAt: string;
}

export function replayEntity(entity: LedgerEntity, id: string): ReplayView {
  const result =
    entity === 'container' ? replayContainer(id) :
    entity === 'task' ? replayTask(id) :
    entity === 'appointment' ? replayAppointment(id) :
    replayVoyage(id);
  const mismatches = diffLive(entity, id, result.current as unknown as Record<string, unknown>);
  const live =
    entity === 'container' ? (containers.find(c => c.id === id) ?? null) :
    entity === 'task' ? (tasks.find(t => t.id === id) ?? null) :
    entity === 'appointment' ? (appointments.find(a => a.id === id) ?? null) :
    (voyages.find(v => v.id === id) ?? null);
  return { ...result, live, consistent: mismatches.length === 0, mismatches, replayedAt: new Date().toISOString() };
}

function diffLive(entity: LedgerEntity, id: string, currentRaw: object): string[] {
  const current = currentRaw as Record<string, unknown>;
  const mismatches: string[] = [];
  const liveRaw: { id: string } | undefined =
    entity === 'container' ? containers.find(c => c.id === id) :
    entity === 'task' ? tasks.find(t => t.id === id) :
    entity === 'appointment' ? appointments.find(a => a.id === id) :
    voyages.find(v => v.id === id);
  const live = liveRaw as unknown as Record<string, unknown> | undefined;
  const exists = Boolean(current.exists);
  if (!live && exists) mismatches.push('事件回放视图中实体存在，但内存基线查无此实体');
  if (live && !exists) mismatches.push('内存基线中实体存在，但事件回放视图已删除');
  if (!live || !exists) return mismatches;
  const keys =
    entity === 'container' ? ['status', 'customs', 'yardSlot', 'voyageId', 'size', 'weightT', 'priority', 'appointmentId'] :
    entity === 'task' ? ['status', 'equipmentId', 'from', 'to', 'priority', 'scheduledAt'] :
    entity === 'appointment' ? ['status', 'truckNo', 'lane', 'sealVerified', 'weightVerified', 'exception'] :
    ['status', 'movesDone'];
  for (const key of keys) {
    if (!Object.is(current[key], live[key])) {
      mismatches.push(`${key}: 回放=${debug(current[key])}，内存基线=${debug(live[key])}`);
    }
  }
  if (entity === 'task') {
    const replayReasons = JSON.stringify([...(current.blockingReasons as string[])].sort());
    const liveReasons = JSON.stringify([...((live.blockingReasons as string[]) ?? [])].sort());
    if (replayReasons !== liveReasons) mismatches.push(`blockingReasons: 回放=${replayReasons}，内存基线=${liveReasons}`);
  }
  return mismatches;
}

function debug(value: unknown) { return value === undefined ? '∅' : String(value); }

// ---------------------------------------------------------------------------
// 原有查询能力
// ---------------------------------------------------------------------------

export function dashboard() {
  const activeVoyages = voyages.filter(v => v.status !== 'departed');
  const yardCapacity = blocks.reduce((sum, block) => sum + block.capacity, 0); const yardOccupied = blocks.reduce((sum, block) => sum + block.occupied, 0);
  return { activeVoyages: activeVoyages.length, berthMoves: activeVoyages.reduce((sum, v) => sum + v.movesPlanned - v.movesDone, 0), yardUtilization: yardOccupied / yardCapacity, gateQueue: appointments.filter(a => a.status === 'checked-in').length + 7, pendingTasks: tasks.filter(t => t.status !== 'done').length, blockedTasks: tasks.filter(t => t.status === 'blocked').length, reeferAlerts: containers.filter(c => c.reefer && (c.customs === 'inspection' || (c.temperature ?? 0) > 5)).length, hazmatHolds: containers.filter(c => c.hazmatClass && c.customs !== 'released').length, lateVessels: activeVoyages.filter(v => v.lateRisk === 'high').length };
}
export function gateConflicts() {
  const result: { severity: 'critical' | 'warning'; appointmentId: string; reason: string }[] = [];
  appointments.forEach((a, index) => appointments.slice(index + 1).forEach(b => {
    const overlap = a.truckNo === b.truckNo && new Date(a.windowStart).getTime() < new Date(b.windowEnd).getTime() && new Date(b.windowStart).getTime() < new Date(a.windowEnd).getTime();
    if (overlap) result.push({ severity: 'critical', appointmentId: a.id, reason: `车辆 ${a.truckNo} 与 ${b.id} 时间窗口重叠，需重新分配闸口时隙` });
  }));
  appointments.filter(a => a.status === 'booked').forEach(a => { const container = containers.find(c => c.id === a.containerId); if (container?.customs !== 'released') result.push({ severity: 'warning', appointmentId: a.id, reason: `箱 ${a.containerId} 海关状态为 ${container?.customs}，无法无条件放行` }); });
  return result;
}
export function yardHeatmap() { return blocks.map(block => ({ ...block, utilization: block.occupied / block.capacity, freeSlots: block.capacity - block.occupied, pressure: block.heat > 85 ? 'critical' : block.heat > 65 ? 'warning' : 'normal' })); }
export function containerPlan(containerId: string) {
  const container = containers.find(c => c.id === containerId); if (!container) return undefined;
  const reasons: string[] = []; const candidates = blocks.filter(block => block.capacity > block.occupied && (!container.hazmatClass || block.hazmatAllowed) && (!container.reefer || block.reeferPlugs > block.usedPlugs));
  if (container.customs !== 'released' && container.status === 'in-yard') reasons.push('海关未放行，必须保持在查验/监管区');
  const ranked = candidates.map(block => ({ block, score: (block.capacity - block.occupied) * 2 - block.heat - (container.reefer && block.reeferPlugs - block.usedPlugs < 3 ? 18 : 0) - (container.hazmatClass && !block.hazmatAllowed ? 100 : 0) })).sort((a, b) => b.score - a.score);
  if (!ranked.length) reasons.push('没有同时满足危险品、冷藏电源与容量约束的区块');
  const selected = ranked[0]?.block; if (container.reefer && selected) reasons.push(`需要占用 ${selected.reeferPlugs - selected.usedPlugs} 个剩余冷插位中的 1 个`);
  if (container.hazmatClass) reasons.push(`危险品 ${container.hazmatClass} 级，只能进入有隔离资质的区块`);
  return { container, recommendedBlock: selected, alternatives: ranked.slice(1, 3).map(item => item.block), reasons };
}
export function prioritizeTasks() { return tasks.map(task => ({ ...task, score: task.priority + (task.blockingReasons.length ? -20 : 10) + (task.kind === 'inspect' ? 12 : 0) })).sort((a, b) => b.score - a.score); }

export function containerDetail(id: string) { const container = containers.find(item => item.id === id); if (!container) return undefined; return { container, voyage: voyages.find(v => v.id === container.voyageId), appointment: appointments.find(a => a.id === container.appointmentId), plan: containerPlan(id), tasks: tasks.filter(t => t.containerId === id), timeline: ledger.query({ entity: 'container', entityId: id }) }; }

// ---------------------------------------------------------------------------
// CRUD：箱务
// ---------------------------------------------------------------------------

export type ContainerInput = Omit<Container, 'lastEvent' | 'appointmentId'> & { appointmentId?: string };
export type AppointmentInput = Pick<GateAppointment, 'containerId' | 'truckNo' | 'driver' | 'type' | 'windowStart' | 'windowEnd' | 'lane'>;
export type TaskInput = Pick<YardTask, 'kind' | 'containerId' | 'from' | 'to' | 'priority' | 'scheduledAt' | 'estimatedMinutes'> & { equipmentId?: string };

export function createContainer(input: ContainerInput, ctx: ActorContext = {}) {
  const id = input.id.trim().toUpperCase();
  if (!id) throw new Error('箱号不能为空');
  if (containers.some(item => item.id === id)) throw new Error(`箱号 ${id} 已存在`);
  if (!voyages.some(item => item.id === input.voyageId)) throw new Error('关联航次不存在');
  const blockId = parseSlot(input.yardSlot);
  if (blockId && !blocks.some(block => block.id === blockId)) throw new Error('堆位所属区块不存在');
  if (input.hazmatClass && blockId && !blocks.find(block => block.id === blockId)?.hazmatAllowed) throw new Error('危险品不能进入当前堆场区块');
  if (input.reefer && blockId) {
    const block = blocks.find(item => item.id === blockId);
    if (block && block.reeferPlugs <= block.usedPlugs) throw new Error('当前区块没有可用冷藏插座');
  }
  const { id: _id, ...payload } = input;
  const result = record({
    type: 'container.created', entityId: id,
    payload: payload as unknown as Record<string, unknown>,
    refs: [{ entity: 'voyage', entityId: input.voyageId }],
  }, ctx);
  if (result.duplicate) return containers.find(item => item.id === id);
  return containers.find(item => item.id === id);
}

export function updateContainer(id: string, patch: Partial<Omit<Container, 'id' | 'lastEvent'>>, ctx: ActorContext = {}) {
  const item = containers.find(container => container.id === id);
  if (!item) return undefined;
  if (patch.voyageId && !voyages.some(voyage => voyage.id === patch.voyageId)) throw new Error('关联航次不存在');
  const next = { ...item, ...patch };
  const blockId = parseSlot(next.yardSlot);
  if (blockId && !blocks.some(block => block.id === blockId)) throw new Error('堆位所属区块不存在');
  if (next.hazmatClass && blockId && !blocks.find(block => block.id === blockId)?.hazmatAllowed) throw new Error('危险品不能进入当前堆场区块');
  const fromStatus = item.status;
  const fromSlot = item.yardSlot;
  const fromCustoms = item.customs;
  const first = record({ type: 'container.updated', entityId: id, payload: { fields: patch } }, ctx);
  if (first.duplicate) return item;
  if (patch.status && patch.status !== fromStatus) record({ type: 'container.status-changed', entityId: id, payload: { from: fromStatus, to: patch.status } }, ctx);
  if (patch.yardSlot && patch.yardSlot !== fromSlot) record({ type: 'container.slot-changed', entityId: id, payload: { from: fromSlot, to: patch.yardSlot } }, ctx);
  if (patch.customs && patch.customs !== fromCustoms) record({ type: 'container.customs-changed', entityId: id, payload: { from: fromCustoms, to: patch.customs } }, ctx);
  return containers.find(container => container.id === id);
}

export function deleteContainer(id: string, ctx: ActorContext = {}) {
  const item = containers.find(entry => entry.id === id);
  if (!item) return undefined;
  const linked = {
    appointments: appointments.filter(a => a.containerId === id).length,
    tasks: tasks.filter(t => t.containerId === id).length,
  };
  const result = record({
    type: 'container.deleted', entityId: id,
    payload: { reason: `删除箱务记录，并级联清理 ${linked.appointments} 条预约、${linked.tasks} 条未完成任务` },
  }, ctx);
  if (result.duplicate) return undefined;
  return item;
}

// ---------------------------------------------------------------------------
// CRUD：闸口预约
// ---------------------------------------------------------------------------

export function createGateAppointment(input: AppointmentInput, ctx: ActorContext = {}) {
  const container = containers.find(item => item.id === input.containerId);
  if (!container) throw new Error('箱号不存在');
  if (input.type === 'pickup' && container.customs !== 'released') throw new Error('海关未放行，不能预约提箱');
  if (new Date(input.windowEnd) <= new Date(input.windowStart)) throw new Error('预约结束时间必须晚于开始时间');
  const id = `APT-${Date.now()}`;
  const result = record({
    type: 'gate.appointment-created', entityId: id, payload: { ...input },
    refs: [{ entity: 'container', entityId: input.containerId }],
  }, ctx);
  if (result.duplicate) return appointments.find(item => item.id === id);
  return appointments.find(item => item.id === id);
}

export function editGateAppointment(id: string, patch: Partial<AppointmentInput & Pick<GateAppointment, 'status' | 'sealVerified' | 'weightVerified' | 'exception'>>, ctx: ActorContext = {}) {
  const item = appointments.find(appointment => appointment.id === id);
  if (!item) return undefined;
  if (patch.containerId && !containers.some(container => container.id === patch.containerId)) throw new Error('箱号不存在');
  if (patch.windowStart && patch.windowEnd && new Date(patch.windowEnd) <= new Date(patch.windowStart)) throw new Error('预约结束时间必须晚于开始时间');
  const previousStatus = item.status;
  const first = record({ type: 'gate.appointment-updated', entityId: id, payload: { fields: patch }, refs: [{ entity: 'container', entityId: item.containerId }] }, ctx);
  if (first.duplicate) return item;
  if (patch.status && patch.status !== previousStatus) {
    record({ type: 'gate.appointment-status-changed', entityId: id, payload: { from: previousStatus, to: patch.status, type: item.type, containerId: item.containerId, ...(patch.exception !== undefined ? { exception: patch.exception } : {}) }, refs: [{ entity: 'container', entityId: item.containerId }] }, ctx);
  }
  return appointments.find(appointment => appointment.id === id);
}

export function deleteGateAppointment(id: string, ctx: ActorContext = {}) {
  const item = appointments.find(entry => entry.id === id);
  if (!item) return undefined;
  const result = record({ type: 'gate.appointment-deleted', entityId: id, payload: { containerId: item.containerId } }, ctx);
  if (result.duplicate) return undefined;
  return item;
}

// 旧版兼容入口（早期控制器路由）
export function createAppointment(input: AppointmentInput) { return createGateAppointment(input, { actor: '闸口值班员', source: 'gate-ocr' }); }
export function updateAppointment(id: string, patch: Partial<Pick<GateAppointment, 'status' | 'sealVerified' | 'weightVerified' | 'exception'>>) {
  return editGateAppointment(id, patch, { actor: '闸口值班员', source: 'gate-ocr' });
}

// ---------------------------------------------------------------------------
// CRUD：场内任务 + 设备指派
// ---------------------------------------------------------------------------

export function createYardTask(input: TaskInput, ctx: ActorContext = {}) {
  if (!containers.some(container => container.id === input.containerId)) throw new Error('关联箱号不存在');
  if (input.priority < 1 || input.priority > 100) throw new Error('优先级范围为 1–100');
  if (input.estimatedMinutes <= 0) throw new Error('预计作业时长必须大于 0');
  const id = `TASK-${Date.now()}`;
  const result = record({
    type: 'task.created', entityId: id,
    payload: { ...input, status: input.equipmentId ? 'assigned' : 'queued' },
    refs: [{ entity: 'container', entityId: input.containerId }, ...(input.equipmentId ? [{ entity: 'equipment' as const, entityId: input.equipmentId }] : [])],
  }, ctx);
  if (result.duplicate) return tasks.find(item => item.id === id);
  return tasks.find(item => item.id === id);
}

export function updateYardTask(id: string, patch: Partial<TaskInput & Pick<YardTask, 'status' | 'blockingReasons'>>, ctx: ActorContext = {}) {
  const item = tasks.find(task => task.id === id);
  if (!item) return undefined;
  if (patch.containerId && !containers.some(container => container.id === patch.containerId)) throw new Error('关联箱号不存在');
  if (patch.priority !== undefined && (patch.priority < 1 || patch.priority > 100)) throw new Error('优先级范围为 1–100');
  const previousStatus = item.status;
  const taskRefs = [{ entity: 'container' as const, entityId: item.containerId }, ...(item.equipmentId ? [{ entity: 'equipment' as const, entityId: item.equipmentId }] : [])];
  const first = record({ type: 'task.updated', entityId: id, payload: { fields: patch }, refs: taskRefs }, ctx);
  if (first.duplicate) return item;
  if (patch.status && patch.status !== previousStatus) {
    record({
      type: 'task.status-changed', entityId: id,
      payload: { from: previousStatus, to: patch.status, containerId: item.containerId, ...(patch.blockingReasons ? { reasons: patch.blockingReasons } : {}) },
      refs: taskRefs,
    }, ctx);
  }
  return tasks.find(task => task.id === id);
}

export function deleteYardTask(id: string, ctx: ActorContext = {}) {
  const item = tasks.find(entry => entry.id === id);
  if (!item) return undefined;
  const result = record({ type: 'task.deleted', entityId: id, payload: { containerId: item.containerId } }, ctx);
  if (result.duplicate) return undefined;
  return item;
}

export function assignTask(id: string, equipmentId: string, ctx: ActorContext = {}) {
  const task = tasks.find(item => item.id === id);
  const machine = equipment.find(item => item.id === equipmentId);
  if (!task || !machine) return undefined;
  const reasons: string[] = [];
  if (machine.status === 'maintenance' || machine.status === 'offline') reasons.push(`${machine.name} 当前不可用`);
  if (task.kind === 'inspect' && machine.kind !== 'reach-stacker') reasons.push('查验作业需要正面吊或专用设备');
  const result = record({
    type: 'task.assigned', entityId: id,
    payload: { equipmentId, equipmentName: machine.name, containerId: task.containerId, feasible: reasons.length === 0, reasons },
    refs: [{ entity: 'container', entityId: task.containerId }, { entity: 'equipment', entityId: equipmentId }],
  }, ctx);
  if (result.duplicate) return tasks.find(item => item.id === id);
  return tasks.find(item => item.id === id);
}
