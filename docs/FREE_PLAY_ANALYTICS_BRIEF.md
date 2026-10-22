# 九张整批 v9 玩法埋点接入任务

状态：本页已由 v2 初始任务更新为用户最新 V9 修正，优先于 `V9_PLAN` 旧稿。当前 pair 为 `nine_batch_v9/fan_score_v9`；详细字段以 [采集契约](FREE_PLAY_ANALYTICS_CONTRACT.md) 和 [接入说明](FREE_PLAY_ANALYTICS_INTEGRATION.md) 为准。由用户指定会话 `01a15d2c-14e7-7071-855d-7f04072d8ef2` 适配，主玩法会话负责引擎、UI、结算、浏览器验收与统一发布。

复用已上线 SDK、Worker、D1、偏好开关及 production/sandbox 隔离，不另建系统。终局沿用原字段和表，无新迁移；V2～V8 与 legacy 目录、旧队列、原信封和历史指标保持版本隔离。V9 统计代码与文档已冻结，98 项统计回归及同一工作区全项目测试通过，实际结果见 [实现说明](ANALYTICS_IMPLEMENTATION.md)。

## 玩法事实

- 所有玩家用固定基数 1000×highFanMultiplier(mode,fans) 的番型计分；无核心、计分类奇物、过程分或发币。采集直接读取冻结终局，不重算公式。
- newRun 直接创建第一关 prepare 和 9 张候选，不再选核心。commit 入选中牌、未选候选全部弃掉，再刷新最多 9 张；kong 使用候选则刷新，纯成型区 kong 不刷新。
- 普通换牌 prepare/play 共 5 次、每次 1～5 张，beginPlay 保留剩余次数，满 14 后禁止。prepare 改牌共一次 2 墨。
- 仅 rank_brush/suit_ribbon/wild_jade/high_rescue 四件工具；补缺无需核心。补缺每关一次，prepare 改点/换色共用墨，play 未满 14 可额外换≤3 张。整趟一次 1～2 张非杠成型弃除保留。
- 14 指结构数；有 k 杠则完整终局为 14+k 实体。牌型、结果类型与累计达标独立，过关不扣门槛。
- 预览、提示、render 和计分演出不生成计分事实。重试、重播、跳过和刷新不能重复终局或罚分。

## 归属与接口

埋点范围为 dist/analytics、服务端校验/目录/统计、现有 analytics 测试与分析文档。不要编辑 dist/app.js、dist/engine.js、玩法/结算素材、build/package，不单独发布或提交混合工作区。

```js
import { captureGameState, trackGameAction } from './analytics/game-adapter.js';
const before = captureGameState(game);
const result = performAction();
void trackGameAction(action, before, game, result, context);
```

在真实动作前 capture，动作后、任何 await 或动画前 track。适配器同步抽取不可变白名单，复用 runtime/boot 的同一 SDK；关闭、存储或网络失败不能向游戏抛错。context 保留选中实体、操作参数、工具来源和稳定拒绝码，不传全量对象。正式游戏无已存偏好默认匿名开启，既有关闭保持；sandbox 主动启用，详见 [SDK 开关规则](ANALYTICS_CLIENT.md)。

## 必须覆盖的事实

| 事实 | V9 约束 |
| --- | --- |
| start / round_started | newRun 已真实进入首关 prepare，一次 start 建立 run 与 round 完整观测；不造 starter |
| begin_play / next_round / resume | begin_play 不重置观测；下一关从 prepare 起算；恢复只记录已知状态，不补历史 |
| commit / kong | 保留选中入区、未选弃牌和新批实体；有候选参与 kong 才刷新，不上传虚构过程分 |
| exchange / transform / high_rescue | 真实前后资源、来源区域、实体变化和拒绝结果；V9 wild 归 wild_jade，补缺无核心要求 |
| formed_discard | 整趟一次记录跨关保留，0 基关号+1；只计成功动作，不累加后续快照 |
| reward / skip_reward | 只有实际四件工具变化，无铜钱或计分加赏；字段别名与历史兼容保留 |
| round_settled | 四类结果、独立 passed、真实拆解/定色、分数与稳定结算 ID |
| hand_completed | 仅 V9 win；和同结算 round_settled 合并为一条事实 |
| 播放完成 / 跳过 / 继续 | 展示行为与阶段迁移分开，不二次记终局 |
| run_ended | 无役/未成型未过关分别使用 no_yaku_below_target/incomplete_below_target，不混成诈胡 |

## 四类终局口径

- win：analytics legal=true，完整拆解和基础番型，实际正和牌收益、0 罚分，完整观测进入番型分母。
- no_yaku：仅日麻；引擎 legal=true 只代表结构成立，适配器必须规范化 analytics legal=false。保留真实完整拆解与万能定色，空番型、0 收益、0 罚分，不发 hand_completed。
- false_win：满 14 但没有有效结构，shape/decomposition=null、空番型、0 收益，扣 ceil(target×10%)。
- incomplete：牌山和候选都空、结构不足 14，保留 0～13+k 实体与已声明杠；无拆解、空番型、0 收益，扣同样罚分。适配器核对真实耗尽状态，终局不新增状态字段。

所有类型按 cumulative_after>=target_score 判断 passed，无役、未成型或诈胡也可能过关。过程分恒 0，净分与累计可负。服务端分开聚合四类及其 passed，不能用 1-legal 统计诈胡。番型分母仅同模式/完整版本 pair 下 complete 的唯一 win；三项最高分分别取和牌分、本关净分、累计分，不合并或重算。

## 验收范围

仅补现有 P0 核心回归：直接首关完整观测、九张整批刷新及两种 kong、普通换牌共用次数与满 14 拒绝、编辑/补缺资源、wild 来源、无役有效拆解、空手/带杠 incomplete、四类过关边界、刷新/重试/回放去重、中途开启 partial、偏好和存储故障不阻断游戏、旧 V2～V8 原队列/字典及完整版本隔离。真实链路需验证引擎→SDK→API→SQLite，测试只写 sandbox。

V9 统计回归 98/98 通过；在既有适配器测试文件新增两项终局核心用例，无新脚本。未进行 V9 浏览器验收、构建、提交或部署；浏览器试玩、音画及统一发布由主会话完成。现实胡率基线、自动解题和新的资源图表不在本轮范围。
