# 起手构筑 v8 采集契约（保留 v7 / v6 / v5 / v4 / v3 / v2）

状态：公共信封仍为 schema_version=1；当前版本成对使用 `rules_version=opening_build_v8`、`score_model_version=four_core_v6`。旧版 `opening_build_v7/four_core_v6`、`opening_build_v6/four_core_v6`、`opening_build_v5/four_core_v5`、`free_play_v4/exponential_v3`、`free_play_v3/exponential_v3`、`free_play_v2/cumulative_v2` 与 legacy 原契约继续接受、分别统计；不能交叉组合版本。V8改变动作时机，沿用V6计分公式，不新建计分版本。以下 payload 均严格白名单，未列字段拒绝；null 明确表示未知，不上传自由文本或游戏全量对象。

V8沿用V7全部字段、事件与动作，不增加数据库迁移。改点/换色/万能仅prepare，每关2墨共一次；普通候选exchange在prepare/play共用5次，每次1～5张，begin_play不清零，满14未结算仍可刷新候选并影响留牌核心最终收益。补缺符每关一次：prepare仅rank/suit编辑并共用2墨，play仅exchange≤3张且结构未满14，编辑与弃换共用rescue_used。V7整趟一次非杠成型弃除、core_high自带固定点数三花色万能、禁装备wild_jade均保留。不新增transform_used或opening_swaps_used；V5～V7历史动作时机不套用V8限制。

采集开关不新增事件或信封字段：正式游戏 runtime 使用 `defaultEnabled:true`，仅在 production 偏好可读且没有已存选择时默认开启；已有 denied 保持关闭。通用 SDK 的该选项默认 false，sandbox 不默认启用；普通模块导入与 SSR 无副作用。关闭保存 denied、清空未发队列并同步同 scope 标签页，已接收数据不自动删除。偏好不可读时不默认开启。默认启用也不放宽 complete/partial 连续观测要求，仍不补报缺失历史。

## 共享模块

`dist/analytics/game-schema.js` 导出当前版本常量、明确的 `V8_RULES_VERSION/V8_SCORE_MODEL_VERSION` 与保留的V7/V6/V5常量、事件/动作白名单、`isSupportedGameVersion(rules, score)`、`gamePatternCatalog(rulesVersion)`、`relicIdsForVersion(rulesVersion)`、`patternIdForName(mode, name, rulesVersion)`、`isGameEvent(name, context)` 和 `validateGamePayload(name, payload, context)`。目录接口省略版本时选择v8。`V8_SCORE_MODEL_VERSION`仍是four_core_v6。`GAME_PATTERN_CATALOG/RELIC_IDS` 为当前版视图，v2使用冻结番型目录，v2～v4使用冻结的21件奇物集合。名字映射将“役牌 · 白/發/中”等归并同一父番型；不认识的名字返回null。

v3～v8从生产 `pattern-catalog.js` 获取番型说明、状态和奇物要求，通过 `analytics/game-catalog-v3.js` 的显式映射生成稳定英文统计ID。仅base/relic进入统计目录；unavailable不作为已支持番型。v5引入四核心计分，奇物目录增加 `core_high/core_pung/core_held/core_growth/retrigger_meld/retrigger_held/high_rescue`；v6沿用这28件ID，v7/v8装备证据白名单排除wild_jade后为27件，状态和终局仍最多4件且不重复、最多1核心。引擎历史展示目录中的wild_jade不代表V7/V8允许装备；V2～V6原字典保留。v2～v4不接收新增的7个核心/联动ID。墨泉等停投不改写历史状态。原有番型ID保持不变，新增可计分番型必须补齐映射。

`context={rules_version,score_model_version,mode,run_id,round_attempt_id,hand_id}`；验证返回 `{ok:true,payload:规范化副本}` 或 `{ok:false,reason:稳定错误码}`。`isGameEvent` 对新增事件名始终 true，v2～v8 的 hand_completed 使用本契约。通用旧事件继续走原校验。

ID 是 8～100 位 ASCII 字母数字及 `_.:-`；实体牌与杠 ID 是 1～64 位同字符。v3～v8 分数为 Number 安全整数，绝对值最多 `Number.MAX_SAFE_INTEGER`；v2 仍最多 10^12。计分等式用精确整数比较，避免超出安全区间的中间加法掩盖错误。数量使用更小上限。发生时间、匿名身份、scope 与字节限制沿用现有服务端。单事件 <= 8 KiB、整批 <= 32 KiB、<=20 条。

## 终局：round_settled / hand_completed

