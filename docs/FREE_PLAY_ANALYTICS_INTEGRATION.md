# 起手构筑 v7：主玩法接入说明

本轮只修改 analytics、现有 analytics 测试与分析文档，不修改主玩法或服务端代码，不新增数据库迁移。主会话统一构建、浏览器验证与发布。原始字段完整白名单见 [采集契约](FREE_PLAY_ANALYTICS_CONTRACT.md)。

本轮接入v7整趟一次成型弃除、天机算筹自带花色万能；2墨共享一次改牌与V6计分公式保持不变。版本为opening_build_v7/four_core_v6，v6/v5/v4/v3/v2样本和原待发信封继续独立保留，沿用现有事件与数据库表。Continue使用settlement_continue，和播放complete/skip分开。版本横线到下划线的转换是有意规范化，未知版本会拒绝。自动化仅扩充现有关键一致性用例；主会话负责真实浏览器验收与统一发布。

主玩法已经补充取消选择／Escape 的 select（选中列表为空）与真实键盘 input_method；仍需在最终试玩时核对这些入口。

## 动作入口

```js
import { captureGameState, trackGameAction } from './analytics/game-adapter.js';

const before = captureGameState(game); // 必须在引擎修改前同步调用
const selectedIds = [...game.selected];
const result = engine.commit(game, selectedIds);
void trackGameAction('commit', before, game, result, {
  selected_tile_ids: selectedIds, input_method: 'pointer', source_zone: 'hand',
});
```

`captureGameState(null)` 返回 null；其他快照是不可变副本，不保存／改写游戏对象，只在内存观察牌实体。`trackGameAction()` 始终返回 Promise，异常会降级为 `{queued:false,reason}`，不向玩法抛错。调用不必 await；`queued` 只表示进入待发队列，不是服务器 ACK。调试可查看返回的 `events/invalid`，不要把这些开发字段显示给玩家。

快照和 `trackGameAction` 应紧贴一次真实动作，**在任何 await、动画或下一次游戏修改之前调用**。适配器会同步抽取全部白名单事实，异步只负责入队。禁止从 render、inspect、预览计算、提示或计分演出逐项回调发计分事件。

| 动作 | 接入点与 context |
| --- | --- |
| start | `newRun()` 后；before 捕捉原 game（没有则 null），result 可为新 game |
| starter | `chooseStarter` 后；`relic_id` 为四核心之一；v6/v7同时获得升降笔，进入prepare成功后自动发首次 `round_started` |
| begin_play | `beginPlay` 后；prepare进入play，剩余普通换牌归零；不重复发round_started |
| select | 真实选牌按钮后；`selected_tile_ids` 是选中实体，`source_zone` 为 hand/formed |
| commit / kong / exchange | 实际引擎调用后；保存操作前所选 `selected_tile_ids`；v5/v6/v7 exchange仅prepare，每次最多5张 |
| replace | 旧版兼容；v5/v6/v7引擎拒绝成型替换，只可记真实拒绝 |
| transform | `transform` 后；v6/v7可在prepare/play编辑候选或非杠成型牌，满14也可；同关共享2墨；v5仍仅prepare；`selected_tile_ids`, `source_zone`, `transform_kind: rank/suit/wild`, `transform_value: -1/1、0/1/2、null`。V7 wild统一归一化`relic_id:core_high`，页面无需额外传来源 |
| formed_discard | 仅V7，`discardFormed(game, ids)`后；保存操作前`selected_tile_ids`与`source_zone:formed`。页面count仅为提示，实际张数取成功记录的tile_ids长度；不触发终局或摸牌事件 |
| high_rescue | `highRescue` 后；页面使用`rescue_kind: exchange/rank/suit`，适配器归一化为rescue_type；改牌另给transform_kind/value，保存操作前的selected_tile_ids；v6/v7补缺编辑与普通编辑共用2墨，补缺弃换不耗墨 |
| settle | **只在真实 `settle()` 后调用一次**；适配器读取引擎冻结的 `game.last`，发终局及合法和牌事实 |
| settlement_skip / settlement_complete | 播放器实际跳过／自然播放完成；只记展示行为，不重复生成计分事实 |
| settlement_continue | 点击继续调用 `finishSettlement()` 后；记录阶段迁移，需要时发 run_ended，和播放器完成分开 |
| reward | `chooseReward` 后；`relic_id`；满4槽时页面给`replaced_relic_id`，适配器归一化为replace_relic_id，前后奇物直接取状态 |
| skip_reward | `skipReward` 后；记录reward到关间shop的真实迁移，不新增奇物或奖励 |
| buy / sell / refresh_shop | 旧版兼容；v5/v6/v7无商店，引擎拒绝，不合成交易 |
| next_round | `nextRound()` 后；进入prepare成功后自动发新 `round_started` |
| retire | `retire()` 后；发主动结束，不造和牌或诈胡终局 |
| resume | 成功恢复对应版本存档后；before=null，result=true，`source:'save'`；不追补已发生结算 |

