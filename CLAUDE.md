# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

实时多人 Bingo 应用。支持 Classic 5×5 棋盘和 Hex (Connect-6) 棋盘两种模式。前端 React 19 + Vite 8，后端基于 PartyKit (Cloudflare Workers) 实现 WebSocket 多人同步。

**已启用 React Compiler**（通过 `babel-plugin-react-compiler` + `@rolldown/plugin-babel`）。因此组件内无需手动 `useMemo`/`useCallback`——编译器会自动 memoize。

**Vite 8 使用 Rolldown**（而非 Rollup）作为底层打包器。项目使用 TypeScript 6.0。

**无测试框架** — 项目目前不包含任何测试文件（无 vitest/jest）。

## 常用命令

```bash
npm run dev              # 前端 dev server (Vite)
npm run dev:server       # 独立 WebSocket dev server（不需要 workerd，开发时用这个代替 dev:party）
npm run dev:party        # PartyKit dev server（需要 workerd）
npm run build            # 生产构建 (tsc -b + vite build)
npm run buildgh          # GitHub Pages 构建（base: /bingo-kit/）
npm run typecheck        # TypeScript 类型检查 (tsc -b)
npm run lint             # ESLint
npm run format           # Prettier 格式化 (src/** + party/**)
npm run preview          # 预览生产构建
npm run deploy           # 部署前端到 GitHub Pages（自动先 buildgh）
npm run deploy:party     # 部署 PartyKit 服务端
```

开发时通常需要同时运行 `npm run dev` 和 `npm run dev:server`（或 `dev:party`）。

- `npm run dev:server` 默认监听 `ws://localhost:1999`
- `npm run dev:party` 使用 PartyKit 自带的 workerd 运行时
- 前端通过 `VITE_PARTYKIT_HOST` 环境变量或默认 `localhost:1999` 连接 WebSocket

## 架构

### TypeScript 配置

使用 TypeScript project references：根 `tsconfig.json` 引用三个子项目 — `tsconfig.app.json`（前端）、`tsconfig.node.json`（Vite 配置）、`party/tsconfig.json`（服务端）。`party/tsconfig.json` 额外启用 `noUnusedLocals: true`，修改服务端代码后如有未使用的变量会导致 `tsc -b` 失败。

### 目录结构