两个事件使用**完全相同的 payload**，不因事件名改变字段。envelope `hand_id=payload.settlement_id`，`run_id/round_attempt_id/mode` 必须存在。`round_settled` 表示一次终局；只有 legal=true 才能发 `hand_completed`。服务端将两者合并为同一结算事实，事件先后顺序不影响去重；第二个业务重复的事件 ACK duplicate，但原事件仍保存。牌型统计基于唯一合法完整结算，不要求两个网络请求同时抵达。

```js
{
  settlement_id: '稳定结算ID', round_no: 1, // 1..6
  legal: true, result_type: 'win', // win | false_win，与legal严格一致
  passed: true, // cumulative_after >= target_score
  process_score: 80, win_score: 1200, penalty_score: 0,
  score_delta: 1200, // win_score - penalty_score；只表示终局追加
  round_score: 1280, round_start_score: 0,
  cumulative_before: 80, cumulative_after: 1280, target_score: 1000,
  record_quality: 'complete', // complete | partial；中途开启/未连续观测用partial
  shape: 'normal', // normal | pairs | orphans | knitted | unconnected；诈胡必须null
  tiles: [{id:'tile-1',original:0,face:0,effective_face:0,wild:false}], // 14+k个，<=18
  declared_kongs: [{id:'kong-1',tile_ids:['t1','t2','t3','t4'],face:0}], // <=4
  decomposition: {groups:[{type:'chow',tile_ids:['t1','t2','t3']},{type:'pair',tile_ids:['t4','t5']}]},
  // 上面仅示意：normal必须4面子+1雀头；pairs必须7对；诈胡decomposition=null
  credited_pattern_ids: ['mcr.full_flush'],
  unlock_pattern_ids: [],
  owned_relic_ids: ['jade']
}
```

- `round_score = process_score + win_score - penalty_score`；`cumulative_before = round_start_score + process_score`；`cumulative_after = cumulative_before + score_delta = round_start_score + round_score`。净分和累计可负；过程分/和牌分/罚分非负。合法必须 penalty_score=0；诈胡 win_score=0，形状/拆解为null、两套番型数组为空；允许诈胡且passed=true，等于门槛也算通过。
- tiles 实体 ID 唯一；original/face/effective_face 都是0..33。合法必须每张有 effective_face；诈胡有效花色未知时可null。非万能 effective_face 必须等于 face；万能只可数牌，effective_face 保留 face 的点数且只换三色。
- 实牌数 = 14 + declared_kongs.length；杠各4个不同实体、不能重叠，声明face须与它们有效牌面相同。普通拆解顺/刻/杠各3/3/4张及一对；日麻七对须7种不同对子且无杠，v3～v8 国标可用同牌四张作两对，v2 仍须7种不同对子。每张实体在拆解中恰好使用一次；声明杠与拆解杠必须对应。
- v3～v8 特殊拆解：`orphans`（双模式）为一个14张的同名组，无独立pair；`knitted`（国标）为一个9张 knitted 组、一个普通顺/刻/声明杠及一对；`unconnected`（国标）为一个14张同名组，无独立pair。各结构校验实际有效牌面，不能仅凭shape标签通过。v2 不接受这些新形状。
- 父级番型按手去重、排序；base 进入 credited_pattern_ids，relic 进入 unlock_pattern_ids，解锁项需拥有目录指定奇物。兼容已有 gains.kind=unlock：将将胡需 `jiang`、日麻大车轮需 `wheel`、日麻三连刻需 `mountain`。v3～v8 国标车轮/连山加赏分别记 `mcr.seven_shifted_pairs_bonus` / `mcr.pure_shifted_pungs_bonus`，与基础番型独立；v2 保持原来只记录基础番型的口径。
- 这是客户端事实及算术/形状一致性校验，并非完整服务器重算全部奇物计分；不得宣传防作弊或官方竞技成绩。

## game_action

```js
{
 action_id:'唯一动作ID', action:'commit', // GAME_ACTIONS白名单
 input_method:'pointer', // pointer | keyboard | programmatic
 outcome:'applied', // applied | rejected | noop | blocked
 reason_code:null, // null 或 <=64 位稳定ASCII标签；不可放toast文案
 before:null, after:State,
 selected_tile_ids:[], // <=18个不同实体ID
 tile_changes:[], // <=36项，紧凑tuple见下
 evidence_truncated:false,
 context:{source_zone:null,transform_kind:null,transform_value:null,relic_id:null,
   rescue_type:null,replace_relic_id:null} // 后两键仅v5/v6/v7/v8；v2～v4保持原4键
}
```

