# 九张整批 v9：主玩法接入说明

本轮按用户最新 V9 修正适配，优先于 `V9_PLAN` 旧稿：所有玩家固定基数 1000 乘番型倍率，无核心、计分类奇物、过程分或发币。版本为 `nine_batch_v9/fan_score_v9`。保留 V2～V8 与 legacy 的原事件、原待发信封及目录，分别统计；终局沿用现有字段与数据库表，无新迁移。字段白名单见 [采集契约](FREE_PLAY_ANALYTICS_CONTRACT.md)。主会话负责引擎、UI、结算演出、构建、浏览器验收和统一发布；埋点适配不修改这些模块。

V9 新旅程直接 prepare，候选最多 9 张。commit 入选中牌、弃全部未选候选、再刷新至最多 9 张；kong 使用候选也刷新，纯 formed kong 不刷新。普通 exchange 在 prepare/play 共用 5 次、每次 1～5 张，满 14 后禁止。prepare 改牌共一次 2 墨；仅四件工具 rank_brush/suit_ribbon/wild_jade/high_rescue，无需计分核心。成型弃除整趟一次沿用。构筑建议、预览和演出不能产生额外得分事件。

## 动作入口

```js
import { captureGameState, trackGameAction } from './analytics/game-adapter.js';

const before = captureGameState(game);
const selectedIds = [...selected]; // 以页面实际选中列表为准，在引擎清除前复制
const result = engine.commit(game, selectedIds);
void trackGameAction('commit', before, game, result, {
  selected_tile_ids: selectedIds, input_method: 'pointer', source_zone: 'hand',
});
```

`captureGameState(null)` 返回 null，其余快照为不可变副本；不保存或改写游戏对象。`trackGameAction()` 返回 Promise，异常降级为 `{queued:false,reason}`，不向玩法抛错。调用不必 await；queued 表示进入本地队列，不是服务端 ACK。调试可看 events/invalid，不把这些开发字段显示给玩家。

快照、真实动作和 track 必须同步相邻，**在 await、动画或下一次游戏修改之前调用**。适配器同步抽取全部白名单事实，异步仅负责入队。禁止在 render、inspect、预览或逐条计分演出回调里生成终局事实。

| 动作 | V9 接入点与 context |
| --- | --- |
| start | newRun 后；before 捕捉原 game，没有则 null。V9 已建立 runId/roundId 并处于 prepare，一次动作产生 run_started 与首关 round_started；不调用或伪造 starter |
| starter | 仅历史选核心路径兼容；V9 正常流程不发送 |
| begin_play | beginPlay 后；prepare→play，保留 swaps，不补墨、不重发 round_started |
| select | 真实选牌／取消选择后；selected_tile_ids 是实际选中实体，source_zone 为 hand/formed；取消或 Escape 传空列表 |
| commit | 真实引擎调用后；复制 selected_tile_ids。证据包括选中 hand→formed、未选 hand→discard、新批 deck→hand；不发过程分 |
| kong | 真实引擎调用后，传操作前选中 ID；含候选牌时整批刷新，纯 formed kong 不刷新，不另造抽牌事件 |
| exchange | 真实普通换牌后；prepare/play 共用 5 次，每次 1～5 张；结构满 14 时拒绝，不能沿用 V8 的满 14 留牌刷新规则 |
| transform | prepare 内 rank/suit/wild；传 selected_tile_ids、source_zone、transform_kind 和 transform_value（-1/1、0/1/2、null）。V9 wild 来源归一为 wild_jade，需实际持有；不再写 core_high |
| high_rescue | highRescue 后，rescue_kind=exchange/rank/suit 归一为 rescue_type。prepare 仅 rank/suit 且共用 2 墨；play 仅 exchange≤3、结构<14，不耗普通换牌次数或墨；两阶段共享一次 rescue_used，无需核心 |
| formed_discard | discardFormed 后，保存 selected_tile_ids 与 source_zone:formed。整趟一次 1～2 张非杠牌，无立即补摸；张数取实际成功记录，不取 UI count |
| settle | 仅在真实 settle 后调用；适配器读取冻结 game.last，四种结果均发 round_settled，仅规范化 win 发 hand_completed |
| settlement_skip / settlement_complete | 播放器实际跳过／自然完成；只记展示行为，不重复终局 |
| settlement_continue | 点击继续并调用 finishSettlement 后；记录阶段迁移，必要时按结果类型发 run_ended，与播放 complete 分开 |
| reward / skip_reward | 实际选择工具／跳过后；reward 给 relic_id，若有实际替换给 replaced_relic_id→replace_relic_id；不合成发币或计分加赏 |
| next_round | nextRound 后；实际进入下一关 prepare 才发 round_started |
| retire | 真实主动结束；不造和牌或其他终局 |
| resume | 对应版本存档成功恢复后；before=null、result=true、source:save，不追补历史终局或开局 |
| replace / buy / sell / refresh_shop | 保留旧版兼容；V9 无成型替换和商店，不合成成功事件；真实被拒绝的调用可记录 |

