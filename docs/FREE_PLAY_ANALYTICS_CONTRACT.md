# 九张整批 v9 采集契约（保留 v2～v8 与 legacy）

状态：本轮按用户最新 V9 修正接入，优先于 `V9_PLAN` 旧稿。公共信封仍为 `schema_version=1`；当前版本必须成对使用 `rules_version=nine_batch_v9`、`score_model_version=fan_score_v9`。终局沿用现有字段和表，无数据库迁移。V9 回归尚在收尾，本页不引用旧版通过数量作为本轮验收结果。

V9 面向所有玩家使用固定基数 `1000 × highFanMultiplier(mode, fans)` 的番型计分，没有核心、计分类奇物、过程分或发币。新旅程直接进入 prepare，首批 9 张候选；commit 把选中牌放入成型区，未选候选全部弃置，再从牌山补到最多 9 张。kong 使用了候选牌时同样刷新整批，纯成型区 kong 不刷新。普通换牌在 prepare/play 共用 5 次，每次 1～5 张，满 14 个结构位置后禁止。prepare 改点、换色、万能与补缺编辑共用每关一次 2 墨额度。仅保留 `rank_brush/suit_ribbon/wild_jade/high_rescue` 四件工具，补缺无需核心；整趟一次非杠成型弃除保留。

旧版 `opening_build_v8/four_core_v6`、`opening_build_v7/four_core_v6`、`opening_build_v6/four_core_v6`、`opening_build_v5/four_core_v5`、`free_play_v4/exponential_v3`、`free_play_v3/exponential_v3`、`free_play_v2/cumulative_v2` 与 legacy 继续接受、分别统计。不能重标旧队列、套用 V9 字典或交叉组合版本。

采集开关不新增事件或信封字段：正式 runtime 使用 `defaultEnabled:true`，仅在 production 偏好可读且没有已存选择时默认开启；已有 denied 保持关闭。通用 SDK 默认 false，sandbox 主动启用；普通导入与 SSR 无副作用。关闭保存 denied、清空未发队列并同步同 scope 标签页，已接收数据不自动删除。偏好不可读时不默认开启；开启不补报缺失历史，也不放宽 complete/partial 要求。

## 共享模块与目录

`dist/analytics/game-schema.js` 导出当前版本常量、V5～V9 显式版本常量、事件/动作白名单，以及 `isSupportedGameVersion(rules, score)`、`gamePatternCatalog(rulesVersion)`、`relicIdsForVersion(rulesVersion)`、`patternIdForName(mode, name, rulesVersion)`、`isGameEvent(name, context)`、`validateGamePayload(name, payload, context)`。使用带版本的目录接口；省略版本时选择 V9。验证返回 `{ok:true,payload:规范化副本}` 或 `{ok:false,reason:稳定错误码}`。

V9 番型目录只含当前可计分基础番型，`unlock_pattern_ids` 必须为空；没有奇物解锁番型、核心或联动计分。`analytics/game-catalog-v3.js` 已冻结 V3～V8 的显式英文 ID、说明、形状和奇物要求，避免生产 `pattern-catalog.js` 删除奇物后重写历史；V9 取其中基础番型集合，与当前生产可计分基础番型保持一致。unavailable 不进入支持目录。名字映射把“役牌 · 白/發/中”等归并父番型；未知或 V9 已移除的奇物加赏返回 null，不能静默漏记。

V2～V8 保留各自番型与装备目录：V2 用冻结番型目录；V3～V8 保留 base/unlock 和原 bonus ID。V2～V4 的 21 件奇物、V5/V6 的 28 件、V7/V8 排除 wild_jade 后的 27 件均按原版本解释。V9 仅接受上述四件工具、最多 4 件且不重复；V7/V8 禁用 wild_jade 不影响 V9 恢复它，V9 删除核心也不影响旧队列。

`context={rules_version,score_model_version,mode,run_id,round_attempt_id,hand_id}`。`isGameEvent` 对新增事件名始终 true，V2～V9 的 hand_completed 使用对应游戏契约；通用旧事件继续走原校验。payload 均严格白名单，未列字段拒绝；null 表示未知，不上传自由文本或游戏全量对象。

