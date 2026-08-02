# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

实时多人 Bingo 应用。Classic 5×5 与 Hex (Connect-6) 两种棋盘模式。前端 React 19 + Vite 8（Rolldown 打包，TypeScript 6.0），后端基于 PartyServer (Cloudflare Durable Objects) 实现 WebSocket 多人同步。

**已启用 React Compiler**：组件内无需手动 `useMemo`/`useCallback`，编译器自动 memoize。

**无测试框架** — 项目目前不包含任何测试文件（无 vitest/jest）。

## 常用命令

```bash
npm run dev              # 前端 dev server (Vite)
npm run dev:server       # 独立 WebSocket dev server（不需要 workerd，开发时用这个代替 dev:party）
npm run dev:party        # PartyServer dev server（wrangler dev，需要 workerd）
npm run build            # 生产构建 (tsc -b + vite build)
npm run buildgh          # GitHub Pages 构建（base: /bingo-kit/）
npm run typecheck        # TypeScript 类型检查 (tsc -b)
npm run lint             # ESLint
npm run format           # Prettier 格式化 (src/** + party/**)
npm run preview          # 预览生产构建
npm run deploy           # 部署前端到 GitHub Pages（自动先 buildgh）
npm run deploy:party     # 部署 PartyServer 服务端（wrangler deploy）
npm run deploy:images    # 部署图片 Worker（wrangler deploy --config image-worker/wrangler.json）
```

开发时同时运行 `npm run dev` 和 `npm run dev:server`（或 `dev:party`）。`dev:server` 默认监听 `ws://localhost:1999`；前端通过 `VITE_PARTY_HOST` 连接（默认 localhost:1999）。图片 API 由 `VITE_IMAGE_URL` 指定（生产指向 `image-worker`）；未设置时复用 `VITE_PARTY_HOST`（开发走 dev-server 的图片接口）。

## 架构

### 关键约定

- **TypeScript project references**：根 `tsconfig.json` 引用 `tsconfig.app.json` / `tsconfig.node.json` / `party/tsconfig.json`。`party/tsconfig.json` 启用 `noUnusedLocals: true`——改服务端代码后如有未使用的变量，`tsc -b` 会失败。
- **传输无关的游戏逻辑**：`party/game-room.ts` 的 `GameRoom` 通过 `GameTransport` 接口（`send` / `broadcast` / `onRoomEmpty`）与运行时解耦。适配器：`party/server.ts`（PartyServer 生产，wrangler.jsonc 配置 DO）和 `party/dev-server.ts`（本地 ws 服务器 + 图片 HTTP API，存 `.dev-images/`，协议同 `image-worker`）。
- **服务端权威状态**：Board config 由第一个进房玩家提供并广播；Marks 以服务端回传的 `SET_CELL_MARKS` 为准（客户端乐观更新）；Rename 冲突时服务端发 `rename_rejected`，客户端回滚；全部玩家 ready → 服务端倒计时 3 秒 → `"start"` → playing；playing 中可发 `restart` 重置回 lobby（可携带新 config）。
- **两种标记模式**：Classic 非 lockout 可多人共标一格；Classic lockout / Hex 先到先得、锁死。
- **Hex 特殊性**：队伍制（红/蓝，`assignTeamColor()`）；棋盘尺寸 `sizeBlue` × `sizeRed`（2–9）；Union-Find + BFS 连通对边判定；强制 lockout；标记用 `"red"`/`"blue"` 而非玩家颜色值。
- **状态管理**：`useReducer` + Props drilling（无外部状态库）。消息流：`PartySocket message` → `usePartyConnection.onMessage` → `useGameState.handleServerMessage` → `dispatch` → `gameReducer`。
- **前端路由**（条件渲染，非 SPA）：无 `roomConfig` → `LandingPage`；有 → 按 `gameMode` 显示 `BingoRoom`/`HexRoom`；`?test=randompick` / `?test=expression` 为调试页。`LandingPage` 保持挂载（`display: none`）以保留编辑状态。

核心文件速查：`src/types/index.ts`（消息/状态类型）、`src/hooks/useGameState.ts` + `usePartyConnection.ts`（状态与连接）、`party/game-room.ts`（全部游戏逻辑）、`src/scoring/expressionParser.ts`（规则表达式解析器）。

### 核心流程

**Config 压缩**：goals 数组可能很大，join 前用 LZ-String 压缩为 base64（`usePartyConnection` 调 `compressJson`）；服务端把 config 当 opaque string 存转；客户端收到 `state` 后 `decompressJson()` 还原。

**分享链接**：URL query 参数 `?room=<房间名>&server=<服务器>&share=1`（`RoomHeader` 复制链接时拼接），**不携带 config**——服务端持有权威 config，访客加入后推回。带 `share=1` 的访问者只读进入（`LandingPage` 的 `isSharedLink` 置灰全部配置项），join 只发最小 config（`{ goals: [] }`），跳过 goal 校验。

**configHash**：创建房间时客户端计算并随 config 发送，服务端存储。用途是**授权 restart**：仅 owner 且 hash 匹配的连接能执行 `restart`（`game-room.ts`），客户端 `canRestart`（本地 hash === 服务端 hash）据此显示"重开"按钮。

**Goal 图片**：Goal 可携带图片（tooltip 显示，Lightbox 全屏查看）。上传：`GoalEditor` → `fileToImageAttachment()`（SHA-256 + base64）→ `ImageUploadQueue`（并发上限 2）→ `PUT /images/:hash`，哈希即存储键。**WebSocket 传输前必须 `stripImageData()` 剥掉 `data`**（`compressJson` 也会调用），否则 config 内嵌 base64 过大；渲染用 `getImageSrc()`（有 `data` 用 data URL，否则指向图片 API）。生产用 `image-worker/`（R2 bucket `bingo-kit-image`）；SHA-256 需要 secure context（localhost 或 HTTPS），否则 `sha256Hex` 抛错。

**计分系统**（`src/scoring/`）：规则引擎，`ScoringRule` 含若干 `ScoringItem`（针对 cell 或 bingo line）；`bingoDetector.ts` 检测完成线并按时间戳排序；`scoreCalculator.ts` 构建 per-player `ScoringContext` 求值；`useScoring.ts` 每次渲染重算（React Compiler 自动 memoize）；默认规则每格 1 分，Hex 始终用默认规则。规则表达式（自包含解析器）支持 ternary/逻辑/比较/算术/成员访问及高阶函数（`all`/`any`），可用 `?test=expression` 调试。

**洗牌算法**（`src/randomPicks/`）：`pickGoals(pool, rule)` 分发 4 种算法 — `pureRandom` / `balancedDifficulty`（最小化行难度方差）/ `pattern`（按模板同分布）/ `fixed`（顺序取前 N），均遵守 exclusion group 约束。

**多任务池**：`GoalPoolManager` 管理多个任务池（创建/切换/删除），集成在 `LandingPage`。