`input_method` 支持 pointer/keyboard/programmatic，默认 programmatic。`reason_code` 可选，必须稳定 ASCII 标签；引擎已知拒绝文案映射为固定错误码，未知拒绝记 engine_rejected，不上传原始 toast、堆栈或任意文本。context 未列字段会被丢弃。选中实体列表最多18个，变化列表最多36项，过长证据标记截断。终局证据不能截断后冒充完整。

## 复用与观测质量

boot 与适配器都从 `runtime.js` 的 `getGameAnalytics()` 取得同一 SDK；不要另外 createAnalytics。该 runtime 导入不自动开启采集，也不在普通 SSR 建客户端。浏览器首次取得正式游戏实例时，runtime 显式使用 `defaultEnabled:true`：没有保存选择时默认开启；既有 denied 保持关闭，刷新或其他标签页不能覆盖。通用 SDK 默认 false，sandbox 首次仍须主动启用。偏好不可读取时保守不开启并在设置中提示，不把读取失败当成没有关闭选择。页面销毁时不用主动 dispose；boot 面板卸载也不销毁游戏共用客户端。

数据设置入口显示“匿名统计：开/关”，关闭立即停止新增上传并清空未发送记录，同时保存关闭选择；已接收的服务器数据不会自动删除。默认启用或恢复 allowed 不重写偏好，只有玩家显式重新开启/关闭才保存选择。不要在 start、resume 或每次渲染里强行调用 `setConsent(true)`。设置存储失败时无法保证刷新恢复，面板会显示实际错误。

仅本页从进关前就已启用采集、持续同一采集代次且无队列丢失的关卡标complete。v5/v6/v7从prepare建立观测，begin_play不重置质量；准备中途开启也为partial。默认开启不补齐缺失历史；中途开启、撤回后重开、刷新续玩均保守标partial。实际终局仍保存，但partial不进入完整观测统计；下一关完整开始后可恢复complete。不能在恢复时伪造开局或进关。

同一个 before 快照重复传给相同动作会在页面内去重；结算 ID 和本关 ID 是服务端事实去重依据，SDK 网络重试复用原事件。适配器不读取历史存档补报，也不因为跳过、刷新、重新播放重复记分或发奖励。

## 引擎取值与统计

当前引擎版本为7：`opening-build-v7 / four-core-v6`映射为`opening_build_v7 / four_core_v6`。适配器分别绑定V7、V6与V5常量，仍兼容引擎6的`opening-build-v6 / four-core-v6`、引擎5的`opening-build-v5 / four-core-v5`、引擎4的`free-play-v4 / exponential-v3`、引擎3的`free-play-v3 / exponential-v3`与引擎2的`free-play-v2 / cumulative-v2`；同样接受已规范化的下划线版本。其他组合拒绝，不能把旧待发送事件重标为v7；替换旧挑战时，旧run_ended保留原版本，跨版本新动作before=null。runId、roundId、settlementId由引擎持久化。

实际拆解读取 `last.decomposition.groups / groupTileIds / pair / pairTileIds / tiles`，万能有效花色取 decomposition.tiles；保留 formed 实体原点数、改写牌面、声明杠与拥有奇物。支持 orphans/unconnected 整体14张同名组、knitted 9张同名组加普通面子和一对；不从计分模式自行推测拆解。v4/v5/v6/v7采集12张候选的真实变化，出几张补几张、余牌保留；v3仍按原10张整批轮换数据校验；终局仍14+k张实体（最多18）。

番型按生产共享目录映射稳定父 ID（箭刻／役牌子项归并）；base 写 credited_pattern_ids，relic 写 unlock_pattern_ids，实际 `gains.kind='unlock'` 的秘卷收益按全名映射：v3～v7国标车轮/连山加赏使用独立 bonus ID，不覆盖基础番型；v2保持原有将将胡／日麻大车轮／日麻三连刻口径。unavailable不进入支持目录。没有映射的新增得分番型会拒绝该事实而非静默漏记，需要同步扩充显式 ID 映射。