input_method 支持 pointer/keyboard/programmatic，默认 programmatic。reason_code 必须稳定 ASCII；已知拒绝文案映射固定码，未知记 engine_rejected，不上传原始 toast、堆栈或任意文本。未列 context 字段丢弃。选择 ID 最多 18 个、变化最多 36 项；超长动作证据截断并标记，终局事实不能截断后冒充完整。V9 越阶段、满 14 普通换牌、工具缺失等失败尝试仍按真实结果上报，不能因成功条件校验而丢掉 rejected。

## 采集偏好与完整观测

boot 与适配器从 runtime.js 的 getGameAnalytics() 取得同一 SDK，不另建实例。导入不自动采集，普通 SSR 不建客户端。浏览器首次取得正式实例时 runtime 使用 defaultEnabled:true：无已存选择才默认开启，既有 denied 保持关闭。通用 SDK 默认 false，sandbox 首次主动启用；偏好不可读时不开启，不把读取失败当成未关闭。页面或面板卸载不随意 dispose 共用客户端。

数据设置显示“匿名统计：开/关”。关闭立即停止新增上传、清空未发送记录并保存 denied；已接收数据不自动删除。只有显式开启/关闭才写偏好，不在 start/resume/render 强行 setConsent(true)。撤回后旧采集代次的异步事实不得重新注入，存储失败按 SDK 实际错误处理。

V9 首次 start 前采集已可用，且同步观察了 newRun→prepare，可建立首关 complete；没有 before 游戏对象不影响这一真实开局。next_round 同样在实际 prepare 建立观测。begin_play 不重置质量。准备中途开启、撤回后重开、刷新续玩为 partial；无队列丢失且持续同一采集代次的整关才 complete，下一关重新完整开始可恢复。默认启用不追补缺失历史，resume 不伪造 run_started 或 round_started。

重复传同一 before 的同一动作在页内去重；run/round/settlement ID 由引擎持久化，SDK 重试复用原事件和版本。终局业务 ID 在服务端合并，重播、跳过、刷新不重新记分或扣罚。跨版本 start 的新 game_action.before=null；旧挑战若结束，其 run_ended 仍用旧版本快照。

## 四类终局与冻结计分

V9 引擎标识 `nine-batch-v9 / fan-score-v9` 规范化为 `nine_batch_v9 / fan_score_v9`。其他版本仍独立绑定原 pair，不将旧待发事件重标 V9。队列兼容不代表自动升级旧游戏存档；存档仍由对应引擎验证。

| 引擎 resultType | analytics 处理 |
| --- | --- |
| win | legal=true，读取真实完整拆解、有效定色和基础番型，发 round_settled+hand_completed |
| no_yaku | 仅日麻。引擎 legal=true 表示结构成立，适配器转换 legal=false；保留完整拆解与有效定色，空番型、0 和牌分、0 罚分，只发 round_settled |
| false_win | 满 14 但无结构，legal=false、shape/decomposition=null、空番型、0 和牌分、ceil(target×10%) 罚分 |
| incomplete | 牌山与候选都空且结构不足 14，保留实际 0～13+k 实体及已声明杠；无拆解、空番型、0 和牌分、同样扣目标 10% 向上取整 |

适配器必须先核对 incomplete 的真实耗尽条件，不凭结果标签虚构。所有类型 passed 都只取累计是否达标；无役/未成型/诈胡可能过关，不能按 legal 强制失败。未过关的终止原因分别为 completed_below_target、no_yaku_below_target、false_win_below_target、incomplete_below_target。其余历史版本继续只接受 win/false_win。

