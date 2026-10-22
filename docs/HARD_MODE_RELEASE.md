# 独立高难度模式发布记录

发布时间：2026-10-22 22:49:12（北京时间）。线上地址：https://jade-mahjong-run.vastfox12.chatgpt.site 。高难度入口：https://jade-mahjong-run.vastfox12.chatgpt.site/hard/ 。

## 发布凭据

- Sites 保存版本：18（这是发布平台版本号，玩法仍分别为 V9、V5）。
- Sites 项目：`appgprj_6ad82b87dbe4819188f114d776a36c4a`。
- 保存版本 ID：`appgprj_6ad82b87dbe4819188f114d776a36c4a~appgver_6baf0faaef68819185412dc1a4c02836`。
- 发布源码 SHA：`03383a0667b89ddccac7a0a4f9a3688abf39451c`。
- Deployment：`appgdep_6ada2253966c8191804d1450dacb246f`，原生发布结果 `succeeded`，原有公开范围未变。
- 归档 SHA-256：`2443bbc48e4a8a9e1fa4af21548b4efbdebe080d84d9bc99399ffc4bad52bdb0`。

## 交付边界

轻松 V9 的九张批次、双规则、大数字计分与辅助奇物玩法保持不变。顶部新增红紫色「高难度模式」入口；高难在独立路径恢复历史 V5 四路线、国标与日麻，包含独立存档、规则模块及统计版本。

V9 既有发布记录仍见 [V9_RELEASE.md](V9_RELEASE.md)。本次方案、完整本地验收、统计约定分别见 [HARD_MODE_PLAN.md](HARD_MODE_PLAN.md)、[HARD_MODE_VALIDATION.md](HARD_MODE_VALIDATION.md)、[HARD_V5_ANALYTICS.md](HARD_V5_ANALYTICS.md)。

## 发布后真实浏览器检查

1. 首页显示「番起青山 V9」，顶部红紫入口可见；国标、日麻可选。恢复原 V9 国标第一关，候选九张、成型中、已摸 18/136、本关门槛 32,000、弃换五次，原进度未受影响。
2. 点击入口到高难首页，显示 V5、十二张保留补齐、国标／日麻。选择日麻进入四核心页，四条路线及原画均显示。
3. 选择藏锋匣正常随机开局：候选十二张、五次准备换牌、四墨、首关门槛 200。开始组牌后准备资源锁定。
4. 单独打出二万，成型 1/14，已摸 12→13，其余十一张保留，只补一筒。刷新并继续后，候选、成型、资源与路线恢复。
5. 返回 V9 并继续原国标存档，前后完整 DOM 相同；未新开或覆盖原轻松旅程。
6. 线上统计高难读取 `hard_opening_build_v5 / hard_four_core_v5`，可筛选四条路线；本次国标筛选无已结算新样本。切到轻松读取 `nine_batch_v9 / fan_score_v9`，原国标八手合法记录仍在。两套结果未混排。

本次上线后检查覆盖发布、开局、出牌、刷新、模式切换与统计读取；结算、奖励和下一关此前已由本地四路线正常随机浏览器试玩覆盖。失败样本保留，详见验收记录。本次不是新的平衡性抽样，也不宣称每路线完成六关。

## 检查与证据

最终 `npm test` 141/141（统计 104 项），构建成功，`git diff --check` 通过。独立 Review 无剩余发布阻断。线上根页面／引擎／样式、高难页面／引擎／平衡表、统计运行时／客户端／报告共九个关键文件与发布构建逐字一致，SHA-256 记录在 `production-assets.json`。入口截图与线上 DOM 保存在工作区 `outputs/hard-mode-20261022/`：`difficulty-entry.png`、`production-home.txt`、`production-hard-cores.png`、`production-hard-play.txt`、`production-hard-restored.txt`、`production-easy-before.txt`、`production-easy-after.txt`、`production-stats-hard.txt`、`production-stats-easy.txt`。

本地 Worker 在最后一次重建触发热重载时因本地 SQLite 锁退出；该临时服务器已结束，最终验收使用线上站点。未修改线上数据库结构。