v3～v7分数最多Number.MAX_SAFE_INTEGER，净分和累计可负；适配器直接读取冻结game.last的total/penalty/delta/cumulativeBefore/cumulativeAfter，不重算四核心、指数公式或奇物倍率，不再次将底分或分数乘10，也不上传steps。重触发只体现在同一最终事实，播放、回放、跳过不增加终局数。服务端用精确整数验证分数等式，v2保持原10^12上限。各版本分别统计；即使v7/v6或v4/v3的score_model_version相同，规则版本不同也不合并。只传four_core_v6时选最新V7，查询V6须显式指定其rules_version。

`round_settled` 与合法时的 `hand_completed` 发送相同事实；任一先到都只形成一条结算。和牌分、过程分、罚分、本关净分、进关与终局累计分分列。合法未达标仍计番型；诈胡达标仍计过关但不计和牌；出现率以该版本全部可判定合法完整和牌为分母，形状仅描述最终拆解。

## 资源观察与预览边界

现有 State 已包含 deck_count、swaps、relic_ids。已发牌且存在 round_attempt_id 时，本关已摸实体数为 `136 - deck_count`（含初始12张）；同关动作前后牌墙数之差等于新补牌数。starter/home 不推导。候选保留时未变化的实体不进入 tile_changes，不伪造弃牌或重抽事件。

v5/v6/v7普通换牌仅prepare开放，共5次、每次最多5张；beginPlay后swaps归零。high_rescue可弃换最多3张或花墨改1张，二者共用rescue_used。v6/v7普通transform和补缺编辑均耗2墨，共享prepare/play的一次编辑；beginPlay不补墨，补缺弃换不耗墨。普通工具可编辑两区非杠牌，包括满14但尚未结算时；直接记录phase、source_zone、structure_count、ink差值与tile_changes，不新增编辑次数字段。v5历史4墨、改点换色1墨/万能2墨、普通工具仅prepare的规则保留；v4保留历史7次换牌的口径。v5/v6/v7最多4槽、1核心；v6/v7初始核心+升降笔占2槽。v5/v6原28件ID不变，V7装备白名单移除wild_jade后为27件；天机算筹core_high自带固定点数的三花色万能，其他核心不可用。成功wild必须前后持有core_high，失败尝试仍可标记该能力来源。旧版白名单不扩张。核心及奇物按动作时relic_ids和终局owned_relic_ids分层；仍用原始事件JSON保存，无新迁移或资源报表接口。构筑提示、联动推荐与render不生成动作或收益事件。

V7成型弃除在play中整趟限一次，可移走1～2张非杠牌到弃牌区，无立即补摸、无积分或墨变化。引擎`formedDiscard={round,tileIds}`映射为`State.formed_discard={round_no:round+1,tile_ids:tileIds}`，未使用为null，跨关保留。使用次数只计成功的formed_discard动作并按run_id去重，不能累计每个后续快照中的同一记录；张数取实际tile_ids.length。按run_id/round_attempt_id关联本关终局，按run_id及关号关联后续合法/诈胡；恢复仅记录已知状态，不追补动作。原始JSON已可供后续报告使用，本轮未新增该项汇总图表。只有后续结果，不能声称动作导致修复成功。

## 本地检查

`node --test tests/analytics-*.test.mjs`。本轮分组通过96项（adapter 24、server 29、client/runtime/report 43）。适配器调用真实v7引擎，覆盖弃除1/2张、次数跨关及存档保留、不补摸不加分不耗墨、后续合法/诈胡终局，及core_high万能来源与其他核心拒绝。沿用初始2槽、准备/组牌共享2墨、满14非杠编辑、3种补缺、4槽奖励替换与skip_reward、四核心和重触发的唯一终局、过程收益去重、合法/诈胡与恰好达标、15/18实体、万能定色、秘卷、特殊形状、安全整数边界及旧版隔离。既有SDK/API测试继续覆盖队列、存储、V6/V7同计分模型的规则隔离及重复终局去重。完整页面验收由主会话使用Worker+D1服务完成，测试按钮只写sandbox，禁止向production写测试手。

V7回归结果和冻结范围见[实现说明](ANALYTICS_IMPLEMENTATION.md)。现有begin_play/high_rescue/skip_reward/reward及字段别名继续沿用。2026-10-22主会话反馈全项目npm test 137/137通过，V7规则、万能与成型弃除本地浏览器验收通过；analytics共15个文件已冻结，本轮适配无剩余内容。本会话未构建、提交或部署；用户已授权主会话整合部署，线上生效状态仍以其发布结果为准。