ID 是 8～100 位 ASCII 字母数字及 `_.:-`；实体牌与杠 ID 是 1～64 位同字符。V3～V9 分数为 Number 安全整数，绝对值最多 `Number.MAX_SAFE_INTEGER`；V2 仍最多 10^12。计分等式用精确整数比较，数量另有限幅。单事件 ≤8 KiB、整批 ≤32 KiB、≤20 条；匿名身份、scope、时间与存储规则不变。

## 终局：round_settled / hand_completed

两个事件使用相同 payload。envelope `hand_id=payload.settlement_id`，`run_id/round_attempt_id/mode` 必须存在。`round_settled` 表示一次终局；V9 只有 `result_type=win` 且规范化 `legal=true` 才发 `hand_completed`。服务端将两个事件合并为同一结算事实，先后顺序不影响去重；业务重复 ACK duplicate，原事件仍保存。番型统计不要求两个请求同时抵达。

V9 区分四类结果；不能从 `!legal` 推断诈胡：

| result_type | analytics legal | 结构与拆解 | 和牌分 / 罚分 | 番型统计 |
| --- | --- | --- | --- | --- |
| win | true | 完整有效拆解，14+k 实体 | 实际正收益 / 0 | 发 hand_completed，完整观测进入分母 |
| false_win | false | 结构数 14，但没有有效拆解；shape/decomposition=null | 0 / ceil(target_score×10%) | 不进入 |
| no_yaku | false | 仅日麻，保留真实完整拆解和万能有效定色，14+k 实体 | 0 / 0 | 不发 hand_completed，番型数组为空 |
| incomplete | false | 牌山和候选都空、结构不足 14；0～13+k 实体，shape/decomposition=null | 0 / ceil(target_score×10%) | 不进入 |

引擎 `no_yaku` 的 `legal=true` 只表示结构成立，适配器必须按 resultType 规范化为 analytics `legal=false`，同时保留拆解。`incomplete` 的空牌山/候选前置条件由适配器核对真实引擎状态，终局不新增重复状态字段。四类结果的 passed 均独立取 `cumulative_after >= target_score`，等于门槛即通过；无役、未成型及诈胡均可能依靠此前累计分过关。

```js
{
  settlement_id:'稳定结算ID', round_no:1, // 1..6
  legal:true, result_type:'win', passed:true,
  process_score:0, win_score:2000, penalty_score:0,
  score_delta:2000, round_score:2000, round_start_score:0,
  cumulative_before:0, cumulative_after:2000, target_score:1000,
  record_quality:'complete', // complete | partial
  shape:'normal', // normal | pairs | orphans | knitted | unconnected | null
  tiles:[/* {id,original,face,effective_face,wild}，真实实体 */],
  declared_kongs:[/* {id,tile_ids:[四个实体ID],face} */],
  decomposition:{groups:[/* {type,tile_ids}，覆盖全部实体的真实拆解 */]},
  credited_pattern_ids:['mcr.full_flush'],
  unlock_pattern_ids:[], owned_relic_ids:['rank_brush']
} // 数字与数组仅示意字段，不能作为一手可发送的测试牌
```

- `score_delta = win_score - penalty_score`；`round_score = process_score + score_delta`；`cumulative_before = round_start_score + process_score`；`cumulative_after = cumulative_before + score_delta = round_start_score + round_score`。V9 process_score 固定为 0，净分和累计可负。V2～V8 保留各自实际过程分与罚分规则，终局仍只接受 win/false_win。
- 实体 ID 唯一；original/face/effective_face 为 0..33。win/no_yaku 每张必须有 effective_face；false_win/incomplete 的未知万能有效牌面可 null。非万能有效牌面等于 face；万能只可数牌，保留点数且只换三色。
- 完整终局实牌数为 `14 + declared_kongs.length`，incomplete 的实牌数减杠数为 0..13。杠各有 4 个不同实体、不能重叠，声明 face 须与实际有效牌面一致。incomplete 虽无整体拆解，仍保留已声明杠及其有效定色。
- normal 为四个顺/刻/杠及一对；日麻 pairs 为七种不同对子且无杠；V3～V9 国标可用同牌四张作两对，V2 仍要求七种。每张实体在完整拆解中恰好使用一次，声明杠与拆解杠一致。
- V3～V9 特殊拆解：orphans（双模式）为一个 14 张同名组；knitted（国标）为一个 9 张 knitted 组、一个普通面子及一对；unconnected（国标）为一个 14 张同名组。校验实际有效牌面，不能仅凭 shape 标签通过；V2 不接受这些新形状。
- 番型按手去重并排序。V9 仅 win 可带 credited_pattern_ids；其余三类两套数组均为空。V3～V8 奇物解锁仍需拥有指定奇物，国标车轮/连山加赏沿用独立 `mcr.seven_shifted_pairs_bonus` / `mcr.pure_shifted_pungs_bonus`，不改写历史基础番型。
- 这是客户端事实及算术/结构一致性校验，不是服务器重算全部番型，不宣传防作弊或官方竞技成绩。

