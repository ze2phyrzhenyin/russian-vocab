# Slovo 公网部署

用户于 2026-10-24 授权提交 GitHub、部署，并指定 zhaoyang.fr 域名及正常体验账号。

- 正式入口：https://slovo.zhaoyang.fr
- 私有仓库：https://github.com/ze2phyrzhenyin/russian-vocab
- 应用/数据库：rex-cli，项目 `/home/adminlinux/Developer/russian-vocab`
- HTTPS 入口：rex-ovh Nginx；只新增独立主机，不接管 zhaoyang.fr 其他路径。
- 链路：Nginx → OVH `127.0.0.1:58092` → 独立 `slovo-ingress.service` → rex-cli `127.0.0.1:4188`。
- 专用隧道密钥仅允许转发 58092，无交互会话；原有隧道与服务不重启。

## 正式环境与数据

`compose.production.yaml` 为 `slovo-production` 项目。数据库 `slovo` 使用专属 volume，回环 55488；演示的 `slovo_demo`/55486 与它独立。正式环境使用 `APP_ENV=production`、`DEMO_MODE=false` 和 HTTPS origin，不创建固定演示账号。账号、学习进度及内容审核写入 PostgreSQL；原始教材图片、完整候选文件只读挂载，不放进应用镜像或 GitHub。

服务器使用项目专属只读 GitHub deploy key，私钥仅在 `~/.ssh/slovo_github_ed25519`，仓库级 `core.sshCommand` 指定此身份，不复用个人账户 token。

`.env.production`、`.local/production-admin-access.md` 和 `.local/production-test-access.md` 为权限 600 的私有文件。体验账号通过公网注册接口建立；管理员由受限初始化脚本建立。脚本不会接管或提升已存在的普通账号，不重置已有管理员。

应用上限 1.5 GiB/2 CPU，数据库 1 GiB/1 CPU。生产容器 `restart: unless-stopped`；数据库健康检查和应用 `/api/health` 必须成功。BuildKit 的实际容器限额为 3 GiB/2 CPU，重命令经 `dev-run`。

## 更新顺序

先在本机通过 `pnpm verify` 与真实浏览器验收，再同步代码和私有候选文件。生产不运行测试夹具或 demo seed。

```sh
# 在 rex-cli 项目目录，先将已验证的新代码和候选文件同步到这里
export PATH=/home/adminlinux/.nvm/versions/node/v24.21.0/bin:$PATH
DOTENV_CONFIG_PATH=.env.production dev-run pnpm db:generate
DOTENV_CONFIG_PATH=.env.production dev-run pnpm db:migrate
DOTENV_CONFIG_PATH=.env.production dev-run pnpm content:import --actor-email admin@slovo.zhaoyang.fr
# 发布使用实际已验证提交号作为 tag；构建不会把 .env/教材打包
# dev-run docker buildx build --builder slovo-builder --output=type=docker,dest=.local/slovo-image.tar -t slovo-production:COMMIT .
# dev-run docker load -i .local/slovo-image.tar
# 将 .env.production 的 SLOVO_IMAGE 更新为该已验证 tag
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build --wait app
```

内容作业持久保存候选快照、来源指纹、版本和逐字段变更。失败重试与取消不会删除已完成结果；已确认/已驳回字段不被自动生成覆盖。初次初始化先导入教材并运行 `DOTENV_CONFIG_PATH=.env.production pnpm bootstrap:production`，再执行注解任务。服务中断时可根据任务 ID 继续，不重新初始化数据库。

`pnpm backup:production` 生成 `.local/backups/*.dump`，不删除历史备份或覆盖数据。这里只提供本项目备份命令，不声称已配置持续异地备份。任何恢复必须针对明确目标数据库，不能把生产卷用于测试。

## DNS 与证书

DNS 使用 server-ops 已审查计划，仅增加 `slovo.zhaoyang.fr A 51.210.42.88`，TTL 300；原有 16 条记录保留。计划、前快照及执行 journal 在两个项目的私有 artifacts 目录。证书为独立 `slovo.zhaoyang.fr` lineage，首次有效至 2027-01-21，HTTP-01 webroot `/var/www/slovo-acme`。`deploy/slovo-cert-renewal.sh` 只在这个 lineage 更新时校验并平滑 reload Nginx。

部署源码：`deploy/slovo-https.conf`、`deploy/slovo-ingress.service`。隧道私钥不在仓库；server-ops 密钥和其他应用配置不会分发到这个仓库。

## 验收界限

公网验证使用真实 HTTPS、真实账户和正式数据库。浏览器移动视口、Chromium/WebKit 的离线测试不会称为实机测试。2026-10-24 用户明确当前没有可连接的手机，iOS/Android 实机验收仍需设备。

GitHub 代码已推送；Actions 首次任务在启动前被账户计费/额度限制阻止，没有执行步骤。该限制不代表本机或服务器测试通过与否，也不通过修改用户计费设置规避；实际工程验收以保存的本地/远端回执为准。
