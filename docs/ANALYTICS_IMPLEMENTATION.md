# 叠雀数据采集：基础链路与接入说明

## 本轮范围

本轮在既有浏览器采集 SDK、匿名统计开关、Worker 接收接口、D1 持久存储、番型统计页和独立测试样本上适配九张成批 v9。统计页仍位于 `/analytics/`；v9 沿用既有事件与终局字段，扩展 result_type 为 win/false_win/no_yaku/incomplete 并单独汇总，不新增采集系统或数据库迁移。

**当前适配版本为 `nine_batch_v9 / fan_score_v9`；主玩法会话负责完整集成、最终试玩、构建与统一发布。** v8、v7、v6、v5、v4、v3、v2 与 legacy 数据继续分版本保留；当前契约见 [字段说明](FREE_PLAY_ANALYTICS_CONTRACT.md)，接线见 [主玩法接入说明](FREE_PLAY_ANALYTICS_INTEGRATION.md)。适配器观察真实引擎结果，不从渲染或预览推测操作；测试数据仍不写入正式统计。本轮未独立构建、提交或发布，也不表示 v9 已在线生效。下方V8的96项、V7的96项与主会话137项/浏览器结果、V6的95项、V5的94项均属于历史验证，不替代本轮回归。

当前只统计实际计入得分的番型。独立形状判定、被高番覆盖的低番、现实数据对照、完整计分事务核对及最高整次挑战等仍按原设计分阶段接入。

正式游戏匿名统计默认开启，既有关闭选择保持关闭。通用 SDK 的 `defaultEnabled` 仍默认为 false，只有 production 游戏 runtime 显式传 true；偏好可读且没有选择时才适用，读取失败则保守不开启。sandbox 不默认启用，首次写入需主动点击测试操作。默认启用不重写已存偏好；只有设置里显式开启/关闭才保存选择。设置入口显示“匿名统计：开/关”，关闭会清空未发送记录并同步其他标签页，已上传记录不会自动删除。关闭偏好保存失败时明确提示刷新后可能恢复默认开启。

## 运行与数据位置

```sh
npm install
npm test
npm run dev
```

完整本地服务：`http://127.0.0.1:4175/`，统计页：`http://127.0.0.1:4175/analytics/`。

`npm run dev` 依次构建、应用尚未执行的本地数据库迁移、启动 Worker。数据库保存在忽略目录 `.wrangler/state/`，停止/重启服务保留数据。本地与线上 D1 分开；部署时由 Wrangler 按 `drizzle/` 中的迁移建表，不能用本地记录冒充线上记录。

原有 `npm start` 仍是 4173 端口的纯静态玩法预览，**不提供数据接口**。要验收采集、保存、统计，请使用 4175 的完整服务。

构建使用公开的 Cloudflare Vite 插件。原游戏源仍在 `dist/`；构建将其复制到忽略目录 `dist/client/`，只在副本的游戏入口加入独立 `analytics/boot.js`。Worker 输出在 `dist/server/`。构建不覆盖原有 `app.js`、`engine.js` 或美术。

## 端点与隔离

| 接口 | 用途 |
| --- | --- |
| `POST /api/analytics/register` | 采集启用后获取随机客户端 ID 和写入凭据 |
| `POST /api/events` | 上传正式事件 |
| `POST /api/analytics/test/register` | 创建仅用于测试区的写入凭据 |
| `POST /api/analytics/test/events` | 上传测试事件，服务端固定为 sandbox |
| `POST /api/analytics/renew`、`/api/analytics/test/renew` | 用已有凭据续期写入授权，保留客户端身份和去重记录 |
| `GET /api/reports/patterns` | 查询汇总，支持 mode、scope、rules_version、score_model_version |
| `GET /api/health` | 检查 Worker 与数据库连接 |

注册 body 为 `{}`。上传使用 `Authorization: Bearer <write_token>`，JSON body 为 `{ "events": [...] }`。凭据只以哈希存库；写入授权每次有效 90 天，到期后可以用已有凭据同身份续期，不能只凭客户端 ID 认领。续期保持原 token 和客户端 ID，重试仍使用原 event ID；不能用测试凭据向正式接口写入。SDK 不在授权过期后自动更换客户端并重放旧数据。