共用动作枚举：start/starter/select/commit/kong/exchange/replace/transform/settle/settlement_skip/settlement_complete/settlement_continue/reward/buy/sell/refresh_shop/next_round/retire/resume。v5/v6/v7/v8额外接受begin_play/high_rescue/skip_reward，v2～v4拒绝这些动作。v5/v6/v7/v8不开放成型替换和商店买卖；若实际调用被引擎拒绝，只记rejected。settlement_skip/complete仅表示播放跳过／自然完成；settlement_continue表示玩家继续并调用finishSettlement的阶段迁移，两者不合并为同一次complete。

formed_discard仅V7/V8接受，更早版本动作白名单不扩张。成功动作记录null→本关使用记录，selected_tile_ids须与记录相同，成型/结构数减少1～2、弃牌数相应增加，候选与牌墙数量、积分、墨等资源不变。tile_changes记录实体formed→discard；拒绝操作不能改动记录，以字段值比较而非对象引用比较。

V8仅对成功动作新增时机校验：transform的前后阶段须为prepare；exchange须保持在prepare或play，选择1～5张；high_rescue的rank/suit仅prepare、exchange仅play且执行前结构<14并选择1～3张。实际被引擎拒绝的越阶段操作仍可采集。begin_play保留实际剩余swaps，不能为了兼容旧规则写成0；墨与补缺次数只记录实际前后差值，不另算玩法或计分。

`State` 精确字段：

```js
{phase:'prepare',round_no:1,formed_count:0,structure_count:0,kong_count:0,
 hand_count:12,deck_count:124,discard_count:0,coins:8,ink:2,swaps:5,
 total_score:0,round_score:0,process_score:0,round_start_score:0,target_score:1000,
 relic_ids:['core_high','rank_brush'],single_count:0,wild_used:false,rescue_used:false,
 formed_discard:null} // 仅V7/V8；已使用时为{round_no:1,tile_ids:['tile-1']}
```

phase为home/starter/play/settlement/reward/shop/victory/defeat，v5/v6/v7/v8另有prepare；rescue_used仅v5/v6/v7/v8接受且必须为布尔。round_no 1..6；formed<=18、structure<=14、kong<=4；v4/v5/v6/v7/v8 hand<=12，v3 hand<=10（末批可6），v2 hand<=18；deck/discard<=136；coins<=10^9、ink/swaps<=1000、single_count<=4。target_score可null（starter/home）否则正数。before/after均可null，但不能同时null。拒绝操作不伪造收益或消耗救援次数。total_score/round_score/round_start_score可负，process_score非负。v4/v5/v6/v7/v8出几张补几张、未选候选保留，沿用commit/kong的真实前后快照与tile_changes；v3保留10张整批轮换口径。构筑建议属于只读预览，不产生动作、得分或render埋点。

V7/V8的formed_discard必须存在：未使用为null；已使用为{round_no,tile_ids}，关号1..6且不超过当前关，牌ID为1～2个不重复实体ID。适配器把引擎formedDiscard.round的0基关号加1。该记录跨关保留；恢复存档只保存已知状态，不伪造一次使用事件。使用次数统计仅计applied formed_discard，每趟去重一次；张数取tile_ids.length，不取页面context.count，避免后续快照重复累计。可按run_id/round_attempt_id关联本关终局，再按run_id和关号关联后续合法/诈胡结算；partial样本不冒充完整观测。

V8已进关快照的普通换牌已用次数为5-swaps；引擎内部openingSwapsUsed仍沿用旧名，现表示准备+组牌总使用次数，存档由引擎保证swaps+openingSwapsUsed=5，不要求play swaps=0。采集不新增这一冗余字段，starter/home未发牌时不推导。V5～V7在begin_play清零swaps的旧快照原样保留。

v5 在 prepare 可普通换牌5次、每次最多5张，普通改牌也只在prepare；begin_play进入play并将剩余普通换牌归零，不能返回准备。大番核心和补缺符共同解锁每关一次 high_rescue，可换最多3张或花墨改1张数牌，rescue_used记录是否实际消耗。relic_ids及终局owned_relic_ids记录当前核心与联动物；只记录冻结终局结果，不上传每步steps或另算重触发收益。shop保留历史阶段名，v5中仅为无商店的关间过渡。