```
src/                    # 前端 React 应用
  types/index.ts        # 核心类型定义（GoalItem, GameState, ServerMessage, ClientMessage 等）
  App.tsx               # 根组件，路由 LandingPage → BingoRoom / HexRoom
  components/           # UI 组件
    LandingPage.tsx     # 首页 — 模式选择、任务池管理、房间配置
    GoalEditor.tsx      # Goal 可视化编辑器（JSON/CSV 导入导出）
    GoalPoolManager.tsx # 多任务池管理（创建/切换/删除任务池）
    BingoRoom.tsx       # Classic 5×5 棋盘房间
    BingoBoard.tsx      # Classic 棋盘渲染
    BingoSquare.tsx     # 单个格子组件
    HexRoom.tsx         # Hex 棋盘房间
    HexBoard.tsx        # Hex 棋盘渲染（六边形网格）
    ReadyPanel.tsx      # 大厅等待/准备面板
    PlayerList.tsx      # 玩家列表
    ChatPanel.tsx       # 聊天面板
    RoomSidebar.tsx     # 房间侧边栏布局
    RoomHeader.tsx      # 房间头部（名称、退出按钮）
    ScoringRuleEditor.tsx # 计分规则编辑器
    ScoringRuleCard.tsx   # 计分规则卡片展示
    ScoringRulePicker.tsx # 计分规则选择器
    ExpressionTester.tsx  # 计分表达式调试工具（?test=expression）
    RandomPickTest.tsx    # 洗牌算法测试页（?test=randompick）
    TooltipPopover.tsx    # 通用 tooltip 弹出组件
  hooks/
    useGameState.ts     # 核心状态管理 — useReducer + PartyKit 消息处理
    usePartyConnection.ts # PartySocket 连接管理 hook + usePlayerCallbacks（乐观更新封装）
    useDarkMode.ts      # 深色模式
    useLongPress.ts     # 长按手势（移动端）
    useCounters.ts      # Goal 计数器状态管理
  randomPicks/          # Goal 洗牌算法
    index.ts            # 导出 4 种算法 + pickGoals() 分发函数
    algorithms/         # pureRandom, balancedDifficulty, pattern, fixed
    types.ts            # 算法公共类型（PickRule, PatternResult 等）
    utils.ts            # 算法公共工具函数
  hex/                  # Hex 模式专有逻辑
    hexTypes.ts         # HexConfig 类型
    hexUtils.ts         # 六边形坐标、邻居计算、Union-Find 胜利检测
  i18n/                 # 国际化（中/英）
    translations.ts     # 语言注册
    languages/          # en.ts, zh-CN.ts
    context.ts / I18nProvider.tsx / useT.ts  # React Context 方式提供
  scoring/              # 计分系统
    types.ts            # ScoringRule, ScoringContext, DetectedBingo 等类型
    expressionParser.ts # 自包含表达式解析器/求值器（tokenizer + parser + evaluator）
    bingoDetector.ts    # Bingo 线检测
    scoreCalculator.ts  # 核心计分引擎
    useScoring.ts       # React hook
    defaultRule.ts      # 默认规则（每格 1 分）
  utils/
    compressMessage.ts  # LZ-String 压缩/解压（用于 WebSocket 传输 board config）
    colors.ts           # 玩家颜色、Hex 队伍颜色常量
    measureText.ts / fitHexText.ts  # Canvas 文本测量（Hex 格缩放文字）

party/                  # 服务端
  server.ts             # PartyKit Server 适配器 — 薄封装
  dev-server.ts         # 独立 WebSocket 开发服务器（ws 库）
  game-room.ts          # ** 核心 ** — 传输无关的 GameRoom 类，所有游戏逻辑
```

### 核心架构决策

**传输无关的游戏逻辑**：`party/game-room.ts` 中的 `GameRoom` 类通过 `GameTransport` 接口与具体 WebSocket 运行时解耦：
- `party/server.ts` — PartyKit 适配器（生产环境，部署到 Cloudflare）
- `party/dev-server.ts` — 独立 ws 服务器（本地开发）

两个适配器都只是实现 `send(connId, msg)` / `broadcast(msg, excludeIds)` / `onRoomEmpty()` 三个方法。

**服务端权威状态**：
- Board config — 第一个进入房间的玩家提供的 config 被采纳并广播给后续加入者
- Marks — 服务端是唯一真理源，客户端乐观更新后以服务端回传的 `SET_CELL_MARKS` 为准
- Rename — 服务端验证唯一性，冲突时发送 `rename_rejected`，客户端回滚乐观更新
- Phase 转换 — 所有玩家 ready → 服务端倒计时 3 秒 → `"start"` 消息 → 进入 playing
- 重开（restart）— 在 playing 阶段发送 `restart` 消息可重置游戏回到 lobby，可选携带新 config

**两种标记模式**：
- **Classic (非 lockout)**：每个格子可以有多个玩家的标记，不同颜色可同时标记同一格
- **Classic (lockout)** / **Hex**：每个格子只能被一个人/队伍标记（先到先得），锁死后他人不能再标

**Hex 模式特殊性**：
- 使用队伍制（红/蓝），颜色分配逻辑不同（`assignTeamColor()`）
- 棋盘尺寸可变（`sizeBlue` × `sizeRed`，范围 2–9）
- 胜利判定使用 Union-Find + BFS，检测是否连通对边
- 强制 lockout 模式
- 标记使用队伍标识（`"red"` / `"blue"` 字符串），而非玩家颜色值

