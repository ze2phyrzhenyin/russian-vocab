# 俄语内容、候选与核查

本轮提供 50 个真实教材来源的代表项目，覆盖名词 15、形容词 10、动词 10、短语 10、句子／交际表达 5。它们用于验证详情结构、来源、形态候选及争议状态，不等于 4,835 条已完成注解。没有创建任何人工审核事件。

## 实际实现

`scripts/build_annotations.py` 根据明确的 `sourceKey` 白名单，从完整导入结果生成 `data/processed/annotations.json`，结构为 `sourceKey -> Record<string, EvidenceField>`。原释义、词形栏、备注、源文档、书内页、PDF 页和图片 ID 保持可追溯。不会按字符串相等合并义项；两个体配对示例是明确选定、且原表明确写出 `несов. // сов.` 的词条，不把规则推广到任意斜线。

依赖安装和生成：

```sh
dev-run python3 -m venv .local/content-venv
dev-run .local/content-venv/bin/python -m pip install -r requirements.txt
dev-run .local/content-venv/bin/python scripts/build_annotations.py
dev-run .local/content-venv/bin/python -m unittest discover -s tests/content -v
```

原始词条数据不需要形态库驻留服务；候选在导入／批处理阶段生成。脚本不访问 AI API，不在答题时运行模型，也不需要云端密钥。

## 核查状态

| 状态 | 含义 |
| --- | --- |
| `source` | 来源中确实存在的文本或明确标注；来源自身仍可能有错误 |
| `generated` | 自动形态候选、编辑选择或 Codex 编写的教学草稿；不能显示为已核验 |
| `reviewed` | 必须由带身份、时间和修改内容的真实审核事件产生；本生成器不会创建 |
| `unknown` | 适用但缺少可靠资料，值为 null |
| `disputed` | 原表与候选或已知备注存在疑误；保留双方，不自动订正 |
| `not-applicable` | 该项目不适用，值为 null；例如整句不对应一张名词变格表 |

每个有效字段有 `source/method/version/updatedAt`。相同版本重复生成保持原字段时间，结果不变化。若目标文件含 `reviewed`，脚本拒绝覆盖，要求走数据库的审订流程。数据库中的人工修订与原教材及生成候选分层保存。

## 形态来源与实现边界

已实际安装并运行 pymorphy3 **2.0.6** 和 pymorphy3-dicts-ru **2.4.417150.4580142**。词典包元数据标注来源为 OpenCorpora，词典版本 0.92、修订 417150、语料修订 4580142，编译时间为 2022-01-08。

