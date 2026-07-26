# 紫域进球综合预测引擎方案

## 模型定位

本站采用“三维加权优先 + 五维辅助校验”的综合模型，不做单一泊松或单一指数判断。

第一优先级：

```text
三维预测 = 战意分析 + 赔率走势 + 状态历史
```

常规赛季权重：

```text
战意分析 40% + 赔率走势 35% + 状态历史 25%
```

赛季末段权重：

```text
战意分析 50% + 赔率走势 35% + 状态历史 15%
```

辅助校验层：

```text
五维辅助 = 基本面分析 + 数据指标模型 + 指数趋势模型 + AI/ML模型 + 传统统计模型
```

PoisGoal 公开披露的 `PoisStack v1.1` 核心是 `Poisson + xG + ELO + institutional blend`。我们在这个公开结构上扩展为更完整的五维模型，但不复制或破解它的私有源码、会员数据、接口或训练参数。

如果三维模型和五维辅助重叠，以三维模型为准；如果二者方向冲突，则采用“三维 72% + 五维 28%”的校验融合，但页面仍标记为三维优先。

## 三维规则

### 战意分析

- 5星战意：保级生死战、争冠/争四关键战、德比大战
- 4星战意：欧战资格争夺战、杯赛半决赛/决赛
- 3星战意：中游排名、普通积分需求
- 2星战意：已保级/已无望欧战的纯荣誉战

### 赔率走势

- 强烈信号：目标方向赔率持续下降 0.15+
- 警示信号：热门方向赔率持续上升 0.15+
- 平局信号：平局赔率较初赔下降 0.2+

### 智能避热

系统自动识别顶级热门场次，例如皇马、巴萨、曼城、PSG、拜仁、利物浦、阿森纳等。

热门场次处理：

- 自动下调 10-15% 信心值
- 信心上限 75%
- 强制输出风险提示
- 低赔热门不能单独作为稳胆依据

## 当前前端实现

当前 `src/main.js` 已接入三维优先演示版。每场比赛包含：

- 战意指数：主胜 / 平局 / 客胜方向战意
- 赔率走势：主胜 / 平局 / 客胜方向变化
- 状态历史：近期状态与历史倾向
- 基本面：近期状态、阵容、主客场、战意、节奏
- 数据指标：xG、射门优势、禁区进攻、控球、xG趋势
- 指数趋势：机构隐含概率、初赔/即时赔方向、市场分歧
- AI/ML：机器学习输出的主胜/平/客胜概率
- 传统统计：ELO + 泊松比分矩阵

五维辅助权重：

```text
基本面 20%
数据指标 25%
指数趋势 20%
AI/ML 20%
传统统计 15%
```

传统统计内部：

```text
传统统计 = 泊松比分矩阵 62% + ELO 38%
```

## 输出字段

每场比赛输出：

- 胜平负方向
- 比分倾向
- 大小 2.5 球
- 双方进球 BTTS
- 主胜 / 平局 / 客胜概率
- 大 2.5 概率
- 机构分歧
- 五维模块评分
- 综合信心指数

## 生产级数据源

后续接真实数据时，需要这些数据：

- 赛程：日期、联赛、球队、开赛时间
- 球队状态：近 5 / 10 场、主客场拆分
- xG 数据：进攻 xG、防守 xGA、xG 差值、xG luck
- 技术指标：射门、射正、控球、禁区触球、关键传球
- 指数数据：胜平负、亚洲指数、大小球、初赔、即时赔
- 阵容伤停：首发、停赛、伤病、轮换
- 外部强度：ELO、积分、赛程压力、战意

## 赛事抓取

### 欧洲顶级联赛：Football-Data.org

API 驱动抓取：

- 英超 `PL`
- 西甲 `PD`
- 德甲 `BL1`
- 意甲 `SA`
- 法甲 `FL1`
- 欧冠 `CL`
- 欧联 `EL`
- 葡超 `PPL`
- 荷甲 `DED`

本地令牌配置在：

```text
config/football-data.local.json
```

不要把令牌写进前端页面。前端只读取已生成的：

```text
data/fixtures.json
```

抓取脚本：

```text
node scripts/fetch-football-data.mjs
```

Football-Data.org v4 使用 `X-Auth-Token` 请求头。赛程接口可以使用：

```text
GET https://api.football-data.org/v4/competitions/{code}/matches?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
GET https://api.football-data.org/v4/matches?competitions=PL,PD,BL1&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
```

### 亚洲及其他联赛：WebSearch 补全

### 中国竞彩网：竞彩官方赛程

竞彩赛事现在单独接入 `scripts/fetch-sporttery.mjs`，并与 Football-Data.org 数据在 `/api/fixtures` 合并返回。

输出文件：

```text
data/jincai-fixtures.json
src/generated-jincai-fixtures.js
```

页面展示：

- 竞彩编号
- 联赛
- 对阵
- 开赛时间
- 胜平负 SP
- 让球胜平负 SP
- 机构隐含概率

注意：竞彩网接口可能因地区、网络或销售窗口返回空数据。生产环境需要保留 WebSearch/人工校验队列作为补全。

### 其他亚洲及小联赛：WebSearch 补全

这些联赛先进入人工/搜索校验队列：

- 日职联 J-League
- 韩职联 K-League
- 中超
- 亚冠
- 比甲
- 瑞典超
- 挪超
- 美职联

查询队列在：

```text
data/websearch-leagues.json
```

补全目标：

- 今日对阵
- 开赛时间
- 伤停信息
- 积分与战意
- 盘口/赔率变化
- 官方或主流数据源交叉确认

## 推荐接口结构

```text
GET /api/fixtures?date=YYYY-MM-DD
GET /api/predictions?date=YYYY-MM-DD&league=英超
GET /api/matches/:id
POST /api/admin/sync-fixtures
POST /api/admin/sync-odds
POST /api/admin/recalculate-predictions
```

## 数据表

```text
leagues
teams
fixtures
team_form_snapshots
xg_snapshots
odds_snapshots
lineup_snapshots
prediction_runs
prediction_results
```

## 下一步

1. 接入正规足球数据 API，先抓取每日赛程。
2. 增加赔率快照表，记录初赔和即时赔。
3. 用历史赛果回测五维权重。
4. 用 Brier Score / ECE 做概率校准。
5. 增加蒙特卡洛模拟，用于杯赛晋级和冠军概率。
