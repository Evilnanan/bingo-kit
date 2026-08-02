# 消息协议

本文档描述通过 **PartyServer**（Cloudflare Durable Objects）操控棋盘所需的**消息格式和数据结构**。

## 1. 基本约定

### 连接

客户端通过 PartySocket 连接到 PartyServer 服务器：

```
ws://{serverUrl}/parties/bingo-server/{roomName}
```

`bingo-server` 是 Durable Object 绑定 `BingoServer` 的 kebab-case 名称。每个房间（`roomName`）对应一个独立的 Durable Object 实例，拥有独立的状态。

### 消息结构

每条消息是一个 JSON 对象，含一个 `type` 字段区分类别，其余字段为载荷。

## 2. 客户端 → 服务端消息

### `join` — 加入房间

新连接建立后，客户端应立即发送此消息告知身份。第一个提供 `config` 的玩家将设定棋盘配置。

```
type: "join"
name: string               // 玩家名称
config?: BoardConfig | HexConfig  // 棋盘配置（首个玩家提供）
mode?: "classic" | "hex"   // 游戏模式
lockout?: boolean           // 是否独占格子（classic 模式）
```

### `mark` — 标记

```
type: "mark"
index: number    // 格子索引
by: string       // 玩家颜色值（如 "#2563eb"）或 hex 模式下为 "red" / "blue"
```

### `unmark` — 取消标记

```
type: "unmark"
index: number
by: string
```

### `rename` — 改名

```
type: "rename"
oldName: string
newName: string
```

### `change_color` — 换色

```
type: "change_color"
name: string
color: string   // CSS 颜色值
```

### `chat` — 聊天

```
type: "chat"
name: string
color: string
text: string
```

### `ready` — 切换准备状态

仅在 `lobby` 阶段有效。

```
type: "ready"
name: string     // 玩家名称
ready: boolean   // true = 已准备，false = 未准备
```

## 3. 服务端 → 客户端消息

### `state` — 完整状态同步

在新玩家加入或阶段变更时发送。客户端应以此消息为准。

```
type: "state"
config: BoardConfig | HexConfig | null
marks: { [index: string]: MarkEntry[] }
players: { [name: string]: Player }
phase: "lobby" | "countdown" | "playing"
countdownSeconds: number | null
mode: "classic" | "hex"
lockout: boolean
```

### `player_joined` — 新玩家加入

```
type: "player_joined"
name: string
color: string
```

### `player_left` — 玩家离开

```
type: "player_left"
name: string
```

### 转发的游戏消息

服务端处理并广播以下消息：

- `rename`、`change_color`、`chat`、`ready` → **原样转发（不含发送者）**。发送者通过乐观更新获得即时反馈
- `mark`、`unmark` → **服务端构建**：验证通过后，服务端构建新消息并附加该格子的完整 `marks` 数组（`MarkEntry[]`）作为权威数据，确保所有客户端看到一致的标记顺序

### `rename_rejected` — 改名被拒绝

当改名因目标名字已被占用而被服务端拒绝时，**仅发送给改名者**：

```
type: "rename_rejected"
yourName: string           // 改名者在服务端的当前名字（用于回滚乐观更新）
players: { [name: string]: Player }  // 当前权威玩家列表
```

### `start` — 游戏开始

倒计时结束后由服务端发送，无载荷。客户端以此消息为权威信号进入 `playing` 阶段。

```
type: "start"
```

## 4. 游戏阶段

- `lobby`：等待阶段，棋盘隐藏，玩家可切换准备状态
- `countdown`：3 秒倒计时，棋盘仍隐藏，不可取消准备
- `playing`：游戏进行中，棋盘可见，允许标记

**阶段转换由服务端管理**：所有玩家准备后 → `countdown`（广播 `state`，含 `countdownSeconds`）→ 3 秒后 → 广播 `start`，游戏进入 `playing`。

## 5. 颜色参考

### PLAYER_COLORS（10 色，classic 模式共用）

| 颜色名 | 色值 |
|--------|------|
| blue | `#2563eb` |
| red | `#dc2626` |
| green | `#16a34a` |
| yellow | `#ca8a04` |
| orange | `#ea580c` |
| purple | `#9333ea` |
| cyan | `#0891b2` |
| magenta | `#d946ef` |
| lime | `#65a30d` |
| indigo | `#4f46e5` |

### Hex Team 色

| Team | 色值 |
|------|------|
| `blue` | `#2563eb` |
| `red` | `#dc2626` |

## 6. 连接生命周期

1. **连接**：使用 PartySocket 连接到 `{serverUrl}`，房间名为 `{roomName}`
2. **加入**：发送 `join` 消息，包含玩家名称和棋盘配置
3. **接收状态**：服务端返回 `state` 消息，包含完整游戏状态
4. **准备阶段**：所有玩家进入 `lobby` 阶段。发送 `ready` 切换准备状态
5. **开始游戏**：服务端检测到所有玩家就绪后，自动启动倒计时并广播 `state`；倒计时结束后广播 `start`，游戏正式开始
6. **游戏进行**：发送 `mark`/`unmark` 操作格子，服务端仲裁并转发
7. **离开**：关闭 WebSocket 连接，服务端自动清理并通知其他玩家

## 7. 消息速查

| type | 方向 | 关键载荷 |
|------|------|----------|
| `join` | C→S | `name, config?, mode?, lockout?` |
| `state` | S→C | `config, marks, players, phase, countdownSeconds, mode, lockout` |
| `start` | S→C | 无载荷 |
| `mark` | C→S, S→C | C→S: `index, by` / S→C: `index, by, marks` |
| `unmark` | C→S, S→C | C→S: `index, by` / S→C: `index, by, marks` |
| `rename` | C→S, S→C | `oldName, newName` |
| `rename_rejected` | S→C | `yourName, players` |
| `change_color` | C→S, S→C | `name, color` |
| `chat` | C→S, S→C | `name, color, text` |
| `ready` | C→S, S→C | `name, ready` |
| `player_joined` | S→C | `name, color` |
| `player_left` | S→C | `name` |

**经典棋盘索引**（5×5 行优先）：
```
 0  1  2  3  4
 5  6  7  8  9
10 11 12 13 14
15 16 17 18 19
20 21 22 23 24
```

**Hex棋盘索引**（轴向坐标）：
```
index = r × sizeBlue + q
q = index % sizeBlue
r = floor(index / sizeBlue)
```

### 数据结构

**BoardConfig**:
```ts
{ goals: GoalItem[]; lockout?: boolean }
```

**HexConfig**:
```ts
{ sizeBlue: number; sizeRed: number; goals: GoalItem[] }
```

**GoalItem**:
```ts
string | {
  text: string;
  tooltip?: string;
  text_i18n?: Record<string, string>;
  tooltip_i18n?: Record<string, string>;
  difficulty?: number;
  group?: string | string[];
  globalGroup?: string | string[];
  counter?: number;
}
```

**Player**:
```ts
{ name: string; color: string; ready?: boolean }
```

**MarkEntry**:
```ts
{ by: string; timestamp: number }
```

- Classic 模式：`by` = 玩家颜色值（如 `"#2563eb"`）
- Hex 模式：`by` = `"red"` / `"blue"`