v4 复用已有字段进行资源分层：只有已发牌、存在 round_attempt_id 的本关状态可将 `136 - deck_count` 解释为本关已摸实体数（包含初始12张，不是不同牌面数）；同关前后之差是本动作补牌数。starter/home 未发牌状态不推导。`swaps` 是剩余换牌次数，exchange 与 replace 共用；每关基础7次，第三关减2，借东风加2，以引擎实际快照为准。`relic_ids` 与终局 `owned_relic_ids` 支持按当时拥有奇物分层。这里不新增持久字段、事件、汇总筛选接口或数据库迁移；需要资源分层报告时从已有事实计算。

`tile_changes` 每项为 `[id,from,to,face_before,face_after,wild_before,wild_after,entered_before,entered_after]`，zone 是 hand/formed/deck/discard 或 null；牌面0..33或null，布尔或null。只保留实际变化实体，不上传未变整副牌；被限幅时 evidence_truncated=true。

context的v2～v4四个键、v5/v6/v7/v8六个键必须齐全：source_zone=hand/formed/null；transform_kind=rank/suit/wild/null；transform_value=-1/1（rank）、0/1/2（suit）、null（其他）；relic_id是对应版本允许目录或null。v5引入且v6/v7/v8沿用rescue_type=exchange/rank/suit/null（仅high_rescue可非null，成功必须明确类型），replace_relic_id=被替换奇物ID/null（仅reward可非null）。页面的rescue_kind、replaced_relic_id由适配器分别归一化为这两个字段。V7/V8 transform/wild的relic_id统一为core_high，成功时before/after都必须持有该核心；拒绝尝试同样标记能力来源，不代表已拥有。旧版本不重标来源。high_rescue改牌复用transform_kind/value，换牌时两者均null；其他非transform动作也为null。数组/快照均有上限；若超8KiB，适配器可按顺序裁减tile_changes并标记truncated，不可裁减终局事实。

## 生命周期

所有生命周期要求 run_id、mode；round_started 还要求 round_attempt_id。hand_id=null。

```js
run_started: {state:State,record_quality:'complete'}
run_resumed: {state:State,record_quality:'partial',source:'save'} // source=save|memory|consent
round_started: {state:State,record_quality:'complete'}
run_ended: {state:State,record_quality:'complete',reason:'retired'}
```

record_quality均可complete/partial；reason=victory/completed_below_target/false_win_below_target/retired/superseded。v5/v6/v7/v8的round_started在选核心或next_round实际进入prepare时产生，完整观测从此开始；begin_play只记动作，不再次进关或重置质量。准备中途开启采集、刷新续玩仍为partial。按稳定事件ID去重；SDK/适配器不能在刷新时伪造run_started或round_started。用户主动结束是独立生命周期，不伪造round_settled或合法和牌。

## 报告

`GET /api/reports/patterns`默认选择v8（`opening_build_v8/four_core_v6`），v7/v6/v5/v4/v3/v2/legacy需显式版本。v2～v8共用结算表但查询严格按版本隔离，无新迁移。即使v6/v7/v8或v3/v4计分版本相同也不合并样本；仅传score_model_version=four_core_v6时选最新规则v8，显式rules_version=opening_build_v7或opening_build_v6可查历史版本；exponential_v3仍选历史v4，four_core_v5仅选历史v5。返回旧字段并扩展：

- `denominator_basis='legal_complete_settlements'`（legacy为eligible_routes）；v2～v8各行分母均为同模式/版本 `legal && record_quality=complete` 的唯一结算数，不按最终拆解形状筛掉其他合法手。
- patterns每行保留count/denominator/rate/max_round_score，新增`max_win_score/max_cumulative_score`、`kind=base|unlock`。routes仅描述形状适用性，不作为v2～v8分母过滤条件。
- summary新增 `max_win_score/max_cumulative_score`；summary.completed_hands只合法完整观测，诈胡不进分母。
- `settlements={total,legal,false_win,passed,false_win_passed,pass_rate,max_round_score,max_cumulative_score}`：只完整观测终局，诈胡过关纳入passed；total无样本时pass_rate=null。它和合法手最高分分开展示。
- v2～v8 collection_status='gameplay_adapter_ready'；旧版标记'legacy'。报告数值为已接收客户端事实，partial保留但不进正式统计。

V8沿用V6计分公式，采集、保存、报表不再次乘10，也不换算旧版本记录。现有证据可识别成型弃除、候选刷新及后续合法结算，旧V6/V7还可识别满14后的编辑；但没有动作前后的合法性事实，不能直接称为“修复成功率”或因果结论。本轮只适配现有证据与规则版本，不新增汇总接口或专门图表。
