# BingoKit

实时多人联机 Bingo 应用。

[English](./README.md) | **中文**

## 特性

- **两种棋盘** — 经典 5×5 棋盘 + [Hex（六贯棋）](https://zh.wikipedia.org/wiki/%E5%85%AD%E8%B2%AB%E6%A3%8B)棋盘
- **任务编辑器** — 支持可视化编辑和 JSON/CSV 导入导出；支持设置提示、计数器、难度、互斥组
- **4种抽取方式**
  - 纯随机（不考虑难度，但仍受互斥组约束）
  - 均衡难度（每条线尽可能小的难度方差）
  - 相同分布（每条线的难度分布相同）
  - 固定（按顺序选择任务池的前 25 条任务）
- **多人同步** — 基于 [PartyKit](https://docs.partykit.io/) 服务
- **国际化** — 支持中文和英文
- **深色模式** — 跟随系统或手动切换
- **自定义计分** — 基于规则引擎的计分系统，支持表达式语言，可对格子和 Bingo 线分别计分。内置可视化规则编辑器
- **移动端适配** — 已针对小屏设备优化

## 开发

```bash
# 安装依赖
npm install

# 启动前端开发服务器
npm run dev

# 启动 PartyKit 开发服务器（WebSocket 后端，多人模式需要）
npm run dev:party

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 代码格式化（使用prettier）
npm run format

# 预览生产构建
npm run build
npm run preview

# 部署到 GitHub Pages（使用 /bingo-kit/ 作为base path）
npm run deploy
```

## 许可证

MIT License
