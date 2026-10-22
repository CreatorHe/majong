# 浏览器采集 SDK 与接入边界

状态：采集 SDK、共享 runtime 与统计页适配九张成批 v9（统一番数档位计分），同时保留 v1～v8 数据读取与待发队列。**本次修改由主玩法会话统一接线、构建、验证和发布；本文不表示 v9 埋点已经在线生效。** 主玩法接入位置见 [自由出牌接入说明](FREE_PLAY_ANALYTICS_INTEGRATION.md)，完整字段与分数口径见 [采集契约](FREE_PLAY_ANALYTICS_CONTRACT.md)。

SDK 负责采集开关、持久队列与传输；适配器负责从真实动作前后状态抽取白名单事实。正式游戏匿名统计默认开启，但既有关闭选择优先；sandbox 仍需主动开启。禁止通过 DOM 文本、渲染次数或轮询分数推测和牌、计分或奇物触发。

## 文件与入口

- `dist/analytics/client.js`：原生 ES module，通用 SDK 的 `defaultEnabled` 默认为 false；未启用时不生成随机 ID、不注册、不请求上报接口。
- `dist/analytics/runtime.js`：提供 boot 与玩法适配器共用的惰性单例；模块导入不读存储、不获取锁、不请求网络，SSR 未明确配置时返回 null。
- `dist/analytics/game-adapter.js`：提供 `captureGameState / trackGameAction`。同步捕捉不可变事实，异步入队；不修改 game、不另建客户端、不重算游戏得分。
- `dist/analytics/game-schema.js`：浏览器与服务端共享分版本的字段白名单、形状及算术校验，SDK 不再维护第二份玩法字段列表或分数上限。
- `dist/analytics/boot.js`：导出 `mountAnalyticsBoot(options)`，浏览器加载时自动挂载一次。追加“番型统计 / 匿名统计：开或关”入口，按钮打开数据设置；从 runtime 获取同一个客户端，自行引用 `boot.css`。设置显示默认开启、旧关闭保留和关闭入口；卸载面板不会销毁游戏共用客户端。
- 构建产物的游戏 HTML 加载 `<script type="module" src="/analytics/boot.js"></script>`；统计页独立使用 SDK，不再挂一次 boot。
- 统计入口为 `/analytics/`。

## 共享 runtime

```js
import { getGameAnalytics } from '/analytics/runtime.js';

const analytics = getGameAnalytics(); // 首次浏览器调用才创建；后续返回同一个实例
// SSR 默认得到 null；业务适配器已处理此情况。
```

游戏页不能在每次动作或面板挂载时重新 `createAnalytics()`。runtime 默认 `scope='production'`、`entry='game'`，版本读取共享 schema 的最新常量，目前为 `rulesVersion='nine_batch_v9'`、`scoreModelVersion='fan_score_v9'`；`appRelease` 从规则版本的下划线转为连字符，目前为 `nine-batch-v9`。`getGameAnalytics(clientOptions?)` 只在首次创建时应用参数；已存在实例不会因为后续参数改变身份或版本。升级恢复的旧 v2～v8 队列保留完整原信封，包括版本、事件 ID 和发生时间，不自动改写成 v9。

正式游戏 runtime 显式传 `defaultEnabled:true`。SDK 只在 production、偏好可读且没有保存选择（null/undefined）时默认启用；已保存 `denied` 始终关闭，不能因升级、刷新或新标签页被覆盖。偏好不可读时保守不默认开启，`lastError='preference_storage_unavailable'`，设置面板说明暂未开启并保留手动入口。默认启用或恢复 allowed 不重写 allowed 偏好；仅显式 `setConsent(true/false)` 保存玩家选择。普通模块导入和未配置的 SSR 仍没有副作用。

受控宿主或测试可在首次调用前使用：

```js
import { configureGameAnalytics, resetGameAnalytics } from '/analytics/runtime.js';

configureGameAnalytics({ client: injectedClient });
// 或 { createClient: testFactory, clientOptions: { scope: 'sandbox', autoFlush: false } }
// 已创建后仅允许再次配置同一 client；替换会报 game_analytics_already_initialized。

resetGameAnalytics(); // 显式测试/宿主清理：默认 dispose；普通 UI 卸载不要调用
```