**Config 压缩**：Board config（goals 数组）可能很大，通过 LZ-String 压缩为 base64 后在 WebSocket 消息中传输。完整流程：
1. 客户端 `usePartyConnection` 在发送 `join` 消息前调用 `compressJson(config)` → base64 字符串
2. 服务端 `GameRoom` 将 config 作为 opaque string 存储和转发（不解析）
3. 客户端 `useGameState.handleServerMessage` 收到 `state` 消息后调用 `decompressJson()` 还原

**分享链接**：通过 URL hash 传递压缩后的 config，访问者以只读模式进入（配置项置灰，不可编辑）。由 `configHash` 校验 config 完整性。

**计分系统**（`src/scoring/`）：
- 基于规则引擎的计分：`ScoringRule` 包含一组 `ScoringItem`，每条规则可针对 cell 或 bingo line
- `bingoDetector.ts` — 从 marks 中检测所有完成的 Bingo 线，按时间戳排序
- `scoreCalculator.ts` — 构建 per-player 的 `ScoringContext`（cell/player/bingo/global 引用），对每条规则项求值
- `useScoring.ts` — React hook，每次渲染重新计算分数（React Compiler 自动 memoize）
- 默认规则（`defaultRule.ts`）：每格 1 分。Hex 模式始终使用默认规则
- 规则通过 `BoardConfig.scoringRule` 可选传入，UI 通过 `ScoringRuleEditor` / `ScoringRulePicker` 编辑和选择

**表达式语言**（`src/scoring/expressionParser.ts`）：
- 自包含的表达式解析器/求值器，用于计分规则的 `condition` 和 `points` 字段
- 语法：ternary (`? :`)、逻辑 (`|| &&`)、比较 (`== != < > <= >=`)、算术 (`+ - * / %`)、一元 (`! -`)、成员访问 (`.prop`)、索引 (`[expr]`)、方法调用 (`.all()`, `.any()`, `.indexOf()`)
- 内置函数：`min`, `max`, `abs`, `floor`, `ceil`, `round`, `if`
- 高阶函数：`all(array, |x| pred)`, `any(array, |x| pred)` 及对应的数组方法形式
- 可调试：`?test=expression` 路由打开 `ExpressionTester` 组件

### 状态管理

前端使用 `useReducer` + Props drilling（无外部状态库）：
- `useGameState` — 核心 hook，管理 `GameState` 的 reducer，处理所有服务端消息的转换
- `usePartyConnection` — 管理 PartySocket 连接生命周期，发送/接收消息；同时导出 `usePlayerCallbacks`（changeColor / changeName / sendChat 的乐观更新封装）
- `useCounters` — 管理 Goal 的自定义计数器状态

服务端消息流：`PartySocket message event` → `usePartyConnection.onMessage` → `useGameState.handleServerMessage` → `dispatch(GameAction)` → `gameReducer`

### 洗牌算法

4 种算法位于 `src/randomPicks/`，通过 `pickGoals(pool, rule)` 分发，从 Goal 池中选取 25 个（或 Hex 所需的 N 个）填充棋盘：
1. `pureRandom` — 纯随机
2. `balancedDifficulty` — 最小化每行难度方差
3. `pattern` — 每条线（行/列/对角线）按用户指定的难度模板严格同分布（same distribution）
4. `fixed` — 按顺序取前 N 个

所有算法都遵守 exclusion group 约束。

### 前端路由

非 SPA 路由 — 使用条件渲染：
- 无 `roomConfig` → 显示 `LandingPage`
- 有 `roomConfig` → 根据 `gameMode` 显示 `BingoRoom` 或 `HexRoom`
- `?test=randompick` → 显示 `RandomPickTest`（洗牌算法测试页）
- `?test=expression` → 显示 `ExpressionTester`（计分表达式调试工具）
- `LandingPage` 保持挂载（`display: none`），切换房间时不丢失编辑状态

### 多任务池（Goal Pools）

通过 `GoalPoolManager` 组件管理多个任务池，每个池有独立的 goals 列表和相关配置。支持创建、切换、删除任务池。此功能通过 `GoalPoolManager.tsx` 实现，集成在 `LandingPage` 中。
