# 第三方程序与数据说明

核查日期：2026-10-24。本项目为私有教材学习工程。程序依赖的开源许可不授予教材扫描件、词表、商业产品页面或用户图片的公开发布权。

## 直接程序依赖

安装包提供的许可证原文已复制到 `docs/licenses/`，文件清单和精确版本见 `docs/licenses/manifest.json`。包管理器保留的各传递依赖 LICENSE/NOTICE 也应随相应分发保留，不以此摘要替代原文。

| 软件 | 版本 | 许可 |
| --- | --- | --- |
| Next.js | 16.4.3 | MIT |
| React / React DOM | 19.3.1 | MIT |
| Prisma / Prisma client / pg adapter | 7.10.1 | Apache-2.0 |
| Better Auth | 1.7.12 | MIT |
| Dexie | 4.4.7 | Apache-2.0 |
| pg | 8.23.1 | MIT |
| ts-fsrs | 5.4.2 | MIT; © Open Spaced Repetition |
| Tesseract.js | 7.0.0 | Apache-2.0 |
| Sharp | 0.34.5 | Apache-2.0; native dependencies retain their own notices |
| Motion | 14.6.0 | MIT |
| Lucide React | 1.61.0 | ISC |
| Zod | 4.6.7 | MIT |
| dotenv | 17.2.3 | BSD-2-Clause |
| Tailwind / PostCSS integration | 4.3.3 | MIT |
| TypeScript | 6.0.3 | Apache-2.0 |
| Playwright | 1.64.1 | Apache-2.0; browser distributions have separate bundled notices |
| axe Playwright integration | 4.14.0 | MPL-2.0 |
| Vitest | 5.0.5 | MIT |
| ESLint / typescript-eslint / hooks plugin | 10.13.0 / 8.72.0 / 7.1.1 | MIT |
| Next ESLint plugin | 16.4.3 | MIT, Next.js project license; installed plugin does not include a separate top-level LICENSE |
| fake-indexeddb | 6.2.6 | Apache-2.0 |
| tsx and TypeScript type packages | 精确版本见 manifest | MIT |

Python 内容工具使用 pymorphy3 2.0.6（MIT）、dawg2-python 0.9.0（MIT）和 Pillow 12.1.1（HPND）；依赖版本记录在 Python requirements 中。没有复制其内部实现。pymorphy3 代码许可与以下字典数据许可不能混为一谈。

## 字典、OCR 和教材资料

- `pymorphy3-dicts-ru` 2.4.417150.4580142：包代码为 MIT；来自 OpenCorpora 的字典数据为 CC BY-SA 3.0。来源为 [项目发布页](https://pypi.org/project/pymorphy3-dicts-ru/) 与包内元数据，OpenCorpora 0.92、revision 417150、corpus 4580142，编译于 2022-01-08。由其导出的词形保留该来源和版本、候选状态及相应署名/许可；修改后的派生数据不得被重新标记成无来源自有数据。没有人工核验事件时，不标“人工核验”。
- OCR 使用 Tesseract.js / tesseract.js-core 与固定 [naptha/tessdata revision](https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc) 的 rus、chi_sim 模型，按原项目许可和 NOTICE 保留来源；确切文件哈希和尺寸见 `artifacts/ocr/assets.json`。不把所有图片或第三方音频视为同一许可。
- 用户提供的《东方俄语》第 1–6 册汇总工作簿、嵌入扫描图与提取数据仅留在当前私有项目，路径已在 `.gitignore` 中排除。未据此授予公共仓库或公共网站再发布权。完整导入工作簿不代表原书六册已证明无遗漏。
- 自制 OCR 验证样图与项目编写的中文解释不冒充教材原文；机器分析与生成说明各自标明方法和状态。
- 系统 TTS 由用户设备提供；没有下载或再分发第三方录音。是否可用取决于设备语音，不能宣称全库离线真人发音。

## 只研究、未引入的项目

Anki 主体为 AGPL-3.0-or-later（部分组件另有许可）；仅参考条目/卡片、相关卡和复习流程。Nibomo 与 Lute 为 MIT，Wiktextract 程序为 MIT（部分测试和 Wiktionary 数据独立许可），PaddleOCR 为 Apache-2.0；本轮未复制或运行这些应用源码。

Kaikki 的俄语页来自英文 Wiktionary，不是俄中教材释义数据库。本轮没有导入它的全量 dump；后续采用需按具体 Wiktionary 版本及文件逐项保留许可和来源。Mochi 与 Quizlet 是产品体验研究对象，不假定其商业程序或视觉素材可以复用。

第三方版本、核查 commit 和采用理由见 `docs/RESEARCH.md`。后续增加数据源、音频、字体或复制源码前，先更新本文件及可追溯来源记录。