独立统计页或 sandbox 工具可直接使用 `createAnalytics(options)`；生产与 sandbox 有独立偏好、锁、队列及服务端凭据。sandbox 不默认开启，即使误传 `defaultEnabled:true` 也不适用默认开启规则；首次写测试样本仍由玩家主动操作启用，后续可恢复 sandbox 自己保存的选择。两种范围的开关不互相沿用。

## SDK API

以下操作的 `analytics` 来自上面的共享 runtime；独立工具也可使用自己创建的 SDK。

```js

await analytics.ready; // 恢复保存的选择；正式游戏没有选择时默认启用，既有关闭仍关闭
// 正式游戏首次默认启用无需在开局回调中调用 setConsent(true)。
// 只有玩家手动重新开启，或主动启动 sandbox 测试时，才调用：
// await analytics.setConsent(true);

await analytics.track('screen_viewed', {
  screen: 'game_shell', previous_screen: null, reason: 'load',
});

const result = await analytics.flush(); // 一次最多发送一批；默认自动持续发送剩余批次
const status = analytics.getStatus();
const unsubscribe = analytics.subscribe(nextStatus => { /* 更新面板 */ });

await analytics.setConsent(false); // 立即停止，取消在途请求，串行清空事件与凭据
unsubscribe();
// dispose() 移除调度/跨页监听并释放锁，保留未发送记录。
// 共享游戏实例仅在宿主整体销毁时清理，普通设置面板关闭不 dispose。
```

`track()` 返回 `{queued:true,event_id,durable}`；同 ID 事实已在待发队列时另有 `duplicate:true`。`queued` 只表示当前 outbox 接纳，`durable:true` 才表示已经可靠持久化，二者都不是服务器 ACK。内存中接纳但尚未持久化不能当作永久完成。

拒绝返回 `{queued:false,reason}`，包括 `consent_required / collector_busy / invalid_event / event_too_large / queue_limit / event_id_conflict`。适配器统一捕获采集异常，不让采集阻断玩法。只发送白名单字段；任意全文、URL 参数、输入内容与完整 game 对象不进入 payload。基础事件清理未列字段，v2～v9 共享校验对额外字段直接拒绝。

`getStatus()` / `flush()` 返回：

```text
scope, consent=unknown|allowed|denied, collectionGeneration, queued, storage=persistent|memory
coordination=idle|owner|blocked|isolated_memory|external
delivery=idle|sending|backoff|paused|error
registered, disposed, dropped, rejected, lastError, lastSentAt, retryAt
lastAck=null|{accepted:[id], duplicate:[id], rejected:[{event_id,reason}]}
```

不在状态里暴露 `write_token`。`lastAck` 是最后一批明确响应，不是累计总数。`dropped`、`rejected` 为当前 SDK 实例计数；数据库持久保存的是待发送事件、凭据和会话，不将本地健康计数冒称全站统计。

`collectionGeneration` 是当前 SDK 实例的采集代次；启用、撤回、重新获得采集资格会递增，重复允许已启用的客户端不递增也不更换身份。它不是跨页面持久版本或客户端 ID。默认开启不改变完整性要求：适配器结合进关时的代次及 dropped 判断是否连续观测；中途开启、撤回后开启、刷新续玩保守标 partial，下一关从头完整观测后可恢复 complete。

## 事件契约

每条事件包含 `schema_version=1`、`event_id`、ISO UTC `occurred_at`、`session_id`、`app_release`、`rules_version`、`score_model_version`、`mode`、`run_id`、`round_attempt_id`、`hand_id`、`payload`。公共业务 ID 在没有玩法上下文时为 null；event_id 默认随机 UUID，也支持下述稳定覆盖。

`context.event_id` 可提供 8～100 位 `[A-Za-z0-9_.:-]` 标识；`context.occurred_at` 可提供原始 UTC ISO 时间，允许毫秒 1～3 位，须是真实日期且处于过去 7 天至未来 10 分钟。两字段为 undefined 时使用默认，null 或不合法值拒绝。网络重试始终复用原事件和原发生时间。

适配器将冻结的 event_key 用作 event_id，超过 100 字符时转为 SHA-256 标识；生命周期键来自持久 run/round ID，终局键来自 settlement ID。occurred_at 固定为动作前快照的 capturedAt 或首次动作采集时刻，同一个 before 快照的重复回调在页面内去重。