服务端按接口与凭据确定 scope，不接受客户端事件中的 `scope / is_test` 覆盖。单批最多 20 条、32 KiB，单事件 8 KiB；按写入凭据限额 300 条/分钟，429 返回 Retry-After。字段白名单拒绝任意附加内容和跨模式/路线的番型。写接口检查同源来源，不提供公共原始事件查询。

匿名写入不构成反作弊认证；分数是客户端上报并经形状、万能定色及算术一致性校验的事实，暂未在服务器重算全部奇物收益。全站汇总是观察工具，不用于赛事奖励。

## 统计规则

- 同一客户端、同一手、同一父级番型只计一次；箭刻/役牌多个子项归并为父项。
- `record_quality=complete` 的合法完整和牌进入番型统计，包含累计分不足目标的合法手；`partial` 保存但不进入榜单。诈胡过关计入关卡过关率，不计和牌或番型。v9只有有番型的win进入分母，no_yaku与incomplete只按自身类型进入完整观测终局统计。
- v2～v9 出现率 = 计入该番型的合法手数 / 同模式与版本全部可判定合法完整和牌数；普通、七对及特殊结构只是最终拆解。旧版仍按适用路线分母。无分母为 `null`，UI 显示“—”。
- 同一手可以命中多个番型，各行占比不要求相加为 100%。
- v2～v9 分别显示最高和牌分、本关净分、终局累计分，净分/累计允许负数；每行是含该番型的牌局指标，不是番型独自贡献。旧版只保留原整关分。
- 国标/日麻、正式/测试、玩法版本与计分版本分别统计；默认 v9（`nine_batch_v9 / fan_score_v9`），可显式选择 v8、v7、v6、v5、v4、v3、v2 或 legacy，不把不同版本合并。v6～v8 虽共用 four_core_v6，仍按完整规则/计分 pair 隔离，旧待发送信封不改标。v6～v8 总分已包含引擎的底分与倍率调整，统计页只读原值，不再乘十或重算大番档位。
- 同 event ID 重试不重复保存；同一手换 event ID 仍不会增加手数与番型次数。后者保留新的原始事件以识别后续 event ID 冲突。
- 同 ID 内容变化会拒绝，不覆盖旧纪录；一次事件的原始记录、手摘要及番型关联在 D1 batch 中原子保存。

v2 新增、v3～v9 沿用 `round_settlements / settlement_patterns` 两表（迁移 `0001_fluffy_jamie_braddock.sql`），保留旧表。round_settled 与合法时 hand_completed 发送同一事实，任一先到都只形成一个结算；按客户端、本关和结算 ID 去重，冲突原子回滚。v5～v9 终局字段不变，读取冻结结算的 total/delta/cumulative 等真实值；计分演出 steps 不逐步重报，不因播放、跳过或继续重复记分。

v3～v8 沿用生产番型目录和稳定英文 ID，只有 base/relic 进入统计，unavailable 不计入已支持番型。这些版本的分数支持到 Number.MAX_SAFE_INTEGER，并校验精确整数等式；v2 保留10^12上限。国士/十三幺、组合龙、全不靠/七星不靠及国标四张作两对继续由共享 schema 验证。v3 的10张整批轮换、v4 的12张留牌补牌都作为历史规则保留；v3/v4 虽同为 exponential_v3 也不合并，v5 使用原四核心计分，v6～v8 共用 four_core_v6，但规则不同仍分开统计。现实数据对比暂未接入。

v9新开局直接prepare，无核心；每批9张候选，出牌后余候选全部弃去并刷新9张，尾批不足9张则取剩余牌。仅rank_brush/suit_ribbon/wild_jade/high_rescue四类辅助工具，不使用计分类奇物或核心，不产生过程分或发币。普通exchange在prepare/play共用每关5次、每次1～5张，满14后禁止；prepare编辑共一次2墨，补缺不需要核心。旧v8满14换候选和held结算保留为历史规则。

