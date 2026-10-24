# 俄语内容、候选与核查

当前输入的 **4,835 条源条目均已生成 32 个字段的可追溯状态**，覆盖 6 册、69 课。这个数字表示每项经过来源与词典候选处理，不表示所有知识已补齐，也不表示内容已人工审核。生成器没有创建任何审核事件。此前 50 个代表项目及其中 39 个例句草稿、15 段说明继续保留，不把它们复制到其余词条冒充全量例句。

## 实际流程与文件契约

```sh
dev-run .local/content-venv/bin/python scripts/build_annotations.py
dev-run .local/content-venv/bin/python -m unittest discover -s tests/content -v
```

依赖为项目隔离虚拟环境中的 `requirements.txt`。生成器不调用 AI API，不向第三方发送教材，不需要云端密钥，不直接更新数据库。`data/processed/annotations.json` 仍是 `sourceKey -> Record<string, EvidenceField>`，供持久内容任务消费。源行、原文、源图片及学习项目身份不拆分、不合并。

32 个字段为：`entryType/headword/meaning/stress/sourceMorphology/partOfSpeech/morphologyCandidates/declension/conjugation/aspect/aspectPairs/government/phraseUsage/sentenceAnalysis/examples/relatedWords/usageNotes/provenance/lemma/pronunciation/register/gender/animacy/number/conjugationType/reflexive/transitivity/collocations/commonErrors/rootRelations/synonyms/antonyms`。

每项均包含这些字段。适用但没有可靠资料的字段为 `unknown`；确实不适用的字段为 `not-applicable`。不会用占位例句、规则猜重音或前缀猜体对应来增加完成率。35 个缺失中文释义的源行，其 `meaning.value` 为 null，`status` 为 unknown，原工作簿占位文字仍保留在不可变源行。

| 状态 | 含义 |
| --- | --- |
| `source` | 原资料确有该文本或明确标注；不保证原资料正确 |
| `generated` | 真实词典候选、结构分类或明确标注的既有教学草稿；未经人工审核 |
| `reviewed` | 只能由独立审订流程中的真实审核事件产生，生成器不会创建 |
| `unknown` | 适用但无可靠资料，值为 null |
| `disputed` | 已知原表问题，或来源/词典候选存在需要核查的差异；不自动订正 |
| `not-applicable` | 该项目不适用，值为 null，例如整句的单一变格表 |

字段保留 `source/method/version/updatedAt`。unknown 与 not-applicable 也有方法说明与版本。若输出目标中任何位置存在 reviewed（包括不再被选中的源行或字段），生成器在写入前拒绝替换。数据库中人工审订、驳回、历史快照和回滚由独立持久流程管理；不能靠再次运行本脚本覆盖。

## 词性、词形和来源边界

实际采用 pymorphy3 **2.0.6**、pymorphy3-dicts-ru **2.4.417150.4580142**，OpenCorpora 版本 0.92、词典修订 417150、语料修订 4580142。只接受 `is_known` 的词典候选。词典无法匹配的词保持 unknown，不把预测器造出的形式当成收录事实。

- 保留多个词性和词元候选，不使用最高分强行消歧。当前 403 项保留类别歧义，37 项尚不能确定类别。候选展示最多 6 个解析，并标明完整候选数与是否截断；词性分类不按这个展示上限截断。
- 原表明确词性优先保留来源。原表“用作名词”的形容词允许继续使用真实形容词变格候选，不误判为来源错误。另有 3 项原表语境副词与词典孤立词形标签不一致，明确待核查；这种不一致不等于教材错误。
- 变格/变位枚举词典 lexeme 中符合全部目标标签的形式，不使用 `inflect()` 的近似回退。名词、形容词、代词、长尾形动词分别处理；数词使用按格列出的 `cases`，不假造单复数。未找到的格/人称形式为 null。
- 完成体人称形式标简单将来时，未完成体标现在时。传统变位类型和可靠发音未取得时保持 unknown。不变格、仅单数、仅复数标记来自词典。
- 原表对单个词明确的人称限制会抑制相应候选。3 个并列条目的人称限制未明确指向哪个成员，变位字段保留 disputed，不能按斜线顺序猜适用范围。
- 6 个已知体争议继续标在体/配对/变位字段。其他 5 个已知原表问题保留词头或义项争议。例句和接格候选不用于自动判分的可信依据。
- `//` 只保留同一源条目中的并列成员。133 个体对应字段有原表标注或原已选择的来源配对，其中新增的条目仅保留原文、体标注和义项范围，不凭斜线顺序或前缀宣称一个新关系。
- 接格、语体及词组整组收录有明确原表依据才记 source；词组“整组收录”不等于固定性已经审核。同根、近义、反义关系继续 unknown，不以拼写相似补齐。
- 重音只保留原表显式组合重音。检索只去明确重音标记，保留 ё、й。词典 `score` 是展示用数值字符串，保留实际数值且不用于决定唯一词性、正确答案或学习进度。