同一 event_id 仍在 outbox 时，SDK 比对业务字段并复用原完整信封；改变事实或显式改写发生时间返回 event_id_conflict。已经 ACK 后再构造同 event_id，若 session 等信封字段变化，服务端仍会拒绝冲突，不能把稳定 ID 当作随意改写历史事件的许可。适配器不恢复已 ACK 事实、不跨刷新重放或追补旧终局；SDK 继续保存原待发信封并重试，业务结算由 settlement_id 去重。

SDK 自动发送 `session_started`。连续 30 分钟无 track 操作后下一条事件会新建会话。当前不监听页面活动来补齐“有效游玩时长”，因此只将该会话当基础访问会话使用。

| 事件 | payload |
| --- | --- |
| `session_started` | `entry: game/stats/debug, viewport: compact/wide, has_save: boolean`；SDK 当前默认 `has_save=false`，不读取游戏存档 |
| `screen_viewed` | `screen, previous_screen: null/string, reason: load/navigation` |
| `ui_action` | `action, target_id: null/string, input_method: pointer/keyboard/programmatic, outcome: applied/rejected/noop/blocked, reason_code: null/string` |
| `client_error` | `code, screen: null/string, category: storage/network/runtime/resource`，不用原始堆栈或错误正文 |

基础短标签限制 `[A-Za-z0-9_.:-]`、最长 64 字符。boot 只捕获自身控件和外壳页面；游戏操作由适配器显式调用，不全局监听所有点击或异常。

### 自由出牌 v2～v4、起手构筑 v5～v8 与九张成批 v9

各版本继续使用 `game_action / run_started / run_resumed / round_started / run_ended / round_settled / hand_completed`，v9 不新增事件名或终局字段，扩展 result_type 的枚举。版本必须成对使用 `free_play_v2 / cumulative_v2`、`free_play_v3 / exponential_v3`、`free_play_v4 / exponential_v3`、`opening_build_v5 / four_core_v5`、`opening_build_v6 / four_core_v6`、`opening_build_v7 / four_core_v6`、`opening_build_v8 / four_core_v6` 或 `nine_batch_v9 / fan_score_v9`；v6～v8 共用计分模型但规则版本不同，必须按完整 pair 隔离。模式、稳定挑战 ID 及事件要求的关卡、结算 ID 必须明确。SDK 用共享 `isGameEvent()` 分派，再调用 `validateGamePayload()`；v1 hand_completed 原契约仍兼容，不得将旧 payload 改标成新版。

v3～v9 分数接受至 `Number.MAX_SAFE_INTEGER` 的安全整数，净分和累计分可为负值；v2 保留原来的 `10^12` 分数范围。v4 计分沿用 v3，v5 使用原四核心计分，v6～v8 共用 four_core_v6；任何不同规则版本都不能混排纪录。状态候选上限分别为 v2 的 18 张、v3 的 10 张和 v4～v8 的 12 张、v9 的 9 张。校验上限和精确算术来自共享 schema，SDK 不另设限制，也不在读回旧队列时改写数值。v6～v8 底分尺度与档位调整已由引擎计入实际结果，SDK、报告都不再乘十或另算大番倍率。

v9 新开局直接进入 prepare，不再选择核心。候选每批9张，每次出牌后未选候选全部弃去，再从牌堆补新9张（尾批按剩余数）；不会沿用v8留牌补牌或held计分。普通exchange在prepare/play共用每关5次、每次1～5张，但结构满14后禁止。改点/换色/万能仅prepare共用每关一次2墨；高番补缺每关一次，prepare编辑、play弃换至多3张且结构不足14，无需核心。合法工具仅 `rank_brush / suit_ribbon / wild_jade / high_rescue`，无计分类奇物、核心、过程收益或发币；状态的coins、process_score、single_count必须为0。v9恢复百相玉作为万能来源，旧v7/v8的禁用规则与core_high来源仅对其原版本生效。

v9 得分固定为 `1000 × highFanMultiplier(mode, fans)`，沿用已有按模式区分的番数档位函数；不是把累计番数直接当分数。SDK与报告直读冻结终局，不重算倍率。result_type分为win、false_win、no_yaku、incomplete：统计legal仅win=true，这与引擎no_yaku仍可标结构合法的含义不同。日麻no_yaku保留14+k实体、真实拆解与有效定色，番型为空且收益/过程/罚分全0；只发round_settled，不发hand_completed。incomplete在结构不足14且候选与牌堆为空时结束，保留0～13+k实体、shape/decomposition为null、空番型、收益/过程0，扣目标10%向上取整；它与false_win分开计数。仅完整观测的win进入番型分母，四类完整观测终局均可进入过关率；无役或未完成不计诈胡。