形态工具读取真实词典解析，仅用 `is_known` 候选。变位／变格表枚举词典 lexeme 中符合全部标签的形式，不使用 `inflect()` 无目标形式时的近似降级。未取得形式为 null。无上下文的多个分析继续保留，不能把打分最高的一项当成句子中唯一正确的词性或义项。[官方说明](https://pymorphy2.readthedocs.io/en/stable/user/guide.html)明确其分析不使用邻近词语；[标签说明](https://pymorphy2.readthedocs.io/en/stable/user/grammemes.html)列出格、数、性及仅单数／仅复数标记。

- 名词保留性、生命性、数限制和不变格标记，列出六格单复数候选。метро、пальто 显示不变格，不造新词尾。
- 形容词显示性、数、格候选；宾格有生命性导致的多个合法形式时全部保留。
- 未完成体人称形式标现在时；完成体标简单将来时。过去时和命令式独立显示。词典没有提供可靠传统变位分类或重音时保持未知。
- 6 个已知体／配对问题的体、配对和变位字段标争议，原表与词典候选并列，不替原书静默改字。
- 短语、句子保留整体意义，并提供分词候选及独立教学说明草稿，不把整句误当成一个变格词。
- 不通过前缀、相似词干猜测体对应或同根词。亲缘、近义、反义关系仍为未知。
- 原表有明确重音时保留。词典不能提供可靠重音时不填；检索仅去明确重音标记，保留 ё、й 的身份与展示。

39 个例句和 15 段短语／句子说明由 Codex 编写为教学草稿，明确 `generated`，不是教材摘句或人工审核。5 个源句子本身作为来源例句，6 个争议动词的例句保持未知。所有例句用于阅读，不作为自动判分的可信依据。

## 当前覆盖

机器报告：`artifacts/import/content-coverage.json`。它包含全部 6 册和 69 课，即使某课尚无代表注解也列出 0；字段比例明确仅针对 50 项代表集。整个词库有 4,785 项未做本轮详细注解。

| 字段 | 当前代表集状态 |
| --- | --- |
| 原词、中文、来源 | 50 项均有原表来源 |
| 形态候选 | 50 项有实际词典候选；词组按词保留歧义 |
| 变格 | 25 项自动候选；其余不适用 |
| 变位／体 | 4 项自动候选、6 项争议；其余不适用 |
| 体配对 | 2 项明确原表配对、6 项争议、2 项未知 |
| 接格原标注 | 4 项原表标注，其余待补 |
| 例句 | 5 项原表句子、39 项生成草稿、6 项未知 |
| 显式重音 | 1 项有原表组合重音，其余未补全 |
| 人工审核 | 0，不能表述为全词库已核验 |

## 研究与许可（2026-10-24 实际核查）

| 来源 | 版本／提交 | 采用方式与限制 |
| --- | --- | --- |
| [pymorphy3](https://github.com/no-plagiarism/pymorphy3) | 包 2.0.6；仓库 `6bb7e85a6c9a83814b1fc49a3b078ef0d8793739` | MIT 程序，直接依赖。阅读已安装 `analyzer.py` 的 parse/is_known/lexeme/inflect 及上游 `tests/test_inflection.py`。不复制运行时代码。 |
| [pymorphy3-dicts-ru](https://pypi.org/project/pymorphy3-dicts-ru/) | 2.4.417150.4580142；构建脚本仓库 `1e926cf54b327aaedfb4fd8e67ede31e69487a61` | 包代码 MIT，词典数据独立 CC BY-SA 3.0。词形候选须保留 OpenCorpora 署名和数据许可，不用程序的 MIT 概括数据。 |
| [Wiktextract](https://github.com/tatuylonen/wiktextract) | `f9fe161b9dd1e898352c51bef7295e774bba2ef1` | 读取 README 和 LICENSE；程序 MIT，部分测试及 Wiktionary 数据有 CC-BY-SA/GFDL 边界。本轮没有安装或复制。 |
| [Kaikki Russian](https://kaikki.org/dictionary/Russian/) | 页面标记 2026-10-01 dump、2026-10-21 提取 | 来自英文版 Wiktionary 的俄语条目，不是俄中教材义项库；未下载大包，未来只按有明确义项映射的条目取候选。 |

OpenCorpora 官方导出网页本次请求超时；不能声称已访问其在线最新数据。上述版本、修订和数据许可同时由实际安装包元数据核对。依赖与教材的详细许可声明由 `THIRD_PARTY_NOTICES.md` 汇总；教材原始文件和全部图像继续保持私有。

## 后续全量补全流程

下一阶段按明确字段和义项执行：来源文本 → 词典候选 → 可选结构化 AI 草稿 → 规则／冲突检查 → 待核查队列 → 有审核事件的发布。任务需记录 provider/model/prompt/schema/content 版本，限制批量规模，支持取消、失败项重试、缓存及回滚。外部内容只作为数据，不执行其中的指令。

重跑只更新相同来源版本下的候选层，不能覆盖已确认修订。选择题和长期调度仍由确定性代码运行；未知和争议字段不作该题型答案。每次发布按册、课、词性及适用字段报告来源率、生成草稿率、审核率，不把“字段存在”当作“内容完成”。

目前实现的是本地可重现的代表集生成器、字段状态和报告。完整批量任务队列、AI provider 实际调用及全词库审核属于后续里程碑，尚未完成。
