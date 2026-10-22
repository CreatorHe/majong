# 自由出牌 v2 玩法埋点接入任务

状态：下文保留v2初始接入任务记录。当前接入v6起手构筑、共享一次改牌与四核心计分，以[当前字段契约](FREE_PLAY_ANALYTICS_CONTRACT.md)和[接入说明](FREE_PLAY_ANALYTICS_INTEGRATION.md)为准；旧版成型替换、商店、版本2等约定不作为v6实现依据。由用户指定会话 `01a15d2c-14e7-7071-855d-7f04072d8ef2` 执行；主玩法会话负责引擎、界面与最终统一发布。

规则依据：[自由出牌与结算计划](FREE_PLAY_AND_SETTLEMENT_PLAN.md)。复用已上线 SDK、Worker、D1、同意开关及正式／测试隔离，不另建采集系统。

## 关键事实

- 实体牌有稳定 ID，支持任意批次入区、成型区替换、声明杠、改点数／花色／万能。
- 14 指结构张数；有 k 杠则终局实际 14+k 张。每关一次终局，普通／七对由系统择优。
- 分数跨关累计，过关不扣门槛。过程分实时入账，终局仅追加和牌分或扣罚分。
- 牌型是否合法与是否累计达标独立；诈胡扣分后累计仍 >= 门槛也过关。不能把诈胡记成功和牌，不能把诈胡固定算失败。
- 提醒、选牌预览、渲染不产生计分／奇物已触发事件。成长、扣分、过关奖励和数据发送都需按真实结果去重。

## 实现归属与适配接口

埋点会话负责 `dist/analytics/` 下新增 `game-adapter.js`、SDK、服务端 schema／目录／统计、必要 DB 迁移、analytics 测试与接入文档。不要编辑 `dist/app.js`、`dist/engine.js`、`dist/tiles.js`、玩法 CSS、结算素材，不单独发布或提交混合工作区；由主会话统一构建发布。

请提供稳定、容错的浏览器接口：

```js
import { captureGameState, trackGameAction } from './analytics/game-adapter.js';
const before = captureGameState(game);
const result = performAction();
trackGameAction(action, before, game, result, context);
```

适配器负责从提供的状态抽取白名单证据，复用 `boot.js` 的 SDK 实例，不能每次操作另建客户端。接口即使采集关闭、存储失败、网络异常也不能向游戏抛错。`captureGameState(null)` 支持新开局前快照；若接口有更合理的调整，请写入文档供主会话接入。当前正式游戏无已存偏好时默认开启，既有关闭保留；sandbox 主动启用，详见 [SDK 开关规则](ANALYTICS_CLIENT.md)。

主会话会在用户动作入口调用，不在 render、预览和提示计算中调用。动作名：`start / starter / select / commit / kong / exchange / replace / transform / settle / settlement_skip / settlement_complete / reward / buy / sell / refresh_shop / next_round / retire / resume`。context 可含选中实体 ID、改牌类型/目标、奇物 ID、来源区域、操作拒绝原因；实现时固定有界白名单，不直接上传整个游戏对象。

## 引擎契约

引擎版本 2，`game.runId / roundId / settlementId` 持久稳定。牌实体：`{id,original,face,wild,entered}`；区域 `hand / formed / deck / discard`；声明杠 `kongs:[{id,tileIds,face}]`。

状态分数：`totalScore` 当前累计，`score` 本关净分，`processScore` 本关过程分，`roundStartScore` 进关累计，`roundTarget` 本关冻结门槛。

终局 `game.last` 或 `settle()` 返回：`{valid,legal,resultType:'win'|'false_win',base,fans,patterns,gains,mult,total,penalty,delta,cumulativeBefore,cumulativeAfter,target,passed,decomposition,tiers,...}`。`total` 是和牌分，`resultType='win'` 只表示合法和牌，不能代替 `passed`。新玩法与计分版本使用明确新字符串，不能沿用 split_legacy_v1。

## 必须覆盖的事件与统计

| 事实 | 关键字段／约束 |
| --- | --- |
| 开局、续玩、进关、主动结束 | run/round ID、模式、版本、终止原因；刷新不重复新建关卡 |
| 单／多张入区 | 批次实体数量、牌面、过程收益、结构数前后、资源前后、被拒绝原因 |
| 换牌、成型替换、杠、三种改牌 | 操作类型、实例身份、前后牌面、杠数、真实资源花费；只成功操作记收益 |
| 奇物选择、买卖、刷新 | 奇物 ID、来源、真实铜钱变化；试算不算触发 |
| 合法和牌 | 只 `legal=true` 产生 hand_completed，包含合法未达标；实际最终拆解、计分番型、万能定色 |
| 每关终局 | 独立的牌型结果与 passed；过程分、和牌分、罚分、本关净分、进关/终局累计、门槛、稳定结算 ID |
| 播放完成／跳过 | 只作为展示行为，不二次增加和牌数、分数、罚分或奖励 |

最高和牌分、本关净分、累计分必须分开。新版本番型分母为对应可判定的合法完整和牌，不包括诈胡；诈胡过关计入关卡过关率。去除“玩家预选路线”的语义，普通／七对只表示最终拆解。新版本目标比较使用累计分，而不是 round_score >= target_score。负净分／负累计分允许，其他数量、费用仍按各自范围校验。

## 验收

复用既有测试与测试样本通道验证：正常和牌过关、合法未达标、诈胡过关、诈胡失败、扣后恰好等于门槛、单张阶段分不重复、杠15/18实牌、万能定色、刷新/重播/重试去重、中途开启时观测质量不伪造、数据关闭不阻断游戏。现实实战对照及自动解题统计不在本次范围。

请完成源文件和测试后在本会话报告适配器最终接口、关键文件、测试结果及待主会话接入的位置。不要把测试记录投到 production；统一发布由主会话完成。
