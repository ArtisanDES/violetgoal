# 上线实时更新说明

当前网页不能把 Football-Data.org 令牌直接放进浏览器里。上线后需要 Node 后端负责抓取数据，再把公开数据接口提供给前端。

本站已经支持两种方式：

## 推荐方式：Node 服务上线

启动：

```text
npm start
```

默认行为：

- 启动网站
- 立即同步一次 Football-Data.org
- 同步中国竞彩网公开竞彩赛程
- 每 10 分钟自动同步一次
- 提供 `/api/fixtures` 给前端读取
- 生成 `data/fixtures.json` 和 `src/generated-fixtures.js`
- 生成 `data/jincai-fixtures.json` 和 `src/generated-jincai-fixtures.js`
- 前端每 60 秒读取一次最新数据

必须配置环境变量：

```text
FOOTBALL_DATA_TOKEN=你的 Football-Data.org 令牌
ADMIN_SYNC_TOKEN=后台手动同步密钥
SYNC_INTERVAL_MINUTES=10
PORT=8080
```

可选日期范围：

```text
DATE_FROM=2026-07-24
DATE_TO=2026-07-31
```

可配置：

```text
PORT=8080
SYNC_INTERVAL_MINUTES=10
```

## 手动同步接口

上线后可以用管理密钥触发同步：

```text
POST /api/sync
Authorization: Bearer <ADMIN_SYNC_TOKEN>
```

查看同步状态：

```text
GET /api/sync-status
GET /health
```

## 不推荐：静态站 + 定时任务

如果部署到纯静态平台，需要另外配置定时任务运行：

```text
node scripts/fetch-football-data.mjs
```

然后把生成的这些文件一起发布：

```text
data/fixtures.json
src/generated-fixtures.js
```

## 为什么刷新不一定变化

刷新页面只会重新读取当前服务器上的数据包。如果后台没有重新抓取，数据包内容没有变化，页面也不会变化。

真正实时链路是：

```text
Football-Data.org API
中国竞彩网公开竞彩赛程
→ Node 后端定时抓取
→ 写入 fixtures 数据
→ 前端每分钟读取 /api/fixtures
→ 页面自动更新
```

## 注意

Football-Data.org 当前日期范围如果返回 0 场，页面会显示“已同步但暂无场次”，并保留演示预测卡片。欧联 `EL` 如果继续返回 403，说明当前令牌没有该赛事权限。