v8 历史规则按 `prepare → beginPlay → play` 推进：改点、换色和万能仅 prepare 可用，共用每关 2 墨、最多一次编辑；进入 play 不补墨。普通 `exchange` 在 prepare/play 共用每关 5 次，每次选 1～5 张候选，`beginPlay()` 不清零；满 14 个结构位置但未结算时仍可换候选，最终候选会影响 held 核心结算。`high_rescue` 每关共一次：prepare 仅 rank/suit 编辑且共享 2 墨，play 仅 exchange、至多 3 张且 `structure_count < 14`；两阶段共享 `rescue_used`。v8 状态与 v7 相同，不上传 `openingSwapsUsed`，有效关卡状态可用 `5 - swaps` 推导普通换牌已用次数；补缺弃换不占该普通次数。

v5～v7 历史规则按 `prepare → beginPlay → play` 推进；5 次基础换牌仅在起手准备阶段使用，进入组牌后不能返回准备阶段。v6 初始装备核心与升降笔，共占 2 槽；基础六关仍最多 4 槽、1 核心。每关共 2 墨，普通改点、换色、万能和补缺编辑均耗 2 墨，即准备与组牌共用最多 1 次改牌；进入 play 不补墨。候选与成型区非杠牌都可用普通工具，满 14 个结构位置且未结算时也可修复。补缺弃换仍须未满 14，不耗墨，与补缺编辑共用每关一次的机会。基础六关不刷新墨泉，不新增分析字段来伪造使用次数。

v5 历史规则保留：初始仅核心，普通工具仅准备阶段可用，基础 4 墨；普通改点/换色和补缺编辑耗 1 墨，万能耗 2 墨。v6 复用 v5 的 state/action/context/terminal 字段：状态 `ink / rescue_used / relic_ids`，动作 `transform / high_rescue` 及 context `source_zone / transform_kind / transform_value / relic_id / rescue_type / replace_relic_id`，终局 `owned_relic_ids` 足以记录实际资源和操作。校验完全依赖共享 schema，不向旧版状态附加字段，也不在 SDK 另写一套核心或阶段判定。

v7 新增、v8/v9 沿用状态必填 `formed_discard`：未用时为 null，使用后为 `{round_no, tile_ids}`，记录整趟首次弃牌的关卡与 1～2 个唯一实体 ID，后续关卡继续保留。`game_action.action=formed_discard` 仅 v7～v9 合法；context 仍为 v5/v6 的六个字段，不另加 count，数量由 selected/state 的实体列表得出。成功时仅把非杠成型牌移入弃牌区，不立即摸牌、计分或耗墨；共享校验检查成型/结构数减少、弃牌数增加及候选、牌堆、积分和资源不变。原 v5/v6 状态不能追加此字段或使用此动作。后续可按挑战/关卡 ID 将弃牌事实与终局关联分析，终局字段和数据库表不增加。

v7/v8 的万能能力直接由天机算筹 `core_high` 提供，固定点数、可在万/筒/条三花色中定色，其他核心不能使用。仍记录为 `transform`、`transform_kind='wild'`，与普通改牌及补缺编辑共用每关一次的 2 墨额度，不新增事件或资源字段。百相玉 `wild_jade` 在 v7/v8 退出所有奖励池且不能装备；旧版目录、持有证据及队列继续按原版本保留，不用新规则回写历史。

v4 的历史口径仍为 12 张候选、基础 7 次换牌、第三关减 2 次、借东风加 2 次。各版本继续使用 `deck_count / swaps / relic_ids`：已发牌且存在 `round_attempt_id` 的关卡状态，可用 `136 - deck_count` 分析已摸牌数；home/starter 不作此推导。资料供后续分层分析，本轮不新增资源或核心报表接口。