v9使用 `1000 × highFanMultiplier(mode, fans)` 固定基数和原有番数档位倍率，不直接累计番数作分数。四类终局均保留原字段：只有win的统计legal为true；日麻no_yaku虽结构成立，统计legal仍为false，保留14+k实体、真实拆解与有效定色、空番型，win/process/penalty均0；incomplete仅结构不足14且候选/牌堆耗尽，实体0～13+k、shape/decomposition为null，空番型与零收益/过程，扣目标10%向上取整。false_win同罚但独立计数。no_yaku与incomplete不发hand_completed，不进合法和牌分母，也不计诈胡。完整观测终局均按累计分判断过关，统计页分别展示无役与未完成数量。

v8历史规则保持12张候选与 `prepare → beginPlay → play` 流程。改点/换色/万能仅准备阶段可用，共用每关2墨。普通换牌在准备与组牌共用每关5次，每次1～5张，beginPlay不清零；满14且未结算仍可换候选，最终候选参与held核心计分。高番补缺每关一次：prepare仅rank/suit并共享2墨，play仅exchange至多3张且结构不足14；两阶段共享rescue_used。state完全沿用v7，不加openingSwapsUsed；有效关卡快照可用 `5 - swaps` 推导普通换牌已用次数，不含补缺弃换。

v5～v7 历史规则都以12张候选进入 `prepare`，5次基础换牌仅限准备阶段；`beginPlay()` 成功后进入 `play`，不能回到准备阶段。v6 初始核心＋升降笔占2槽，仍最多4槽、1核心；每关2墨，准备与组牌共用最多一次普通或补缺编辑，两区非杠牌可改，满14个结构位置未结算时也可普通修复。补缺弃换仍限未满14，弃换不耗墨，与补缺编辑共用每关一次机会；基础六关不刷新墨泉。v5 的初始仅核心、基础4墨、普通工具仅准备阶段及原编辑成本保持历史口径。

v7 新增、v8/v9 沿用整趟挑战一次成型弃牌：组牌期间可弃去1～2张非杠成型牌，不立即摸牌、得分或耗墨。状态 `formed_discard` 未使用为 null，使用后保存首次弃牌的 `{round_no, tile_ids}`，以后关卡继续携带；旧 v5/v6 状态仍不含该字段。动作 context 保持原六键，数量由选中实体与状态记录得到，不额外上报 count。当前只保留原始动作供后续按挑战/关卡关联终局分析，不新增专用弃牌报表。

v7 将万能能力并入天机算筹 `core_high`：固定点数、万/筒/条三花色可定色，其他核心不能使用。仍经 `transform(kind='wild')` 记录，准备与组牌共用每关一次的2墨改牌额度。百相玉 `wild_jade` 退出v7所有奖励池且不能装备；旧版本的目录与持有记录不改写，不新增采集字段或数据库迁移。

v8 继续由core_high提供固定点数三花色万能、禁止装备wild_jade，但万能操作同普通改牌仅prepare可用；V7的prepare/play改牌旧口径仍独立保留。整趟一次成型弃牌规则不变，不立即摸牌、得分或耗墨。

核心持有证据仍使用状态 `relic_ids` 和终局 `owned_relic_ids`，v6～v8 沿用 `ink / rescue_used` 记录墨量和每关补缺机会。已发牌且存在 round_attempt_id 的本关快照可用 `136 - deck_count` 推导已摸实体数，home/starter 不推导。swaps、奇物与补缺状态保存在原始事件中，未新增资源或核心报表接口。

## 主玩法会话接入

使用 `game-adapter.js` 的 `captureGameState(game)` 与 `trackGameAction(action,before,game,result,context)`；boot 与适配器通过 `runtime.js` 复用同一 SDK。完整接入步骤见 [主玩法接入说明](FREE_PLAY_ANALYTICS_INTEGRATION.md)。不要在游戏重新创建客户端，不从 render/preview/hints 上报计分事实；中途开启、关闭重开和刷新续玩保守标 partial，不补造旧历史。正式游戏默认启用由 runtime 配置负责，不在 start/resume 或渲染中调用 `setConsent(true)` 覆盖关闭选择；模块导入与普通 SSR 无副作用。

