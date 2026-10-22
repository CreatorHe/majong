# V9 发布记录

发布时间：2026-10-22 21:35（北京时间）。

- 线上地址：https://jade-mahjong-run.vastfox12.chatgpt.site
- 游戏版本：V9 / package 0.9.0。
- Sites 版本序号：17（平台序号，与游戏 V9 不同）。
- Sites source commit：`6f664ee60ef445f34fb1b6d6aa235e7a1860b6f1`。
- Saved version：`appgprj_6ad82b87dbe4819188f114d776a36c4a~appgver_6ab084ffcc84819194f323df729de4f9`。
- Deployment：`appgdep_6ada10ecd0588191a8d25b81a3ef6df8`，原生发布返回 succeeded。
- 保留现有公开访问设置，V9 独立存档，未删除旧版进度。

## 核验

主仓与发布源均通过 130 项测试及生产构建。完成整体 Review 并修正日麻重开文案、改写候选弃除提示。

真实浏览器线上确认首页“番起青山 V9”、国标／日麻入口、国标开局 9 张候选、自带升降笔及 32,000 门槛。准备结束后打出单张中：成型区 1 张，未选 8 张弃除，补满新 9 张，已摸由 9 增至 18，牌山由 127 降至 118，主动弃换仍为 5 次。

本地正常随机浏览器首关：国标七对 24 番 256,000 分、日麻断幺九 1 翻 12,000 分，均完成结算和奖励检查。详见 V9_VALIDATION.md；此次不是完整六关胜率测试，门槛仍为待试玩验证的初值。

证据目录：`../outputs/v9-browser-20261022/`（相对仓库上级工作区），含 production-v9-home.png、production-v9.png、production-v9.txt 和本地双模式结算记录。
