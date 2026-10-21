# 叠雀数据采集：基础链路与接入说明

## 本轮范围

本轮在既有浏览器采集 SDK、匿名统计开关、Worker 接收接口、D1 持久存储、番型统计页和独立测试样本上适配起手构筑 v5。统计页仍位于 `/analytics/`，不新增采集系统或数据库迁移。

**当前版本为 `opening_build_v5 / four_core_v5`，适配器、共享校验、runtime 与报告已接入；主玩法会话负责最终试玩、构建与统一发布。** v4、v3、v2 与 legacy 数据继续分版本保留；当前契约见 [字段说明](FREE_PLAY_ANALYTICS_CONTRACT.md)，接线见 [主玩法接入说明](FREE_PLAY_ANALYTICS_INTEGRATION.md)。适配器观察真实引擎结果，不从渲染或预览推测操作；测试数据仍不写入正式统计。本轮未独立构建、提交或发布，也不表示 v5 已在线生效。

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
- `record_quality=complete` 的合法完整和牌进入番型统计，包含累计分不足目标的合法手；`partial` 保存但不进入榜单。诈胡过关计入关卡过关率，不计和牌或番型。
- v2～v5 出现率 = 计入该番型的合法手数 / 同模式与版本全部可判定合法完整和牌数；普通、七对及特殊结构只是最终拆解。旧版仍按适用路线分母。无分母为 `null`，UI 显示“—”。
- 同一手可以命中多个番型，各行占比不要求相加为 100%。
- v2～v5 分别显示最高和牌分、本关净分、终局累计分，净分/累计允许负数；每行是含该番型的牌局指标，不是番型独自贡献。旧版只保留原整关分。
- 国标/日麻、正式/测试、玩法版本与计分版本分别统计；默认 v5（`opening_build_v5 / four_core_v5`），可显式选择 v4、v3、v2 或 legacy，不把不同版本合并。v5 不能继续标作旧指数计分，旧待发送信封不改标。
- 同 event ID 重试不重复保存；同一手换 event ID 仍不会增加手数与番型次数。后者保留新的原始事件以识别后续 event ID 冲突。
- 同 ID 内容变化会拒绝，不覆盖旧纪录；一次事件的原始记录、手摘要及番型关联在 D1 batch 中原子保存。

v2 新增、v3～v5 沿用 `round_settlements / settlement_patterns` 两表（迁移 `0001_fluffy_jamie_braddock.sql`），保留旧表。round_settled 与合法时 hand_completed 发送同一事实，任一先到都只形成一个结算；按客户端、本关和结算 ID 去重，冲突原子回滚。v5 终局字段不变，读取冻结结算的 total/delta/cumulative 等真实值；计分演出 steps 不逐步重报，不因播放、跳过或继续重复记分。

v3～v5 沿用生产番型目录和稳定英文 ID，只有 base/relic 进入统计，unavailable 不计入已支持番型。这些版本的分数支持到 Number.MAX_SAFE_INTEGER，并校验精确整数等式；v2 保留10^12上限。国士/十三幺、组合龙、全不靠/七星不靠及国标四张作两对继续由共享 schema 验证。v3 的10张整批轮换、v4 的12张留牌补牌都作为历史规则保留；v3/v4 虽同为 exponential_v3 也不合并，v5 使用独立的四核心计分版本。现实数据对比暂未接入。

v5 以12张候选进入 `prepare`，5次基础换牌仅限准备阶段；`beginPlay()` 成功后进入 `play`，不能回到准备阶段。4个奇物槽最多装备1件计分核心，核心持有证据使用状态 `relic_ids` 和终局 `owned_relic_ids`。`rescue_used` 是 v5 专用状态字段，记录大番核心与补缺符共用的每关一次补缺机会；普通换牌与普通改牌不能延续到组牌阶段。已发牌且存在 round_attempt_id 的本关快照可用 `136 - deck_count` 推导已摸实体数，home/starter 不推导。swaps、奇物与补缺状态保存在原始事件中，未新增资源或核心报表接口。

## 主玩法会话接入

使用 `game-adapter.js` 的 `captureGameState(game)` 与 `trackGameAction(action,before,game,result,context)`；boot 与适配器通过 `runtime.js` 复用同一 SDK。完整接入步骤见 [主玩法接入说明](FREE_PLAY_ANALYTICS_INTEGRATION.md)。不要在游戏重新创建客户端，不从 render/preview/hints 上报计分事实；中途开启、关闭重开和刷新续玩保守标 partial，不补造旧历史。正式游戏默认启用由 runtime 配置负责，不在 start/resume 或渲染中调用 `setConsent(true)` 覆盖关闭选择；模块导入与普通 SSR 无副作用。