真实 app 的 `begin_play / high_rescue / skip_reward / formed_discard` 动作沿用同一 `game_action` 通道，不新增事件名。适配器接受 app 提供的 `rescue_kind / replaced_relic_id`，转换为 v5～v9 白名单 context 的 `rescue_type / replace_relic_id`。新关在进入 prepare 时记录 round_started；开始组牌只记录真实阶段迁移，不再造一次进关。补缺、普通改牌与奖励换装均读取动作前后状态，不从按钮文字推断。

以下保留 **legacy 历史接口示意，不能用于 v2～v9**：

浏览器模块：`dist/analytics/client.js`，稳定字典：`server/catalog.js`，详细 SDK 接口见 `ANALYTICS_CLIENT.md`。请复用已有 SDK 实例，不在每次 render 创建新实例，也不要从 `preview()` 或 `hints()` 发成型事件。

```js
import { createAnalytics } from './analytics/client.js';

const analytics = createAnalytics({ scope: 'production', entry: 'game' });
await analytics.ready;
// 通用 SDK 默认不启用；此处仅为 legacy 示意。当前正式游戏复用 runtime 的 defaultEnabled 配置。
// setConsent(true/false) 只用于玩家显式改变选择，不在开局时覆盖已存关闭偏好。

// 以下在引擎首次确认完整成型后调用；所有数值必须来自实际结算。
await analytics.track('hand_completed', {
  shape: 'normal',
  round_no: 1,
  round_score: actualRoundScore,
  target_score: actualTargetScore,
  passed: actualRoundScore >= actualTargetScore,
  credited_pattern_ids: stableCreditedPatternIds,
  record_quality: hasCompleteObservation ? 'complete' : 'partial',
}, {
  mode: game.mode,
  app_release: APP_RELEASE,
  rules_version: RULES_VERSION,
  score_model_version: SCORE_MODEL_VERSION,
  run_id: persistedRunId,
  round_attempt_id: persistedRoundAttemptId,
  hand_id: persistedHandId,
});
```

v2 必须使用 `free_play_v2 / cumulative_v2`，v5 使用 `opening_build_v5 / four_core_v5`，v6 使用 `opening_build_v6 / four_core_v6`，v7 使用 `opening_build_v7 / four_core_v6`，v8 使用 `opening_build_v8 / four_core_v6`，v9使用 `nine_batch_v9 / fan_score_v9`；各版都由适配器生成完整证据，不能照搬上面的旧版七字段示例。稳定 runId/roundId/settlementId 由引擎保存。

新动作、终局、生命周期白名单集中在 `dist/analytics/game-schema.js`；新增字段同时修改共享 schema 与测试，不在字段中塞整份 game 对象。

## 验收办法

1. 打开统计页，正式样本应显示真实记录或空态。
2. 切到“测试样本”，主动写入v9样本。每批6个终局/9条事件，5个完整观测、1个partial（排除）；有番型和牌2手，国标另有2次诈胡、1次未完成，日麻另有1次诈胡、1次无役、1次未完成。样本仅带升降笔持有证据，使用独立v9编号缓存。
3. 两模式合法分母均2，清一色、七对、断幺各1/2=50%；5个完整观测终局中3次过关，过关率60%。最高和牌/净分/累计分在国标样本均1024000、日麻样本均768000；目标32000，未完成样本扣3200后为-3100。无役0分无罚且不进番型分母；重复发送不改变这些数字。
4. 重复发送同一批，服务端应返回 duplicate，手数与最高分不增加。刷新页面、重启本地服务后仍可读取已接收统计。
5. 切日麻和正式样本，不能混入刚才的国标测试数据。
6. 正式游戏无已存偏好时默认开启；已有 denied 时保持关闭。在独立设置中关闭后，刷新及同 scope 其他标签页保持关闭，未发队列清空；重新开启只能由玩家主动操作。sandbox 不因正式游戏默认开启而自动写入。偏好读取失败时暂不开启，关闭偏好保存失败时提示刷新可能恢复默认开启；均不阻断游戏。

