# 研究与采用记录

核查日期：2026-10-24（Europe/Paris；机器记录为 2026-10-23 UTC）。只做足够支持本轮选择的有边界研究。仓库 HEAD 与许可证下载记录在 `artifacts/research/repositories.json`、`artifacts/research/sources/`；运行依赖使用锁定版本，不把 HEAD 当成安装版本。

## 产品流程参考

| 资源 | 实际核查 | 采用的设计判断 | 不采用 / 成本 |
| --- | --- | --- | --- |
| [Anki 基础](https://docs.ankiweb.net/manual/getting-started)、[学习与 sibling](https://docs.ankiweb.net/manual/studying) | 官方页面已读；源码 HEAD `1b48429de2d188e64fce46c9635620e3767a6879`；主体 AGPL-3.0-or-later，另有组件许可 | 学习条目与方向卡分离；错误用 Again，Hard 表示困难回忆；避免相关卡紧邻 | 仅流程参考，不复制或依赖 Anki 程序；不引入其整套桌面数据模型 |
| [Mochi](https://mochi.cards/) | 官方页面显示版本 26.9.2；页面强调本地使用、卡片关联和清晰阅读层次 | 明确一张卡片的阅读顺序；内容与复习衔接；本地保存后同步 | 商业产品只作体验参考；未取得源码复用授权，不复制视觉资产或采用其收费同步 |
| [Quizlet Learn](https://quizlet.com/features/learn) | 官方 URL 返回 403；未绕过访问限制 | 选集后进入学习的概念来自用户要求，本轮不据无法访问页面宣称具体流程已研究 | 未访问到的拍照编辑/题型细节不作为证据；不依赖其账户或 API |

## 开源候选与取舍

| 候选 / 核查版本 | 许可证和证据 | 本轮采用 / 延后 | 依赖与维护成本 |
| --- | --- | --- | --- |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs/tree/v5.4.2) 5.4.2，tag commit `bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d`；仓库 HEAD `afef743be42ea3c76a4755bb1303c3180df4efb6` | MIT；实际读取 models、fsrs 和 FSRS-6 / prevent-skipping 测试 | 直接依赖，用独立适配层；权重/参数/版本固定，关闭 fuzz | 发布版 Node >=20；当前主分支 v6 文档有不同 API / Node >=24 要求，不能混用；本轮不安装优化器/WASM |
| [Nibomo](https://github.com/kirill-markin/flashcards-open-source-app/tree/5a58a1388363a1a8ad6a6737fbf086e7dc9b9f6d) `5a58a1388363a1a8ad6a6737fbf086e7dc9b9f6d` | MIT；已读该 commit 的 [architecture.md](https://github.com/kirill-markin/flashcards-open-source-app/blob/5a58a1388363a1a8ad6a6737fbf086e7dc9b9f6d/docs/architecture.md) 与 LICENSE | 参考本地 outbox 与认证后同步；不复制源码 | 其 AWS/Cognito/Lambda、多客户端同步和多主机结构超出单机演示需求；直接移植会增加部署、认证和运维耦合 |
| [Lute](https://github.com/LuteOrg/lute-v3/tree/933d0840aede93b3999e6017ba7f5eba5e41206d) `933d0840aede93b3999e6017ba7f5eba5e41206d` | MIT；README 与 LICENSE 已读 | 阅读中追溯词条是后续体验参考；不引入程序依赖 | Python/Flask 阅读产品与本轮教材背词不同，增加第二服务无必要 |
| [pymorphy3](https://github.com/no-plagiarism/pymorphy3/tree/6bb7e85a6c9a83814b1fc49a3b078ef0d8793739) 2.0.6；HEAD `6bb7e85a6c9a83814b1fc49a3b078ef0d8793739` | MIT；安装包 analyzer 的 parse/is_known/lexeme 与上游 inflection 测试已读 | 隔离 Python 环境，批量产生形态候选 | 不能保证重音、中文释义、体配对、接格或同根关系；不启动常驻微服务 |
| [pymorphy3-dicts-ru](https://pypi.org/project/pymorphy3-dicts-ru/) 2.4.417150.4580142 | 包代码 MIT；字典数据 CC BY-SA 3.0；OpenCorpora 0.92 / revision 417150 / corpus 4580142，编译时间 2022-01-08；已核对安装元数据 | 为形态候选提供可标识数据来源，保留许可与版本 | 数据较旧且有词形歧义；不等于中文义项库。OpenCorpora 在线站点请求超时，未把超时写成在线核实 |
| [Wiktextract](https://github.com/tatuylonen/wiktextract/tree/f9fe161b9dd1e898352c51bef7295e774bba2ef1) `f9fe161b9dd1e898352c51bef7295e774bba2ef1` | 程序 MIT；部分测试/词典材料另属 Wiktionary CC BY-SA/GFDL；README 和 LICENSE 已读 | 延后；没有运行或复制抽取程序 | 大型 dump、模板/Lua 处理、义项对齐和数据许可分别维护；首版不需要全量抓取 |
| [Kaikki Russian](https://kaikki.org/dictionary/Russian/)、[raw data](https://kaikki.org/dictionary/rawdata.html) | 页面记录 2026-10-01 enwiktionary dump，2026-10-21 抽取；数据遵守 Wiktionary 来源许可 | 未来词头/词形/关系证据候选；本轮未下载 dump | 俄语页面来自英文 Wiktionary，不是俄中教材释义；raw 英文版包含大量语言，需流式选取与义项核查；不覆盖教材中文 |
| [Tesseract.js](https://github.com/naptha/tesseract.js/tree/a1ca80d9e31c34512d0ded75ff8821ddcf3f2f91) 7.0.0；HEAD `a1ca80d9e31c34512d0ded75ff8821ddcf3f2f91` | Apache-2.0；实际 API 文档、安装包 worker 入口与本地模型准备脚本 | 直接依赖，浏览器 worker，俄语+简体中文真实模型 | 模型和 WASM 较大，必须按需加载、限制图像、取消 worker；复杂双栏不保证自动排对；不直接处理 PDF |
| [Tesseract 模型矩阵](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html)；naptha/tessdata commit `806cd9adc8c6e8abc11c782db1818c990576bebc` | 实际核查 rus / chi_sim 支持；准备脚本下载固定 revision 并保存哈希 | 自托管模型而非首次使用隐式 CDN | 保留语言数据来源；模型版本、文件尺寸与哈希见 `artifacts/ocr/assets.json` |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/tree/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf) `dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf` | Apache-2.0；README 和 LICENSE 已读 | 延后，为复杂版式 provider 候选 | Python/模型运行栈比浏览器 OCR 更重；新增后台推理须先有版式失败证据与资源额度 |

所有源码参考与真正依赖分开记录。本轮没有从 Anki、Mochi、Quizlet、Nibomo、Lute、PaddleOCR 或 Wiktextract 拷贝应用实现。直接依赖的许可文件在 `docs/licenses/`；源数据独立许可见根目录 `THIRD_PARTY_NOTICES.md`。

## 已选技术兼容性

| 层 | 精确选择 | 核查与理由 |
| --- | --- | --- |
| 运行时 | Node 24、pnpm 11.24.0 | 与当前 Next/Prisma 兼容；服务器已有 Node 24.21.0，项目限制 >=24 <25 |
| Web | Next 16.4.3、React/React DOM 19.3.1、TypeScript 6.0.3 | [Next 安装](https://nextjs.org/docs/app/getting-started/installation)、[PWA 指南](https://nextjs.org/docs/app/guides/progressive-web-apps) 与安装包 engines/peers 已核查 |
| 数据库 | PostgreSQL、Prisma/client/adapter-pg 7.10.1、pg 8.23.1 | [Prisma 7 要求](https://www.prisma.io/docs/orm/v7/reference/system-requirements)；选择稳定 7.10.1，不采用 registry 上的 8 RC |
| 认证 | Better Auth 1.7.12 | [安装](https://better-auth.com/docs/installation)、[Next 集成](https://better-auth.com/docs/integrations/next)；成熟密码/会话机制，Prisma adapter |
| 客户端 | Dexie 4.4.7、Motion 14.6.0、Tailwind 4.3.3、Lucide 1.61.0 | [Dexie 事务](https://dexie.org/docs/Dexie/Dexie.transaction/) 支持本地原子提交；不用付费云同步；少量自有语义组件而非引入 shadcn 生成器，见 ADR |
| 验证 | Vitest 5.0.5、Playwright 1.64.1、axe 4.14.0、ESLint 10.13.0 / typescript-eslint 8.72.0 | 实际包 peer/version 核查；ESLint 10 与 TypeScript 6 使用独立 Next/hooks 插件配置，未为了旧配置包回退到已结束维护的 ESLint 9 |

依赖安装版本与精确传递依赖以 `pnpm-lock.yaml` 为准。读取官方说明与 package metadata 是兼容性选择证据；构建、运行及真实浏览器测试另见 `STATUS.md`，不把研究当成验证通过。