真实 app 的 `begin_play / high_rescue / skip_reward` 动作已接入同一 `game_action` 通道，不新增事件名。适配器接受 app 提供的 `rescue_kind / replaced_relic_id`，转换为 v5 白名单 context 的 `rescue_type / replace_relic_id`。新关在进入 prepare 时记录 round_started；开始组牌只记录真实阶段迁移，不再造一次进关。补缺与奖励换装均读取动作前后状态，不从按钮文字推断。

以下保留 **legacy 历史接口示意，不能用于 v2～v5**：

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

v2 必须使用 `free_play_v2 / cumulative_v2`，v5 使用 `opening_build_v5 / four_core_v5`；各版都由适配器生成完整证据，不能照搬上面的旧版七字段示例。稳定 runId/roundId/settlementId 由引擎保存。

新动作、终局、生命周期白名单集中在 `dist/analytics/game-schema.js`；新增字段同时修改共享 schema 与测试，不在字段中塞整份 game 对象。

## 验收办法

1. 打开统计页，正式样本应显示真实记录或空态。
2. 切到“测试样本”，展开“采集链路验收”，主动写入 v5 样本。每批 6 个终局中 5 个完整、1 个 partial（排除）；合法和牌 2 手，另有 3 次诈胡。样本带新核心持有证据，并使用独立 v5 本地编号缓存。
3. 清一色和七对各 1/2=50%；5 个完整终局中 3 次过关（含 2 次诈胡过关），过关率 60%。最高和牌分 1800、净分 1880、累计 4900。
4. 重复发送同一批，服务端应返回 duplicate，手数与最高分不增加。刷新页面、重启本地服务后仍可读取已接收统计。
5. 切日麻和正式样本，不能混入刚才的国标测试数据。
6. 正式游戏无已存偏好时默认开启；已有 denied 时保持关闭。在独立设置中关闭后，刷新及同 scope 其他标签页保持关闭，未发队列清空；重新开启只能由玩家主动操作。sandbox 不因正式游戏默认开启而自动写入。偏好读取失败时暂不开启，关闭偏好保存失败时提示刷新可能恢复默认开启；均不阻断游戏。

单元/集成检查使用实际 SQLite 执行生成的迁移，并覆盖事务回滚、冲突、分母、版本隔离和请求边界；本地预览另外使用真实 D1 兼容运行时验证。

本次 v5 分组回归共94项通过：adapter 22/22、server 29/29、client/runtime/report 43/43。覆盖准备阶段、真实 app 动作与参数、补缺状态、四核心和两种重触发的唯一终局、准备中途开启仍为partial、终局去重及旧版隔离，仅扩展既有 P0；未新增测试脚本。本轮未进行 v5 浏览器验收、构建、提交或部署。

2026-10-21 初始基础链路验收记录：`npm test` 57 项通过（客户端 24、服务端 13、原玩法 20），生产构建通过。本地浏览器验证国标/日麻样本隔离、重复上传不增计、部分观测排除、刷新与服务重启后数据保留，以及采集开启/关闭；390px 屏幕无整页横向溢出。凭据过期保持原身份续期，持久化失败暂停发送并允许恢复后重试。这是历史验证，不表示 v5 已完成浏览器验收或发布。

## 默认开启的本机浏览器验收（2026-10-21）

主玩法会话使用本地 Worker + D1 与此前未访问的新预览地址，在真实桌面浏览器完成：首次访问直接显示“匿名统计：开”；设置说明默认开启且提供关闭入口；关闭后另一标签页同步关闭；刷新仍保持关闭；手动重新开启后显示“本次待发送记录已保存”。未写入线上测试牌局。相关 analytics 回归 90/90 通过，构建通过；无新测试脚本、采集字段或数据库迁移。

本段保留 v5 之前的默认开启功能验收记录，不作为 v5 规则、四核心计分或新动作入口的浏览器验证依据。

## 后续仍需完成

独立牌型匹配、服务器完整计分重算、个人完整挑战报告、原设计中的原始记录自动保留清理与用户历史删除流程尚未实现。当前关闭采集只停止新增并清理本地待发数据，不删除已被服务器接收的记录；设置页面必须明确这一点。现实基线本轮不接入。
