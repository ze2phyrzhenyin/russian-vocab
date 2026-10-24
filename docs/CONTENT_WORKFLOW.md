# 全库候选、逐字段审核与版本恢复

这套工作流将可重现的本地字典候选、管理员判断和历史恢复分开保存。自动生成器不能产生 `reviewed` 或 `rejected`；只有服务端重新确认身份的管理员实际提交审核动作才会写入这些状态。全库 32 字段都有结构，不代表每个字段已有可靠答案，更不代表全库已人工审核。

## 文件与数据

- `scripts/build_annotations.py` 生成 `annotations.json` 与 `annotations.manifest.json`。生成器、字典、字段状态及未知项说明见 `RUSSIAN_CONTENT.md`。
- `src/domain/content.ts` 是管理端 DTO、32 字段和词性筛选契约。
- `src/server/content-workflow.ts` 负责来源校验、持久任务、逐字段审核及回滚。
- `scripts/content_jobs.ts` 是真实任务 CLI；旧 `scripts/import_annotations.ts` 已改为该工作流的入口，不再直接更新注解。
- `ContentJob` 保存发起人、范围、候选集与生成器版本、进度、费用上限和处理租约。`ContentJobItem` 保存每项候选快照、指纹、教学基线版本、状态、尝试次数与失败信息。`AnnotationRevision` 保存每个变化字段的前后值、操作者、原因、动作、教学版本、任务及回滚目标。

候选目录通过 `SLOVO_ANNOTATIONS_ROOT` 指定，默认 `data/processed`。生产可只读挂载，私有数据不进入应用镜像。内容文件上限 256 MB，清单上限 12 MB。进程只保留最近一个通过校验的数据集缓存；清单或内容文件变化会重新读取。每个任务保存其创建时的候选快照，重试不会悄悄换成较新的生成器输出。

清单版本为 2，每个来源项目必须有 `sourceRowFingerprint`、`inputFingerprint`、`outputFingerprint`。服务端校验候选输出指纹，并在应用时重新校验数据库原行指纹。对象键递归排序，数组顺序不变，Unicode 不转义。词典候选分数保存为十进制字符串，避免 Python 与 JavaScript 对浮点数的 JSON 表示差异；分数不参与答题判定。

## 持久批量任务

创建任务可选册次、字段，或显式教材 item IDs。默认包含六册所有有效教材项目。个人词库不能混入此工作流。重复的 `requestKey` 只返回原任务；同一个标识改变范围、版本或费用上限会被拒绝。

每次 `run-batch` 同步处理 1–50 项，默认 25 项。返回响应前，该批已处理项目的事务已经提交；不存在 HTTP 响应之后继续运行的悬空 Promise 队列。管理端可以连续请求批次，关闭页面或暂停请求不会丢掉任务。

任务租约为 60 秒，每个项目提交后续期。相同任务不能被两个工作者同时处理；进程退出后，只能在租约到期后接续。每个项目在同一事务中完成字段合并、教学版本递增、批量审计写入、项目状态及进度计数。候选没有变化时记为 `skipped`，不生成多余版本。

已审核或已驳回字段永远受保护。未保护字段需要与任务创建时的教学版本一致；遇到并发修改会保留为失败项。管理员检查后显式重试，才会更新失败项的基线版本。即使重试，受保护字段仍不被覆盖。原行指纹变化的旧任务不能靠重试强行应用，必须重新生成候选并创建新任务。

取消在当前项目事务结束后生效，保留已完成项目、未处理快照和失败记录。CLI 的 `retry` 可以显式恢复取消任务的未完成项目。`completed-with-errors` 表示剩余项目均已尝试，但有失败项；不是完全成功。

本地字典任务实际外部调用成本为 0，保存 `costLimitCents` 和 `costSpentCents=0`。负数或越界费用上限被拒绝。云端 provider 尚未配置：创建云端任务直接拒绝，不创建假进度、不调用外部模型，也不会把本地结果伪装成云端结果。现有 enrichment 接口是后续适配边界，不是已经接通的云服务。

## 逐字段审核

管理员打开字段时可查看当前值、状态、来源、方法、版本、原始来源行和字段历史。审核通过必须同时满足：

1. 请求带当前 `baseVersion` 和稳定 `requestKey`。
2. 明确确认已经核查字段与来源。
3. 值不是 null、空白、空数组或空对象。
4. 存在可核查的来源文字，并填写至少三个字符的理由。

`unknown` 或 `not-applicable` 的空值不能仅勾选确认便变成已审核事实。来源文字与审核理由不会自动证明事实正确，审阅者仍需核对依据。服务端保存实际账号、时间、修改前后内容和请求摘要。相同请求重试返回原审计；改变内容后复用标识会返回冲突。

驳回保持原候选值、来源及方法，状态变为 `rejected`，理由进入审计。这样既能看到拒绝了什么，也能防止下次生成把同一字段自动覆盖回来。

教学版本是项目级乐观锁。两个管理员同时修改不同字段，也必须刷新后再提交第二个动作，不能用过期整个注解对象覆盖已经完成的更改。项目 advisory lock 与条件更新共同保护服务内及不共享锁的写入者。`entryType` 的有效审核同步显示分类；其它注解审核不会自动改写教材俄文、中文释义或选择题答案。教材释义维护仍走原有独立修订入口。

## 回滚语义

“恢复到此版本”采用所选 `AnnotationRevision.after`，不是删除这条历史，也不是将当前版本号减一。恢复写入新的 `rollback` 审计，记录当前值、目标值、操作者、原因、目标审计 ID，并递增教学版本。回滚也要求当前 `baseVersion`，拒绝陈旧页面覆盖并发修改。

