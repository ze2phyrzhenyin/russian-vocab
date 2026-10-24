# 俄语拾词 / Slovo

面向中文母语学习者的手机优先俄语背词网页应用，由 Codex 实现。当前工作簿完整导入：6 册、69 课、4,835 源条目、4,838 归课关联、108 原图。50 条代表注解用于验证详情功能，生成候选和缺项均明确标记，人工核验数为 0。

支持真实账号、跨册选课、双向选择与翻卡、错词再练、FSRS 复习、个人集合、手动批量录入、真实本地 OCR、原图追溯、下载课次、离线 outbox 和管理员修订。验证状态以 [STATUS.md](STATUS.md) 为准，完整注解与正式发布见 [PLANS.md](PLANS.md)。

## 安装与启动

需要 Node.js 24、pnpm 11.24.0、Python 3.11+（带 venv/pip，或已有 uv），Compose 路径另需 Docker。教材文件由有权使用者自行提供，不随 Git 发布。

```sh
cd /Users/zephyrsui/Developer/russian-vocab
dev-run pnpm install --frozen-lockfile
# 将用户提供的工作簿放到 data/source/，或设置 VOCAB_SOURCE_PATH。
dev-run pnpm run setup --compose-db
dev-run pnpm dev
```

访问 <http://localhost:4186>。`pnpm setup` 是 pnpm 自身命令，项目初始化必须写 **`pnpm run setup`**。setup 仅在不存在 `.env` 时生成独立 demo 配置；不会覆盖已有配置或清空数据库。已有 PostgreSQL 时填写独立数据库 `.env` 后运行 `pnpm run setup`；Mac 当前使用 `ruslearn_dev`，不必另启 Compose 数据库。

`dev-run` 是本机/公司服务器限速入口，普通机器没有它时执行后面的命令。`pnpm env:check` 打印状态，不打印密钥。迁移、导入、依赖和模型在初始化/更新时准备，普通启动不重新下载。

## Compose 与服务器演示

先完成 `setup --compose-db`，再运行：

```sh
dev-run docker compose -p slovo-demo build app
docker compose -p slovo-demo up -d --no-build app
```

应用仅绑定 `127.0.0.1:4186`，数据库仅绑定 `127.0.0.1:55486`。Compose 是隔离演示配置；没有公开域名或共享访客沙盒。不要在同一端口同时运行 dev 和 Compose app。

rex-cli 路径为 `/home/adminlinux/Developer/russian-vocab`。该主机使用项目专属限额 builder：

```sh
dev-run docker buildx build --builder slovo-builder --output=type=docker,dest=.local/slovo-demo-image.tar -t slovo-demo-app:local .
dev-run docker load -i .local/slovo-demo-image.tar
docker compose -p slovo-demo up -d --no-build app
```

服务器配置源站为 `http://localhost:4187`；本机建立 SSH 转发后访问该地址。局域网可用 `rex-cli-lan`：

```sh
ssh -N -L 4187:127.0.0.1:4186 rex-cli
```

## 账号与体验

| 账号 | 密码 | 用途 |
| --- | --- | --- |
| demo@ruslearn.test | RusDemo!2026 | 演示进度、错词与个人集合 |
| new@ruslearn.test | RusDemo!2026 | 全新用户 |
| admin@ruslearn.test | 随机生成，见 `.local/demo-access.md` | 内容维护 |

一键体验走真实认证。各环境管理员凭据独立，不写入 Git 或公开页面。[docs/DEMO.md](docs/DEMO.md) 提供五分钟测试步骤。

## 验证与维护

```sh
dev-run pnpm verify             # lint、类型、领域/数据库、导入/内容、覆盖、build
dev-run pnpm verify:import      # 重导入，核对数据、修订和 demo 进度不变
dev-run pnpm start              # 手动启动已构建服务
dev-run pnpm test:e2e           # 自动启动/复用本地构建服务；A → B → C → 兼容性
dev-run pnpm content:report
dev-run pnpm import:vocab -- --file data/source/东方俄语词汇汇总_第1至6册.xlsx
```

数据库集成测试只允许本机 `ruslearn_dev`，创建 UUID 夹具并只删除该轮夹具。完整验收需要私有工作簿；公开 CI 仅运行代码、合成导入夹具和独立数据库测试，不代替内容/OCR/浏览器实测。证据保存在被 Git 忽略的 `artifacts/`。

明确重置某个固定演示账号时运行 `pnpm demo:reset -- --email demo@ruslearn.test --confirm demo@ruslearn.test`，再用 `pnpm seed:demo` 恢复演示样例；不会重置教材或整库。

## 使用边界与接续

- 首次登录注册、未下载内容、管理和首次 OCR 模型加载需要联网。离线前先下载所选课次。
- OCR 使用项目内俄语/中文模型，不接受 PDF。识别内容须编辑确认才入库，不支持的图片格式转 PNG/JPEG。
- 发音检测系统俄语语音，没有时明确提示。云 AI 未启用，核心学习不依赖 API key。
- 手机 Safari/Chrome 实机尚需验收；尺寸仿真不等同实机。PWA/离线需要 HTTPS 或 localhost 安全上下文。
- 工作簿、提取内容、照片、截图与密钥保持私有。第 3 册来自 17 页摘录，不宣称六册原书无遗漏。

接续读取 [AGENTS.md](AGENTS.md)、[STATUS.md](STATUS.md)、[PLANS.md](PLANS.md)。规范在 `docs/`，任务在 `tasks/`，短提示词在 `prompts/`。本机和服务器演示采用不同 Cookie 名称，可在同一浏览器分别登录。