实际拆解读取 last.decomposition.groups/groupTileIds/pair/pairTileIds/tiles；万能有效花色取 decomposition.tiles，保留实体 original/face、杠和工具证据。win 与 no_yaku 都需要真实拆解。支持普通、七对、orphans、knitted、unconnected 对应模式；不由 UI 或计分模式猜拆解。false_win/incomplete 保留已声明杠的有效定色，未知未定色万能可为 null。

V9 只有基础番型，unlock_pattern_ids 为空，不能从历史 gains.kind=unlock 合成加赏；未知实际番型仍拒绝事实，须补显式映射。V3～V8 的秘卷、国标 bonus ID、V2 冻结父番型映射仍保留。unavailable 不进入支持目录，V9 四件工具也不生成独立计分番型。

V9 分数固定来自最后冻结结算 `game.last`：1000×highFanMultiplier(mode,fans) 是引擎公式，适配器不再计算。processScore/coins/singleCount 为 0，无单张收益、留牌核心、成长或发币。净分/累计可负；V3～V9 限 Number.MAX_SAFE_INTEGER，V2 保持 10^12。服务端精确校验等式，不上传 steps，不把预览或重触发当新终局。

## 资源与历史边界

State 已有 deck_count/swaps/relic_ids，无需新增批次、已用墨或 openingSwapsUsed 字段。只有实际进关后可用 `136-deck_count` 表示已摸实体数，V9 含初始 9 张；同关前后差为动作补牌量。commit/kong 整批弃置必须按真实实体变化记录，普通 exchange 只替换选择的候选。末批不足 9 时按实际数量，不补假牌；牌山与候选耗尽不足 14 才可 incomplete。

V9 `5-swaps` 为本关普通换牌已用次数，prepare/play 共用，beginPlay 不清零；满 14 禁换。普通编辑只 prepare，共享一次 2 墨；补缺编辑同耗额度，补缺弃换只 play 未满 14、最多 3 张且独立于普通次数。wild 来源是 wild_jade，high_rescue 无需 core_high。V9 工具目录只有四件，不能上传旧核心或加分奇物。

历史边界必须保留：V8 候选 12 张、出几张补几张且余牌保留，满 14 可普通换候选并影响最终留牌收益；V7/V8 wild 归 core_high、禁装备 wild_jade；V6/V7 允许 play 两区编辑及满 14 修复；V5～V7 普通换牌仅 prepare 且 beginPlay 清零；V5 编辑墨成本与 V4 资源也保持原解释。旧队列不是 V9 当前规则的违规数据。

V7～V9 formedDiscard={round,tileIds} 映射 State.formed_discard={round_no:round+1,tile_ids}，未用为 null，跨关保留。只计 applied formed_discard 并按 run_id 去重，张数取实际 tile_ids，不累计每次后续快照；恢复不补报动作。可关联后续四类终局，但仅凭后续结果不能声称动作导致修复成功。

## 报告与验收边界

默认报告为 V9；只传 fan_score_v9 选 V9，four_core_v6 仍选历史 V8，exponential_v3 选 V4。完整 rules/score pair、mode、scope 隔离，V6/V7/V8 同模型也不合并。三项最高分分别是和牌分、本关净分、累计分，各取最大值，不是同一手或番型独立贡献。V9 番型分母只包含 complete 的唯一 win；合法未达标仍计入，无役、未成型、诈胡均不计入。四类完整终局总数与 passed 独立聚合，false_win 按精确类型计数，禁止 1-legal 代替。

本轮 V9 统计回归 98/98 通过（adapter 26、server 29、client/runtime/report 43），同一工作区全项目 `npm test` 通过。覆盖真实引擎→适配器→SDK→API→SQLite、首关完整观测、整批刷新、无役真实拆解、耗尽未成型（含 0 张及带杠）、四类结果过关/未过关、满 14 换牌拒绝、wild 工具来源、辅助奖励、旧版队列/目录、去重和偏好；两种 kong 刷新边界同时由现有引擎回归验证。仅在既有适配器测试文件新增两项终局核心用例，无新脚本。完整结果及冻结文件见 [实现说明](ANALYTICS_IMPLEMENTATION.md)。

浏览器试玩、音画和最终 UI 接线由主会话验收，自动化不能替代试玩。本轮未进行 V9 浏览器验收、构建、提交或部署；不向 production 投测试手。此前打开的本地统计页仍为 V8 构建，V9 需主会话统一构建后验证。
