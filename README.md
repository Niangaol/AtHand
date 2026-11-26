# 顺手 · 校园个人助手

把兼职、花销、课程表与校园服务收在一处的个人助手。前端 React 19 + Vite 7 + TypeScript；云端逻辑跑在 Qoder Sites Functions（Node ESM）；本地同步走 Node HTTP 服务；Android 端用 Kotlin（`com.shunshou.collector`）。

## 快速开始

```bash
npm install
npm run dev        # Vite 开发服务器
npm run build      # tsc --noEmit && vite build
npm test           # Vitest 单测
npm run test:e2e   # Playwright 端到端
npm run sync       # 本地同步服务
```

## 目录

| 目录 | 作用 |
|---|---|
| `src/` | React 前端：`app/`、`components/`、`features/`、`domain/`、`data/` |
| `functions/` | Qoder Sites 云端函数：账户、校园代理、助手、日历、账本、隐私与路由 |
| `local-sync/` | 本地同步服务：planner/calendar 存储、MCP 网关、Agent 接口 |
| `e2e/` | Playwright 端到端用例（14 个 spec） |
| `android/` | Kotlin Android 客户端 |
| `docs/` | 接口、校园运行方式与 MCP 调研文档 |

## 文档

- [Agent 接口与内置助手](docs/agent-api.md)
- [校园助手：云端运行](docs/campus.md)
- [校园助手操作盘点](docs/campus-operation-inventory.md)
- [生活服务 MCP 接入清单](docs/life-service-mcp-catalog.md)

## 环境约定

Playwright 固定 1.65.0（chromium 1254），详见 [ENVIRONMENT.md](./ENVIRONMENT.md)。