## game_action 与 State

```js
{
  action_id:'唯一动作ID', action:'commit',
  input_method:'pointer', // pointer | keyboard | programmatic
  outcome:'applied', // applied | rejected | noop | blocked
  reason_code:null, // 稳定 ASCII 标签，不能放 toast 文案
  before:null, after:State,
  selected_tile_ids:[], tile_changes:[], evidence_truncated:false,
  context:{source_zone:null,transform_kind:null,transform_value:null,relic_id:null,
    rescue_type:null,replace_relic_id:null}
}
```

共用动作保留 start/starter/select/commit/kong/exchange/replace/transform/settle/settlement_skip/settlement_complete/settlement_continue/reward/buy/sell/refresh_shop/next_round/retire/resume；V5～V9 额外接受 begin_play/high_rescue/skip_reward，V7～V9 接受 formed_discard。兼容动作名不代表 V9 重新开放选核心、成型替换或商店；只有真实调用才记录，失败不能合成成功。

V9 成功 transform 前后必须 prepare，选择 1 张；普通 exchange 前后保持 prepare 或 play，执行前结构<14，选择 1～5 张；high_rescue 的 rank/suit 仅 prepare，exchange 仅 play、执行前结构<14、选择 1～3 张。补缺只需 high_rescue 工具，两个阶段共用一次 rescue_used；编辑共享 2 墨，补缺弃换不耗墨或普通换牌次数。begin_play 保留剩余 swaps。实际越阶段或资源不足而被引擎拒绝的操作仍可采集。V8 满 14 后普通换牌以及 V6/V7 play 编辑的历史事件不套用 V9 限制。

commit 的变化证据必须含选中 hand→formed、未选 hand→discard、新批 deck→hand；kong 有候选参与才发生整批刷新。普通 exchange 只替换选择的候选，不能与 commit 刷新混为一类。被拒绝的操作不伪造资源或分数变化。

```js
// V9 首关已发牌的 State 示例
{phase:'prepare',round_no:1,formed_count:0,structure_count:0,kong_count:0,
 hand_count:9,deck_count:127,discard_count:0,coins:0,ink:2,swaps:5,
 total_score:0,round_score:0,process_score:0,round_start_score:0,target_score:1000,
 relic_ids:['rank_brush'],single_count:0,wild_used:false,rescue_used:false,
 formed_discard:null}
```

State 字段不新增。phase 白名单保留 home/starter/play/settlement/reward/shop/victory/defeat，V5～V9 另有 prepare；V9 正常新旅程直接 prepare，不生成 starter 过程。round_no 1..6；formed≤18、structure≤14、kong≤4；hand 上限 V9=9、V4～V8=12、V3=10、V2=18。deck/discard≤136；V9 coins/process_score/single_count 固定 0；其余历史范围保留。target_score 可 null（未发牌）否则正数。before/after 可 null 但不能同时 null；total_score/round_score/round_start_score 可负，process_score 非负。

rescue_used 仅 V5～V9 接受且为布尔。formed_discard 仅 V7～V9 必须存在：未用为 null，已用为 `{round_no,tile_ids}`，关号不超过当前关，1～2 个不同实体。适配器把引擎 0 基 round 加 1；记录跨关保留。成功 formed_discard 限 play，成型/结构减 1～2、discard 相增，候选、牌山、分数、墨和其他资源不变；tile_changes 精确记录 formed→discard。使用次数只计 applied 动作并按 run_id 去重，不累计后续快照；恢复不追补一次使用。

仅已发牌且存在 round_attempt_id 时，V9 `136-deck_count` 表示已摸实体数（含初始 9 张），同关前后之差表示本动作补牌数；`5-swaps` 表示普通换牌已用次数。内部 openingSwapsUsed 不上传，不新增 transform_used 等冗余字段。V8 同样跨阶段共用 5 次，V5～V7 begin_play 清零 swaps 的旧状态保持原样。