单元/集成检查使用实际 SQLite 执行生成的迁移，并覆盖事务回滚、冲突、分母、版本隔离和请求边界；本地预览另外使用真实 D1 兼容运行时验证。

V9 统计适配已冻结（2026-10-22）：`npm run test:analytics` 98/98 通过，其中 adapter 26、server 29、client/runtime/report 43；同一工作区 `npm test` 全部通过。只在既有适配器测试文件补充无役、耗尽未完成两项核心终局回归，没有新测试脚本。真实引擎→适配器→SDK→API→SQLite 链路、重复重试去重、四类终局与过关边界、首关完整观测、九张批次、辅助工具来源和奖励池已验证。历史 V2～V8 快照、旧奇物目录、原待发队列及完整规则/计分组合隔离继续通过。统计文件语法与差异检查通过，只读复核未发现 P0/P1。

V9 本轮共修改 17 个统计相关文件：`dist/analytics/` 中 game-adapter.js、game-schema.js、game-catalog-v3.js、report.js、index.html；`server/analytics.js`；5 个既有 analytics 测试文件；ANALYTICS_CLIENT、ANALYTICS_IMPLEMENTATION、ANALYTICS_PLAN 和 FREE_PLAY_ANALYTICS_BRIEF、FREE_PLAY_ANALYTICS_CONTRACT、FREE_PLAY_ANALYTICS_INTEGRATION 六份文档。没有新增迁移，未改引擎、app、结算、构建或 package 文件，未构建、提交或部署。V9 浏览器试玩、音画与最终 UI 接线仍由主玩法会话验收；此前打开的本地统计页是既有 V8 构建，不能作为 V9 浏览器验收。

V8历史分组回归96/96通过：adapter 24/24、server 29/29、client/runtime/report 43/43。覆盖准备阶段改点/换色/万能及补缺编辑、beginPlay保留换牌次数、准备1次+组牌4次共用额度与实际存档恢复、满14普通换候选改变藏锋匣最终held收益、两阶段补缺共用一次、组牌编辑拒绝仍正常上报、V7原待发队列和play编辑保留，以及V6/V7/V8完整pair隔离。真实引擎8→适配器→SDK→API→SQLite链路通过，终局直接读取冻结last并验证重试去重；V7成型弃除原回归继续通过。仅扩展现有P0，无新测试项或脚本；语法与diff检查通过，只读复核未发现analytics P0/P1。本轮未改app/engine/build/package或服务端实现，未构建、提交、部署或做V8浏览器验收，不沿用历史结果作为本轮验收。

V8当轮analytics已冻结，以下仅保留历史完成范围，不代表V9已验收。变更15个文件：`dist/analytics/`中的`game-adapter.js`、`game-schema.js`、`report.js`、`index.html`；`tests/`中的`analytics-adapter.test.mjs`、`analytics-server.test.mjs`、`analytics-client.test.mjs`、`analytics-runtime.test.mjs`、`analytics-report.test.mjs`；`docs/`中的`ANALYTICS_CLIENT.md`、`ANALYTICS_IMPLEMENTATION.md`、`ANALYTICS_PLAN.md`、`FREE_PLAY_ANALYTICS_BRIEF.md`、`FREE_PLAY_ANALYTICS_CONTRACT.md`、`FREE_PLAY_ANALYTICS_INTEGRATION.md`。UI由主会话并行修改，整合时确认play普通换牌与prepare补缺编辑入口；浏览器验收和统一发布由主会话完成。

V7历史分组回归共96/96通过：adapter 24/24、server 29/29、client/runtime/report 43/43。真实引擎7→适配器→SDK→API→SQLite已验证2张成型弃除、无即时摸牌/积分/墨消耗、重复回调与重试去重、补回和最终合法结算；适配器另覆盖1/2张弃除、刷新/跨关保留次数、后续合法或诈胡终局、天机算筹万能归属及其他核心拒绝。共享校验验证V7不能装备wild_jade，旧V6持有证据/原队列保留，V6/V7同一four_core_v6按完整pair隔离。只在现有文件扩展P0，新增1项整趟弃除链路测试，无新测试脚本。语法与diff检查通过，只读复核未发现P0/P1问题。未改app/engine/build或服务端实现、未新增迁移，未构建、提交、部署或进行V7浏览器验收；完整试玩与统一发布由主会话负责。

