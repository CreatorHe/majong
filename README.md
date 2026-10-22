# 叠雀 Web 原型 · 轻松与高难双玩法

单人麻将闯关，国标／日麻自选。九张候选整批刷新，自由组牌至14个结构位置，以辅助奇物做大牌，用番型倍率获得大数字。

轻松模式的规则与计分见 [V9计划](docs/V9_PLAN.md)，实际验证见 [V9验收记录](docs/V9_VALIDATION.md)。首页红紫色「高难度模式」进入独立的 V5 四路线玩法，恢复国标／日麻、十二张留牌补齐、原版奇物与关卡数值；见 [高难度方案](docs/HARD_MODE_PLAN.md) 与 [双玩法验收](docs/HARD_MODE_VALIDATION.md)。V5 的数值估算只适用于高难玩法，不能用于 V9 轻松模式。

## 本地运行

完整数据服务需要 Node.js 22.13+，游戏使用原生 JavaScript，服务端为 Worker + D1。

```sh
npm install
npm run dev
```

游戏地址：`http://127.0.0.1:4175/`，统计页：`http://127.0.0.1:4175/analytics/`。启动命令会构建并应用尚未执行的本地数据库迁移；本地数据保存在 `.wrangler/state/`，与线上数据库隔离。

高难模式地址：`http://127.0.0.1:4175/hard/`。轻松模式保存为 `jade-run-v9`，高难模式保存为 `jade-run-hard-v5`，不会导入或覆盖旧 `jade-run-v5`。两个页面各自恢复进度；统计区分轻松、高难和历史数据。

只预览玩法可使用 Python 3：

```sh
npm start
```

打开 `http://127.0.0.1:4173/`。纯静态入口不含采集数据接口。游戏进度保存在当前浏览器；停止预览按 Ctrl+C。

## 部署

项目使用 Vite、Cloudflare Workers 和 D1。Node.js 需为 22.13 或更新版本。部署前安装依赖并登录 Cloudflare：

```sh
npm install
npx wrangler login
npx wrangler d1 create jade-run
```

从 `d1 create` 的结果复制数据库 ID，然后设置 `CLOUDFLARE_D1_DATABASE_ID` 并运行部署命令：

```sh
CLOUDFLARE_D1_DATABASE_ID=<你的数据库 ID> npm run deploy
```

部署脚本会构建 Worker 和静态资源、应用 `drizzle/` 中的远程迁移，再发布 Worker。游戏和 `/analytics/` 共用同一域名；匿名统计由 D1 保存。数据库 ID 只需在本地 shell 或部署环境变量中设置，不要提交到仓库。只需托管纯静态文件时，`dist/` 可交给任意静态文件服务器，但采集接口和统计页需要 Worker 才能工作。

## V9 当前规则

- 136张牌山，候选上限9；每次出牌未选牌全部弃除，再摸最多9张。杠使用候选时也整批刷新，仅成型区声明杠则不刷新。
- 每关准备／组牌共用5次主动弃换，每次1～5张，只换所选。满14时关闭主动弃换。
- 改点、换色、万能只在准备阶段，共用每关一次额度；需要对应工具。万能保留点数，仅代万／筒／索。
- 开局自带升降笔，过关选择未持有的换色绫、百相玉、补缺符。最多4件，收齐后直接继续；没有计分核心或额外计分类奇物。
- 整趟一次成型弃除，弃1～2张非杠牌、不立即摸牌。四张同牌可声明杠，四实体占三位置。
- 固定基数1,000 × 牌型倍率，最终向下取整。国标24番为256,000分，88番为4,096,000分；日麻6翻为384,000分，单倍役满为2,048,000分。完整倍率表见计划和游戏内图鉴。
- 累计过关不扣门槛。国标六关：32,000／128,000／384,000／896,000／1,920,000／3,968,000；日麻：12,000／36,000／84,000／180,000／372,000／756,000。这些是待持续试玩验证的初值。
- 日麻无役为0分；诈胡及牌山／候选耗尽的未完成扣本关目标10%。扣后累计仍达标可以过关。
- `nine-batch-v9`规则、`fan-score-v9`计分，独立`jade-run-v9`存档；V8及更早存档保留、不混算旧成绩。

## 结算与验证

复用逐番、高分与役满演出，显示固定基数和牌型倍率；无役、未完成与诈胡分别展示。跳过、重播和刷新不重复计分，装饰加载失败不阻断继续。

验收遵循 [AGENTS.md](AGENTS.md)：浏览器实际试玩为主，只扩展现有P0自动化；单元测试定牌不代表真实随机胜率。历史模拟与旧浏览器harness不用于V9平衡结论。

```sh
npm test
npm run build
```

## 文件与素材

当前规则以 [V9方案](docs/V9_PLAN.md) 为准；[自由出牌与结算计划](docs/FREE_PLAY_AND_SETTLEMENT_PLAN.md)保留历史讨论。数据采集与统计由独立适配层维护，接口、部署边界和实际交付范围见 [采集接入说明](docs/ANALYTICS_IMPLEMENTATION.md)；纯静态预览不代表服务端已接入。

- `dist/balance.js`：番数倍率、获取节奏及关卡参数的唯一来源。
- `dist/engine.js`：状态迁移、番型计分、奇物、关卡与不可变结算快照。
- `dist/hand-rules.js`：完整拆解、花色万能解释和保留现牌的补牌可达性检查。
- `dist/riichi-patterns.js`、`dist/mcr-patterns.js`：双模式番型目录、判定与复合规则。
- `dist/pattern-catalog.js`、`dist/pattern-guide.js`：包含成立条件及不适用原因的游戏内图鉴。
- `dist/app.js`：游戏页面、交互与浏览器存档。
- `dist/build-hints.js`：只读的辅助奇物状态，不另行计分。
- `dist/settlement-adapter.js`、`dist/settlement/`：冻结结果到演出数据的适配、播放器和音效。
- `dist/tiles.js`、`dist/art/tiles/`：34 种本地 SVG 麻将牌面。
- `dist/style.css`：桌面与手机布局。
- `dist/art/manifest.json`：奇物和背景图片索引，缺失素材保留可玩占位。
- `scripts/balance-check.mjs`：可复现的 V2 试玩模拟。

V9只投放 `rank_brush / suit_ribbon / wild_jade / high_rescue`；旧版奇物素材仍归档保留。

运行素材使用 WebP，原始制作文件在上级 `art/` 中保留。麻将图案改编自 [FluffyStuff 的 CC0 麻将矢量素材](https://github.com/FluffyStuff/riichi-mahjong-tiles)，调整配色并绘制蓝框白板，授权记录见 `dist/art/tiles/LICENSE.md`。无需下载麻将字体。

## 来源

- 本次逐项核对与适配边界：[国标番型核对](docs/MCR_PATTERN_AUDIT.md)、[日麻役种核对](docs/RIICHI_PATTERN_AUDIT.md)。日麻目录总数包含宝牌及传统结算档位的“不适用”说明，不代表 54 个独立役。
- [国标番型速查](https://ukmahjong.co.uk/wp-content/uploads/2023/02/MCR-Summary.pdf)
- [日麻役种资料](https://www.jannavi.net/yaku/1yaku/)
- [日麻地方役](https://www.jannavi.net/yaku_local)
- [青天井官方介绍](https://www.taptap.cn/app/722620)
- [雀魂青云之志玩法整理](https://www.gamersky.com/handbook/202508/2000264.shtml)

秘卷数值奖励和奇物名称为本作设计。将将胡使用“完整牌型仅含 2、5、8 数牌”的地区玩法改编，未引入整套长沙麻将规则。