恢复到生成版本后该字段重新处于候选状态；恢复到过去已审核版本则保留那个版本的值及状态。历史审核依据仍留在原审计中，新恢复动作也有实际操作者。当前提供逐字段恢复，不提供一键撤销整库任务；取消任务也不会自动撤销已经提交的项目。

工作流不修改 `SourceEntry.raw`、`SourceVersion`、历史 `ReviewEvent` 或 FSRS 状态。注解变化会递增教学版本；旧内容版本的待同步答题仍按已有冲突机制保留，不能静默改写学习事实。

## 筛选与覆盖率

管理端可按册、完整课次 ID（例如 `1-2`）、词性、字段状态及文本筛选，支持分页。词性筛选保留多候选，不把最高分当成唯一词性；另有短语、句子、歧义和未知类别。

覆盖报告分别给出全库、册、课、词性及字段统计。适用字段分母为全部 32 字段减去明确 `not-applicable`；`unknown`、`missing`、`disputed`、`rejected` 均不算已审核。来源或生成字段也不算人工审核。多课归属和多个词性候选可能进入多个分组，分组数量不能直接相加替代全库去重总数。

字段详情默认返回最近 100 条审计；传 `field` 时返回该字段最近 100 条。数据库保留全部历史，不截断存储。当前管理界面不提供无限历史翻页。

## CLI

较重操作使用 `dev-run`；必须指定真实现有管理员，不能通过 CLI 自动提升普通账号权限。

```sh
# 创建全库任务并处理到结束；本地生成不会产生调用费用
dev-run pnpm exec tsx scripts/content_jobs.ts import --actor-email ADMIN_EMAIL --budget-cents 0 --batch-size 25

# 只创建指定范围任务
dev-run pnpm exec tsx scripts/content_jobs.ts create --actor-email ADMIN_EMAIL --books 1,2 --fields lemma,declension --request-key UUID

# 查看、继续、取消、重试
dev-run pnpm exec tsx scripts/content_jobs.ts show JOB_ID --actor-email ADMIN_EMAIL
dev-run pnpm exec tsx scripts/content_jobs.ts run JOB_ID --actor-email ADMIN_EMAIL
dev-run pnpm exec tsx scripts/content_jobs.ts cancel JOB_ID --actor-email ADMIN_EMAIL
dev-run pnpm exec tsx scripts/content_jobs.ts retry JOB_ID --actor-email ADMIN_EMAIL --run
```

`SLOVO_CONTENT_ACTOR_EMAIL` 可供运维配置使用。兼容入口 `pnpm content:import` 默认使用已存在的环境管理员；不存在或角色不符时拒绝运行。CLI 逐批输出真实进度；最终仍有失败项时退出码为 1。运行新任务时应保留其 ID，后续继续使用同一任务，不需要重复创建。

正式环境使用独立的 `slovo` 数据库、`APP_ENV=production`、`DEMO_MODE=false`，与本地隔离验收库无关。使用 `DOTENV_CONFIG_PATH=.env.production` 选择私有环境配置，先完成源表导入及受限管理员初始化，再运行持久任务：

```sh
DOTENV_CONFIG_PATH=.env.production dev-run pnpm content:import --actor-email admin@slovo.zhaoyang.fr
DOTENV_CONFIG_PATH=.env.production dev-run pnpm content:jobs show JOB_ID --actor-email admin@slovo.zhaoyang.fr
```

这里的邮箱只用于定位现有管理员，不是口令；脚本拒绝接管或提升普通账号。配置、凭据位置、只读资料挂载和正式入口的操作边界见 [DEPLOYMENT.md](DEPLOYMENT.md)。生产数据库禁止用于上述自动测试。

## API 与验证

业务路由前缀为 `/api/admin/content`，所有服务函数内部还会重新查询管理员角色。变更沿用会话、Origin、JSON 大小和 `X-Slovo-User` 边界。

| 操作 | 路由 |
| --- | --- |
| 覆盖率 / 列表 / 详情 | `GET coverage`、`GET items`、`GET items/:id?field=lemma` |
| 任务列表 / 创建 / 详情 | `GET jobs`、`POST jobs`、`GET jobs/:id` |
| 处理 / 取消 / 重试 | `POST jobs/:id/run-batch`、`cancel`、`retry` |
| 审核 | `POST items/:id/fields/:key/review` |
| 恢复历史值 | `POST revisions/:id/rollback` |

`tests/content-workflow.test.ts` 使用真实隔离 PostgreSQL 和本次测试专用来源行，覆盖权限、持久批次、并发租约、取消恢复、失败重试、候选指纹、已审核／已驳回保护、严格审核输入、请求去重、历史恢复及源行不变。它还制造实际数据库行锁竞态：外部写入者在审核读取基线后更新版本，审核与回滚都必须返回冲突且不产生审计或覆盖。

测试会自行建立缺少的 book/lesson 父记录，并只清理本次 UUID 夹具及本次创建且仍为空的父记录，不依赖私有工作簿或演示账号。运行边界只允许本机 `ruslearn_dev`。全库实际任务及浏览器验收结果记录在根 `STATUS.md` 和私有 artifacts 中，不能把仅通过夹具测试表述为全库审核完成。

2026-10-24 本地实际完整任务 `27066cf3-3e55-4035-8086-ab78462c96cf` 已处理 4,835 / 4,835 项，失败 0、外部调用成本 0；数据集指纹为 `90c23282bc06ec36cc25b6c732a783eae92a28ad2c6b2001b4b1a7339ad1b229`。日志在私有 `artifacts/content/full-corpus-job.log`。本模块 10 项真实数据库测试已通过，包含外部写入者竞态。正式环境任务和管理端浏览器验收另由部署/验收记录证明。