V7历史封版补充（2026-10-22，主玩法会话反馈）：全项目 `npm test` 137/137通过，V7规则、万能与成型弃除的本地浏览器验收通过。上述96项是analytics分组结果，不与137项相加。用户当时已授权V7整合部署，由主会话负责执行；本记录只确认当时的本地验收，不代表部署已完成。V7当轮analytics代码、P0测试与文档已冻结；此结果不代表V8/V9已完成浏览器验收或上线。

V7当轮冻结文件共15个：`dist/analytics/`中的`game-adapter.js`、`game-schema.js`、`report.js`、`index.html`；`tests/`中的`analytics-adapter.test.mjs`、`analytics-server.test.mjs`、`analytics-client.test.mjs`、`analytics-runtime.test.mjs`、`analytics-report.test.mjs`；`docs/`中的`ANALYTICS_CLIENT.md`、`ANALYTICS_IMPLEMENTATION.md`、`ANALYTICS_PLAN.md`、`FREE_PLAY_ANALYTICS_BRIEF.md`、`FREE_PLAY_ANALYTICS_CONTRACT.md`、`FREE_PLAY_ANALYTICS_INTEGRATION.md`。该清单仅保留V7历史范围。

V6历史验证（2026-10-22）：分组回归共95项通过：adapter 23/23、server 29/29、client/runtime/report 43/43。真实引擎6→适配器→SDK→API→SQLite验证初始核心+升降笔、共享2墨、满14普通改牌、过程收益与冻结终局直接入库、丢失ACK重试及重触发去重。适配器覆盖改点/换色/万能、补缺编辑和普通编辑共用额度、补缺弃换不耗墨、四核心终局，以及V5原资源与版本保留。报告与旧outbox验证V5/V6隔离、不二次乘10。只在既有文件扩展P0，增加1项满牌修复用例，无新测试脚本；语法和diff检查通过，只读复核未发现P0/P1问题。当轮未改主玩法、服务端代码或迁移，未构建、提交、推送、部署或进行V6浏览器验收；完整试玩由主会话负责。此95项记录不作为V7～V9回归结果。

v5历史分组回归共94项通过：adapter 22/22、server 29/29、client/runtime/report 43/43。覆盖准备阶段、真实app动作与参数、补缺状态、四核心和两种重触发的唯一终局、准备中途开启仍为partial、终局去重及旧版隔离。保留该记录供历史追溯，不作为V6～V9回归结果。

2026-10-21 初始基础链路验收记录：`npm test` 57 项通过（客户端 24、服务端 13、原玩法 20），生产构建通过。本地浏览器验证国标/日麻样本隔离、重复上传不增计、部分观测排除、刷新与服务重启后数据保留，以及采集开启/关闭；390px 屏幕无整页横向溢出。凭据过期保持原身份续期，持久化失败暂停发送并允许恢复后重试。这是历史验证，不表示 v5～v9 已完成浏览器验收或发布。

## 默认开启的本机浏览器验收（2026-10-21）

主玩法会话使用本地 Worker + D1 与此前未访问的新预览地址，在真实桌面浏览器完成：首次访问直接显示“匿名统计：开”；设置说明默认开启且提供关闭入口；关闭后另一标签页同步关闭；刷新仍保持关闭；手动重新开启后显示“本次待发送记录已保存”。未写入线上测试牌局。相关 analytics 回归 90/90 通过，构建通过；无新测试脚本、采集字段或数据库迁移。

本段保留 v5 之前的默认开启功能验收记录，不作为 v5～v9 规则、四核心计分或新动作入口的浏览器验证依据。

## 后续仍需完成

独立牌型匹配、服务器完整计分重算、个人完整挑战报告、原设计中的原始记录自动保留清理与用户历史删除流程尚未实现。当前关闭采集只停止新增并清理本地待发数据，不删除已被服务器接收的记录；设置页面必须明确这一点。现实基线本轮不接入。
