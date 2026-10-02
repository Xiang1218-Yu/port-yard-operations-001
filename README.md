# HarborGrid · 港口集装箱堆场作业协同与闸口调度系统

React + Vite + TypeScript 前端，Node.js + Express + TypeScript 服务端。面向中型集装箱码头，把船期、箱务、堆场区块、闸口预约、设备作业和异常闭环放在同一套作业控制台中。

## 启动

```bash
npm install
npm run dev
```

前端默认 Vite 端口 5178，API 默认 `http://localhost:4107`。

## 业务能力

- 船舶航次、泊位窗口、计划/已完成翻箱和延误风险
- 箱号、尺寸、冷藏温度、危险品级别、海关状态、进出口/中转流向
- 堆场区块容量、堆存热度、冷藏插座、危险品隔离和设备可达性
- 闸口预约时隙、车道、OCR/称重/封志校验状态与同车冲突检测
- 岸桥、场桥、集卡、正面吊设备池和约束感知任务队列
- 自动堆位推荐、冷藏/危险品约束、海关查验阻塞、任务指派审计
- React 控制台支持船期驾驶舱、闸口操作、堆场热区与设备任务操作
- **不可变作业事件账本**：箱务、闸口预约、场内任务、设备指派、航次进度的关键状态变化全部以「只追加」事件记录（时间、操作者、来源、关联实体），支持按实体/时间范围/事件类型回溯、从事件重建当前视图，重复提交（事件 id 或幂等键）不产生第二次状态变化；事件乱序、未知事件版本、重放失败均返回带错误码的可见错误

当前使用内存种子数据，领域服务通过 REST API 暴露，后续可接入 TOS、OCR、称重、RTG 遥测、预约配额和优化求解器。

## 作业事件账本 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ledger/event-types` | 账本支持的全部事件类型 |
| GET | `/api/ledger/events` | 按 `entity`、`entityId`、`types`（逗号分隔）、`from`、`to`、`source`、`actor`、`order`、`limit` 过滤操作流；`related=false` 只返回主实体事件 |
| POST | `/api/ledger/events` | 追加事件（`type/entityId/payload/actor/source/at/refs/idempotencyKey/version/allowOutOfOrder`）。成功 201；重复事件返回 200 且 `duplicate=true` 并不再投影 |
| GET | `/api/ledger/replay/:entity/:id` | 从事件流重建实体当前视图、操作时间线，并与内存基线字段级对比（`consistent` / `mismatches`） |

事件字段：`id`、`version`（当前 v1）、`type`、`entity`、`entityId`、`at`（业务时间）、`recordedAt`（写入时间）、`actor`、`source`、`payload`、`refs`、`seq`、`warnings`。

错误码：`DUPLICATE_EVENT`、`UNKNOWN_EVENT_VERSION`(422)、`UNKNOWN_EVENT_TYPE`(422)、`INVALID_EVENT`(422)、`OUT_OF_ORDER`(409，可用 `allowOutOfOrder:true` 补录，事件会带 `out-of-order` 警告)、`ENTITY_NOT_FOUND`、`REPLAY_FAILED`。

外部系统写事件可通过请求头传操作者与幂等键：`X-Actor`、`X-Source`、`Idempotency-Key`、`X-Allow-Out-Of-Order: true`。