`tile_changes` 每项是 `[id,from,to,face_before,face_after,wild_before,wild_after,entered_before,entered_after]`；区域 hand/formed/deck/discard 或 null，牌面 0..33 或 null，布尔或 null。只传变化实体，最多 36 项；selected_tile_ids 最多 18 个不同实体。超长动作证据可裁减并设置 evidence_truncated=true，终局事实不可裁减后冒充完整。

context V2～V4 保持四键，V5～V9 保持六键，所有键必须齐全。source_zone=hand/formed/null；transform_kind=rank/suit/wild/null；transform_value=-1/1（rank）、0/1/2（suit）、其他为 null。rescue_type=exchange/rank/suit/null，仅 high_rescue 可非 null，成功必须明确；replace_relic_id 仅 reward 可非 null。页面 rescue_kind/replaced_relic_id 分别归一化到这两个字段。relic_id 按对应版本目录验证。V9 transform/wild 来源为 wild_jade，成功前后必须持有；V7/V8 仍为 core_high，旧来源不重标。失败可记录能力来源而不宣称已拥有。high_rescue 编辑复用 transform_kind/value，弃换时两者均 null。

## 生命周期与观测质量

所有生命周期要求 run_id、mode；round_started 还要求 round_attempt_id；hand_id=null。

```js
run_started:{state:State,record_quality:'complete'}
run_resumed:{state:State,record_quality:'partial',source:'save'} // save|memory|consent
round_started:{state:State,record_quality:'complete'}
run_ended:{state:State,record_quality:'complete',reason:'retired'}
```

record_quality 可 complete/partial；reason 保留 victory/completed_below_target/false_win_below_target/retired/superseded，仅 V9 增加 no_yaku_below_target/incomplete_below_target。失败终止原因按终局类型分类，不能将无役归合法未达标或把未成型归诈胡。

V9 start 在 newRun 实际建立 run 和第一关 prepare 后产生 run_started+round_started，从该同步动作建立完整观测，不伪造 starter。next_round 成功建立后续 prepare 时发 round_started；begin_play 只记动作，不再进关或重置质量。V5～V8 保留选核心后开始首次 prepare 的旧路径。准备中途开启、撤回重开、刷新续玩均为 partial；仅持续同一采集代次、无队列丢失的整关可 complete。刷新不补报 run_started/round_started，主动结束不伪造终局。

## 报告与历史隔离

`GET /api/reports/patterns` 默认 V9（nine_batch_v9/fan_score_v9）；显式规则查 V2～V8 或 legacy。仅传 fan_score_v9 选 V9；four_core_v6 仍选历史 V8，exponential_v3 选 V4，four_core_v5 选 V5。所有查询按完整规则/计分组合、mode、scope 隔离；同计分模型的 V6/V7/V8 或 V3/V4 不合并。旧队列及原信封原样保留，无新迁移。

- denominator_basis=legal_complete_settlements（legacy 为 eligible_routes）。V9 分母仅同模式/版本 result_type=win、legal=true、record_quality=complete 的唯一终局；no_yaku/incomplete/false_win 不进入。形状不筛分母，合法未过关仍计入。
- patterns 各行保留 count/denominator/rate/max_round_score，另有 max_win_score/max_cumulative_score、kind；V9 仅 base。同手同番型计一次，多番占比之和可超过 100%。
- summary.completed_hands 与 max_win_score 只取合法完整观测；三项最高分分别取和牌分、本关净分、累计分的最大值，不要求来自同一手，也不是某番型单独贡献。
- settlements 保留 total/legal/false_win/passed/false_win_passed/pass_rate/max_round_score/max_cumulative_score，并分别统计 no_yaku/incomplete/no_yaku_passed/incomplete_passed。false_win 必须按 result_type 精确计数，不能用 1-legal。四种结果全部纳入完整观测终局总数，passed 独立统计，无样本 pass_rate=null。
- partial 保留原始事实但不进入正式汇总。V2～V9 collection_status=gameplay_adapter_ready；legacy 保留旧口径与表查询。

采集与报表直接保存冻结终局，不重算固定基数、番型倍率、旧四核心或指数公式，不换算历史分数。预览、回放、跳过和重试不增加计分事实。现有动作证据可关联后续终局，不能据此宣称“修复成功率”或因果关系。本轮不新增专用资源图表、自动解题或现实胡率基线。
