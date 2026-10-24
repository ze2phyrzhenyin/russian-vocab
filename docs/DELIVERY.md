# 2026-10-24 首轮交付

本轮由 Codex 完成开发、修复、构建和验收。用户要求的开发框架和 A/B/C 首个可测试闭环已完成；完整版注解和生产发布仍是后续里程碑。

## 运行与访问

- 主项目：`rex-cli:/home/adminlinux/Developer/russian-vocab`；本机工作区：`/Users/zephyrsui/Developer/russian-vocab`。
- 已运行演示：<http://localhost:4187>，经本机 SSH 转发到 rex-cli 的 `127.0.0.1:4186`。隧道断开后执行 `ssh -N -L 4187:127.0.0.1:4186 rex-cli`，局域网可用 `rex-cli-lan`。
- app 容器限额 1.5 GiB / 2 CPU；独立 PostgreSQL 17.11 为 1 GiB / 1 CPU，仅绑定 `127.0.0.1:55486`。Docker 构建使用本项目 3 GiB / 2 CPU builder。没有调整其他业务或公网入口。
- `demo@ruslearn.test / RusDemo!2026` 有 8 个演示学习项目与 3 个错词；`new@ruslearn.test / RusDemo!2026` 在服务器仍为全新状态。
- 管理员随机密码在服务器 `.local/demo-access.md`；本机私有副本为 `.local/rex-cli-demo-access.md`，权限 600，不提交 Git。本机开发数据库的管理员密码另在 `.local/demo-access.md`。
- 安装、启动与可控重置见根 README；五分钟操作步骤见 `docs/DEMO.md`。正常启动不重新下载依赖或 OCR 模型。

## 已验证能力

真实认证、跨册/多课范围、保存学习范围、双向题与翻卡、错词隔题再练、独立方向 FSRS 状态、刷新/退出恢复、个人集合增改删/导出、词/词组/句子手动预览录入、真实俄中 OCR 编辑确认、原图追溯、离线课次及 outbox、账号隔离、可解释冲突处理、管理员版本修订和原文保护。

真实 OCR 样图返回 15 个文字框、引擎置信度 91%，编辑确认后 4 条内容入库学习。置信度不是准确率。系统 TTS 检测俄语语音，缺少语音时明确提示；核心功能不依赖外部 AI key。

## 数据与内容

| 口径 | 数量 |
| --- | ---: |
| 当前工作簿源条目 / 教材学习项目 | 4,835 / 4,835 |
| 册 / 课 | 6 / 69 |
| 多对多归课关联 | 4,838 |
| 方向卡 | 14,505 |
| 提取图片 / 被公式引用锚点 | 108 / 104 |
| 释义练习可用项目 | 4,795 |
| 缺中文 / 争议源条目 | 35 / 11 |
| 代表注解项目 / 人工核验字段 | 50 / 0 |

11 条争议中包括 6 条已知体配对疑误。词元、独立义项尚未跨源归并，不把源行数称为去重单词数。50 项代表注解包括 15 名词、10 形容词、10 动词、10 词组、5 句子，生成候选与未知状态均保留。第 3 册来自 17 页词表摘录；当前工作簿完整导入不等于证明六册原书无遗漏。

## 验证证据

- `artifacts/verification/e2e-final.json`：最终 10/10 浏览器测试，0 skipped / 0 flaky，69.9 秒。
- `artifacts/verification/latest.json` 与日志：lint、类型、64 项 TS/数据库/安全测试、11 项导入测试、9 项内容测试、生产构建通过；后续改动另经类型/lint/构建与最终 E2E 回归。
- `artifacts/checkpoint-c/`：10 次离线事件精确同步/重放、刷新反馈恢复、账号缓存隔离、冲突与管理员修订、9 次 axe 零违规审计。
- `artifacts/compatibility/`：真实 WebKit 27.2 离线刷新及 3 条精确同步；Chromium 4 倍 CPU 降速下双向反馈样本、44px 触控、长句、200% 字号与截图。计时为点击到 DOM 更新/下一帧机会，不声称实机屏幕绘制延迟或帧率。
- `artifacts/import/idempotency.json`：实际数据库重复导入后源数据、教学修订、数量、演示状态和历史均不变。服务器重复 setup 也完成且无数据重置。
- `artifacts/deployment/`：实际 Docker/数据库版本、资源限额、三个账号登录与权限检查；公开 CI 配置尚未在 GitHub 执行。

本机测试环境为 macOS、Node 24.9.0、PostgreSQL 14.18、Playwright 1.64.1；服务器为 Node 24.21.0 与 PostgreSQL 17.11。手机尺寸及 WebKit/iPhone 参数仿真不等同 iOS Safari / Android Chrome 实机验收。

## 下一条开发任务

实现持久化的全词库注解作业、失败重试/取消、供应商费用预算、逐字段人工审核与版本回滚。沿用已实现 provider/schema 边界、来源证据与已审核字段保护，先以一个课次验收，再逐册扩展；未配置云端供应商时保持明确状态。之后增加拼写/听音/接格练习、实机验收，再按单独授权配置正式域名、生产数据和共享预览沙盒。