[词典官方说明](https://pymorphy2.readthedocs.io/en/stable/user/guide.html)解释其不使用相邻词语消歧；[标签说明](https://pymorphy2.readthedocs.io/en/stable/user/grammemes.html)描述格、数、性与限制标签。

## 逐项缓存与持久任务快照

`data/processed/annotations.manifest.json` 为 schemaVersion 2：根记录 generatorVersion、generatorCodeSha256、dictionary、sourceWorkbookSha256、fingerprintAlgorithm；`entries[sourceKey]` 包含 sourceRowFingerprint、inputFingerprint、outputFingerprint、category、partsOfSpeech、evidenceWorkbookSha256。

- `sourceRowFingerprint` 对完整原 SourceRow 计算，持久任务必须对当前 `SourceEntry.raw` 重算并比对，拒绝陈旧源行快照。
- `inputFingerprint` 包含源行摘要、对应 issue、生成器版本与三份实现文件摘要、词典版本。源行或实现改变只重算需要更新的候选；输出内容被改动也会因 outputFingerprint 不匹配而拒绝缓存。
- `outputFingerprint` 对整项 EvidenceField 对象（包括 updatedAt）计算。规范是递归对象键排序、数组原顺序、无空白、UTF-8/不转义非 ASCII 的 JSON，再做 SHA-256。候选数据不含浮点 JSON 数字，字典 score 使用字符串，避免 Python 1.0 与 JavaScript 1 的序列化差异。
- 文件整体 SHA 改变但某源行未变时，该项可以继续引用此前有效来源版本；evidenceWorkbookSha256 明确记录实际引用版本，根 sourceWorkbookSha256 记录当前输入版本，不伪造新版本来源。
- category 为互斥类别；partsOfSpeech 为候选英文类别列表，含 noun/adjective/verb/adverb/pronoun/numeral/preposition/conjunction/particle/interjection/participle/gerund/predicative/phrase/sentence/unknown。多词性项目 category 为 ambiguous。

实际全 4,835 项 Node/Python sourceRowFingerprint 与 outputFingerprint 比对均为 0 差异。重复生成 4,835 项全部命中缓存，annotations 与 manifest 字节完全一致；证据见 `artifacts/import/full-corpus-cache-verification.json`。

## 当前字段覆盖（生成层）

`artifacts/import/content-coverage.json` 按全部 6 册、69 课、互斥类别及多候选词性报告字段状态。比例的分母是适用项，明确排除 not-applicable；多候选词性分组有重叠，不把其总和当作项目总数。`scripts/content_report.ts` 另外报告数据库已发布投影，并把尚未导入的字段记为 not-generated，不能用本地生成文件冒充数据库已更新。

| 字段 | 实际状态 |
| --- | --- |
| 32 字段状态 | 4,835 项均具备；不是 100% 知识或审核完成 |
| 中文义项 | 4,796 来源、4 争议、35 未知 |
| 词性 | 481 来源、4,314 候选、3 待核查差异、37 未知 |
| 形态候选 | 4,795 真实词典候选项目、40 未知 |
| 变格 | 3,181 候选、43 未知、1,611 不适用 |
| 变位 | 1,058 候选、9 争议、43 未知、3,725 不适用 |
| 体对应 | 133 原表陈述/已有来源配对、6 争议、971 未知、3,725 不适用 |
| 原表接格 / 语体 | 104 / 88 来源字段 |
| 例句 | 18 条源表达、39 个保留的生成草稿、4,778 未知 |
| 显式重音 | 857 来源、3,978 未知 |
| 发音、同根、近义、反义 | 仍未知，未伪造材料 |
| 本地生成产生的审核事件 | 0 |

类别分布为名词 2,101、动词 1,022、形容词 790、歧义 403、词组 218、副词 130、其余类别 171。生成器与来源测试现有 19 项通过，覆盖词性歧义、名词化、数词变格、限制适用范围、未知词、源行与缓存修改、旧审核数据保护、原代表集及全库状态。

## 研究与许可（2026-10-24 实际核查）

| 来源 | 版本／提交 | 采用方式与限制 |
| --- | --- | --- |
| [pymorphy3](https://github.com/no-plagiarism/pymorphy3) | 包 2.0.6；仓库 `6bb7e85a6c9a83814b1fc49a3b078ef0d8793739` | MIT 程序，直接依赖。阅读已安装 `analyzer.py` 的 parse/is_known/lexeme/inflect 及上游 `tests/test_inflection.py`。不复制运行时代码。 |
| [pymorphy3-dicts-ru](https://pypi.org/project/pymorphy3-dicts-ru/) | 2.4.417150.4580142；构建脚本仓库 `1e926cf54b327aaedfb4fd8e67ede31e69487a61` | 包代码 MIT，词典数据独立 CC BY-SA 3.0。词形候选须保留 OpenCorpora 署名和数据许可，不用程序的 MIT 概括数据。 |
| [Wiktextract](https://github.com/tatuylonen/wiktextract) | `f9fe161b9dd1e898352c51bef7295e774bba2ef1` | 读取 README 和 LICENSE；程序 MIT，部分测试及 Wiktionary 数据有 CC-BY-SA/GFDL 边界。本轮没有安装或复制。 |
| [Kaikki Russian](https://kaikki.org/dictionary/Russian/) | 页面标记 2026-10-01 dump、2026-10-21 提取 | 来自英文版 Wiktionary 的俄语条目，不是俄中教材义项库；未下载大包，未来只按有明确义项映射的条目取候选。 |

OpenCorpora 官方导出网页本次请求超时；不能声称已访问其在线最新数据。上述版本、修订和数据许可同时由实际安装包元数据核对。依赖与教材的详细许可声明由 `THIRD_PARTY_NOTICES.md` 汇总；教材原始文件和全部图像继续保持私有。

## 后续资料与审核

这轮已将本地来源与词典候选处理扩展到全部源行。仍缺少的例句、词根/近反义关系、可靠发音、传统变位分类和语境用法，需要新的可靠资料或明确标注的草稿，再由有身份、时间和修改内容的审订流程确认。外部资料只作为数据，不执行其中指令。

持久任务、重试/取消、审核/驳回和版本回滚与生成器分开；实现与验收状态以 STATUS.md 和相关内容任务文档为准。云 AI provider 未配置时保持真实状态，核心学习继续可用；本生成器不依赖 AI 调用。