| 事实 | 保证与口径 |
| --- | --- |
| game_action | 记录真实动作结果、状态前后、被改动实体与有限上下文；预览、重绘不当作成功操作 |
| 生命周期 | 开局、续玩、进关、主动结束独立；恢复不伪造历史开局或进关 |
| round_settled | 每关一次真实终局，分别记录合法性与累计达标，包含诈胡过关；v5～v9 沿用终局字段，读取冻结结算的 total/delta/cumulative 等真实值 |
| hand_completed | 仅合法完整和牌，v9 仅 result_type=win；合法未达标仍保留；与 round_settled 共用同一结算事实 |
| 统计分数 | 和牌分、过程分、罚分、本关净分和累计分分列；passed 比较终局累计与门槛，净分和累计可负 |
| 牌面证据 | 完整终局的14为结构张数；声明 k 杠时实际 14+k 张，最多18张；保留实际拆解与万能最终定色；v3～v9 支持 orphans、knitted、unconnected 特殊牌形 |
| 观测完整度 | partial 事实保留，但不进入完整观测番型分母和关卡统计 |

完整 payload 见 [共享采集契约](FREE_PLAY_ANALYTICS_CONTRACT.md)，主游戏应调用 [适配器接口](FREE_PLAY_ANALYTICS_INTEGRATION.md)，而不是在 app 内再次拼装全部字段。同手多个番型可以并存，v2～v8 无番型的合法完整和牌仍以空数组进入分母；v9 仅有番型的 win 进入分母，日麻 no_yaku 不纳入。普通、七对和特殊牌形表示最终拆解，不是玩家预选路线。最高分是包含该番型的客户端上报和牌分、本关净分或累计分，不是番型独立贡献或防作弊认证成绩。

统计页独立识别 v1～v9：v1 保留预选路线分母及旧整关分；v2～v9 都显示和牌分、本关净分、累计分，旧自由出牌记录不能退回 v1 口径。筛选键与请求参数同时保留规则和计分版本：v3/v4 即使共用 `exponential_v3`，v6～v8 即使共用 `four_core_v6`，也不能合并样本和纪录。v5 保留原准备阶段工具及墨量说明，v6 保留两区共享改牌说明，v7 保留整趟一次成型弃牌与天机算筹自带万能说明，v8 保留准备阶段改牌、两阶段共用换牌及分阶段补缺说明，v9 显示无核心的九张成批规则、独立番数档位计分及四类终局，不改写历史规则。只纳入共享目录中的 base/relic 项，unavailable 不进入榜单。特殊形状展示为十三幺／国士无双、组合龙、不靠，不会误标为普通牌形。验收按钮默认写 v9 sandbox 样本，仅包含升降笔持有证据，并使用独立的 v9 本地样本编号缓存；历史版本仍能按版本读取。样本分数是传输验证数据，报告直读上报值，不在展示时加倍。冻结 steps 不逐步上报，不因播放或跳过重复产生终局。

SDK 队列持久化与主游戏存档目前仍不是同一原子事务。适配器已实现稳定事件/业务 ID、冻结发生时间、白名单证据和页面内重复动作保护，但不能宣称已经具备完整回放或关卡结束时零丢失。是否生效取决于主会话接入动作入口并统一发布。

## 发送、重试与撤回

- 正式：`POST /api/analytics/register` `{}`，得到 `client_id / write_token / expires_at`；随后 `POST /api/events`，使用 `Authorization: Bearer write_token`。
- 验收：`scope:'sandbox'` 使用 `/api/analytics/test/register`、`/api/analytics/test/events`，不默认开启，也不改变正式采集开关。`test` 仅保留为 sandbox 的兼容别名。
- 默认每 5 秒、或队列达到 20 条时调度；每批最多 20 条且 JSON 不超过 32 KiB；单条不超过 8 KiB。boot 在切后台和网络恢复时尝试 flush。`fetch(...,{keepalive:true})` 不等于已保存。
- 只有服务端 `accepted / duplicate` 或明确 `rejected` ACK 才移出队列；明确拒绝另计数并展示原因；没有 ACK 的事件保留原 event ID 重试。并发 flush 共用同一个 Promise，不并行重复发一批。
- 网络、429、5xx 指数退避 1～60 秒，并遵守最多 1 小时的 Retry-After；请求 10 秒超时。非 408/429 的其他 4xx 暂停发送以免重复请求。
- 服务端凭据使用 90 天写入 lease。事件请求 401 时，每次 flush 最多尝试一次 `POST /api/analytics/renew`（sandbox 为 `/api/analytics/test/renew`），JSON `{}`、Bearer 原 token。仅接纳 client_id 和 write_token 都保持不变的响应，持久保存新的 expires_at 后重试完全相同的 batch 和 event IDs。不会重新注册身份。续期失败、回复身份不一致或第二次 401 都暂停；定时器不循环续期，玩家可点“重试保存记录”或由调用方显式 `flush()` 再尝试一次。续期中撤回同样 abort，迟到回复不能恢复数据。
- IndexedDB 保存原始待发送队列。持久读写失败时仍允许在本页内存中排队，但**暂停网络发送**，不能使用尚未可靠持久化的新凭据发送旧磁盘快照。手动重试先恢复旧快照并合并待发事件（读失败场景），再把当前队列和凭据成功持久化，之后才继续发送。新注册凭据保存失败时也不能上报；刷新后即使重新注册，也不会出现同一事件已被两个身份接受。无 Web Locks 时主动使用的独立内存模式不读取共享快照，不受这条持久化门槛限制。
- 队列最多 5000 条、5 MiB、7 天；超界先移除普通行为，再移除最老事实，优先保留 hand_completed、round_settled、run_started、round_started、run_ended，增加 dropped。不得将发生丢失的本地记录说成完整。设置面板保留“重试保存记录”和撤回入口，说明本页暂存记录在关闭页面时可能丢失。
- 撤回同步禁用采集并 abort 在途请求；迟到注册响应或 ACK 不能恢复已删除数据。无法撤销已经到达服务器的请求；关闭不是服务端删除操作。存储清空失败以 `storage_clear_failed` 显示，不能保证浏览器拒绝访问时物理数据已经删除。

