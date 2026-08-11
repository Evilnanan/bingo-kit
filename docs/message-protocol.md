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
code?: string              // 身份识别码（同名加入/重连时用于证明是本人其他设备）
config?: BoardConfig | HexConfig  // 棋盘配置（首个玩家提供）
mode?: "classic" | "hex"   // 游戏模式
lockout?: boolean           // 是否独占格子（classic 模式）
```

**同名加入规则**：如果房间里没有同名玩家，服务端会随机生成一个 4 位识别码，通过个人 `state` 的 `myCode` 字段返回。如果已有同名玩家，则必须携带正确的 `code` 才能加入（视为本人另一台设备或断线重连）；否则服务端返回 `join_rejected`。

### `change_code` — 修改识别码

玩家可以随时修改自己的识别码。任意非空字符串，最长 32 位（不限于数字、不限于 4 位）。服务端校验后仅同步给**同名客户端**（不含发起者，发起者通过乐观更新获得即时反馈）。

```
type: "change_code"
name: string   // 玩家名称
code: string   // 新识别码（trim 后 1–32 个字符）
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

### `toggle_star` — 切换星标

仅同步给**同名客户端**（同一玩家的多个设备）。载荷为切换后的结果状态。

```
type: "toggle_star"
name: string    // 玩家名称（服务端按 name 归组，同 chat/ready，不做发送者身份校验）
index: number   // 格子索引
starred: boolean // 切换后是否已星标
```

### `set_counter` — 设置计数器进度

仅同步给**同名客户端**。载荷为变更后的进度值（0 表示清除）。

```
type: "set_counter"
name: string    // 玩家名称（服务端按 name 归组，同 chat/ready，不做发送者身份校验）
index: number   // 格子索引
value: number   // 变更后的进度（0 ≤ value ≤ 目标计数）
```

### `add_note` — 添加笔记

仅同步给**同名客户端**。笔记是玩家自己的路线规划，服务端按 `name` 归组。

```
type: "add_note"
name: string   // 玩家名称
note: {
  id: string
  text: string
  todo: boolean  // 是否待办
  done: boolean  // 待办是否已完成
}
```

### `update_note` — 更新笔记

只更新携带的字段，未携带的保持不变。

```
type: "update_note"
name: string
id: string
text?: string
todo?: boolean
done?: boolean
```

### `delete_note` — 删除笔记

```
type: "delete_note"
name: string
id: string
```

### `reorder_notes` — 调整笔记顺序

`ids` 为完整的新顺序（须包含当前全部笔记 id）。

```
type: "reorder_notes"
name: string
ids: string[]
```

## 3. 服务端 → 客户端消息

### `state` — 完整状态同步

在新玩家加入或阶段变更时发送。客户端应以此消息为准。发送给单个连接时（加入/重连/重开），会额外携带该玩家的个人字段 `myName` / `myCode` / `myStars` / `myCounters` / `myNotes` / `myUnreadChat`；广播给所有人的 `state` 不包含个人字段。

```
type: "state"
config: BoardConfig | HexConfig | null
marks: { [index: string]: MarkEntry[] }
myName?: string                         // 本连接的服务端权威玩家名（重试改名后以它为准）
myCode?: string | null                  // 本玩家的身份识别码（仅逐连接发送，首次加入时由服务端生成）
myStars?: number[]                     // 个人星标索引（仅逐连接发送）
myCounters?: { [index: string]: number } // 个人计数器进度（仅逐连接发送）
myNotes?: PlayerNote[]                 // 个人笔记（仅逐连接发送）
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

### `join_rejected` — 加入被拒绝

当使用一个已被占用的名字加入、且未提供正确识别码时，**仅发送给尝试加入的连接**，提示客户端改名或以本人身份（输入识别码）重试：

```
type: "join_rejected"
name: string            // 被占用的玩家名称
reason: "bad_code"      // 识别码缺失或不匹配（统一判定为识别码错误）
```

### `code_changed` — 识别码已变更

服务端将识别码变更**仅转发给同名连接**（不含发起者，发起者通过乐观更新获得即时反馈）：

```
type: "code_changed"
name: string   // 玩家名称
code: string   // 新的识别码
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

### `star` / `counter` — 同名客户端个人状态同步

服务端将个人星标 / 计数器变更**只转发给同名连接**（不含发起者，发起者通过乐观更新即时反馈）：

```
type: "star"
name: string
index: number
starred: boolean
```

```
type: "counter"
name: string
index: number
value: number
```

### `note_added` / `note_updated` / `note_deleted` / `notes_reordered` — 同名客户端笔记同步

服务端将个人笔记变更**只转发给同名连接**（不含发起者，发起者通过乐观更新即时反馈）：

```
type: "note_added"
name: string
note: PlayerNote
```

```
type: "note_updated"
name: string
note: PlayerNote   // 完整更新后的笔记
```

```
type: "note_deleted"
name: string
id: string
```

```
type: "notes_reordered"
name: string
ids: string[]
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
| `join` | C→S | `name, code?, config?, mode?, lockout?` |
| `change_code` | C→S | `name, code` |
| `state` | S→C | `config, marks, players, phase, countdownSeconds, mode, lockout` |
| `join_rejected` | S→C | `name, reason` |
| `code_changed` | S→C | `name, code` |
| `start` | S→C | 无载荷 |
| `mark` | C→S, S→C | C→S: `index, by` / S→C: `index, by, marks` |
| `unmark` | C→S, S→C | C→S: `index, by` / S→C: `index, by, marks` |
| `rename` | C→S, S→C | `oldName, newName` |
| `rename_rejected` | S→C | `yourName, players` |
| `change_color` | C→S, S→C | `name, color` |
| `chat` | C→S, S→C | `name, color, text` |
| `ready` | C→S, S→C | `name, ready` |
| `toggle_star` / `set_counter` | C→S | `name, index, starred` / `name, index, value` |
| `star` / `counter` | S→C | `name, index, starred` / `name, index, value` |
| `add_note` / `update_note` / `delete_note` / `reorder_notes` | C→S | `name, note` / `name, id, patch` / `name, id` / `name, ids` |
| `note_added` / `note_updated` / `note_deleted` / `notes_reordered` | S→C | `name, note` / `name, note` / `name, id` / `name, ids` |
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
{
  sizeBlue: number;
  sizeRed: number;
  goals: GoalItem[];
  originalPool?: GoalItem[]; // client-side only, stripped before transmission
}
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

每个玩家在服务端还有一个**身份识别码**（`playerCodes`，随改名迁移，离开时删除）。识别码不会广播给其他玩家，只在个人 `state`（`myCode`）和 `code_changed` 消息中发送给同名连接。首次加入时由服务端生成 4 位数字，之后玩家可在房间设置中自行修改为任意非空字符串（最长 32 位）。

**MarkEntry**:
```ts
{ by: string; timestamp: number }
```

- Classic 模式：`by` = 玩家颜色值（如 `"#2563eb"`）
- Hex 模式：`by` = `"red"` / `"blue"`