## 多标签页

浏览器有 Web Locks 时，同一 scope 只有一个 SDK 实例持有独占锁并读写持久队列。其他实例显示 `coordination:'blocked'`，`track()` 返回 `collector_busy`；不会加载旧快照或产生第二身份。持锁页 dispose/关闭或撤回后释放，其他页可再次调用 `setConsent(true)` 重新尝试。不会悄悄伪称被阻塞标签页的操作已采集。

启用偏好沿用 `jade-run:analytics:v1:<scope>:consent`，值仍为 allowed/denied。关闭保存 denied，刷新后继续关闭；撤回通过 `storage` 事件与同 scope `BroadcastChannel` 通知持锁页停止并清空，重复接收是幂等操作。启动默认开启不写 allowed 来覆盖其他标签页的 denied。生产与 sandbox 不相互关闭。偏好存储不可读写时会提示无法可靠保存选择，不能承诺该情况下刷新仍能恢复。

无 Web Locks 的浏览器使用独立内存模式，不共享全量持久快照。自动化注入 `storage` 时可同时注入 `locks`；明确 `locks:null` 表示由调用者负责隔离存储（状态为 external），仅供测试或受控嵌入，不是跨标签安全保证。

## 验证与注入

V9本组现有client/runtime/report共43/43通过：V9默认版本、9张候选与四工具、无核心/零币/零过程分校验、百相玉万能、满14禁止普通换牌、V2～V8原待发队列完整恢复，以及四类终局样本的模式与分母隔离。只扩展已有P0，未新增测试项或脚本；其他组及最终总数由主会话汇总。未做V9浏览器验收、构建、提交或部署。

V8 历史本组 `analytics-client.test.mjs / analytics-runtime.test.mjs / analytics-report.test.mjs` 共43/43通过。覆盖最新 runtime、准备阶段编辑、beginPlay保留换牌次数、满14普通换候选、分阶段高番补缺、禁止新增openingSwapsUsed、V7组牌阶段编辑原队列完整恢复，以及V6/V7/V8同计分不同规则隔离。既有默认匿名开关、撤回、离线/ACK、锁与持久化保护继续通过。仅扩展已有P0，未新增测试项或脚本；语法与diff检查通过。当轮analytics分组96/96通过；此记录不作为V9验收。

V7 历史验证：客户端三组43/43、analytics全组96/96通过。2026-10-22主会话另反馈全项目 `npm test` 137/137及V7规则、万能、弃除本地浏览器验收通过；96项不与137项相加。这些记录不作为V8/V9验收或上线依据。

`createAnalytics` 的 `defaultEnabled` 显式选项默认为 false，仅 production 缺少保存偏好时可生效。可注入 `storage:{load,save,clear}`、`preferenceStorage:{getItem,setItem}`、`fetch`、`clock`、`uuid`、`locks`、`setTimeout`、`clearTimeout`，可通过 `autoFlush:false` 手动 flush 验证；`maxEvents / maxBytes / maxAgeMs / requestTimeoutMs` 可用于受控测试。`subscribe` 会立即提供一次当前状态，返回解除订阅函数。
