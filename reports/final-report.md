# 顺手 AtHand 本轮改动报告（2026-11-22）

三条线：生活服务 MCP 接入、账号系统、校园服务。全部改动**未 commit、未 push**，工作区可直接回滚（`git checkout .` / `git clean -fd`，注意 `functions/` 目录在本仓库从未被 git 跟踪）。

## 一、结论

| 线 | 完成度 | 现在能做什么 | 还差什么 |
| --- | --- | --- | --- |
| 生活服务 MCP | 接入框架 + 配置 + 三档闸门 + 离线测试全部落地 | 设置页「生活服务」可配置 8 家服务；助手能拿到已启用服务的工具；下单要确认、支付不执行 | 没有真实 Key，未做真实联调；天气(std code) 需自建 HTTP 桥；飞猪只做 CLI 存在性检测 |
| 账号系统 | 云端 6 个账号接口 + 单测 + 设置页账号区落地 | 改密码、看登录设备、退出单设备/全部设备、看账号与云端数据统计 | 账号注销后端已实现但前端未暴露（等你拍板清理范围）；云端未部署 |
| 校园服务 | 199 操作盘点 + 统一错误引导 + 快捷入口补充 + 降级 e2e 用例 | 校园页四类错误各有可操作提示；知识检索进快捷入口；盘点文档可查每个操作 | 助手仍只有 7 个 campus_* 工具（扩展需把云端 199 操作暴露给本机助手，本轮未做）；e2e 未实际执行 |

## 二、改动文件

### 生活服务 MCP

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `local-sync/mcpServices.mjs` | 新增 | 8 家服务目录、工具前缀、风险档、配置合成、状态机 |
| `local-sync/mcpGateway.mjs` | 新增 | Streamable HTTP MCP 客户端（initialize/tools/list/tools/call）、会话缓存、超时、重试、截断、审计、三档闸门 |
| `local-sync/mcpConfig.mjs` | 新增 | 配置读写（`local-sync/data/mcp-servers.json`）、原子写、脱敏视图、部分更新 |
| `local-sync/agentApi.mjs` | 改 | manifest 合并已启用服务的 MCP 工具（异步）；read 直执行、order 待确认、pay 拦截；只读令牌不能触发下单 |
| `local-sync/server.mjs` | 改 | `GET /api/mcp/services`、`PUT /api/mcp/services/:name`、`POST .../probe`、`DELETE .../:name`；保存后重建网关；审计接 `recordAudit` |
| `local-sync/assistant.mjs` | 改 | 工具清单改 `await getTools()`（配合异步 manifest） |
| `src/data/mcpServices.ts` | 新增 | 前端配置/探测客户端与响应解析 |
| `src/features/settings/McpServicesPanel.tsx` | 新增 | 设置页「生活服务」配置区（启停、地址、请求头、三态、测试连接） |
| `src/features/settings/SettingsPage.tsx` | 改 | 挂入「生活服务」区块 |
| `src/features/services/ServicesPage.tsx` | 新增 | 独立「生活服务」页：8 家服务目录、实时状态、申请入口、使用示例 |
| `src/features/services/ServicesPage.test.tsx` | 新增 | 页面渲染测试（未连接 / 连接后三态） |
| `src/app/App.tsx`、`src/app/navigation.ts` | 改 | 新增 `/services` 路由与「生活服务」导航项 |
| `src/data/agentToolLabels.ts` | 改 | MCP 工具名中文前缀（高德/天气/飞猪/飞常准/快递100/滴滴/瑞幸/麦当劳） |
| `src/styles.css` | 改 | MCP 配置区与账号区样式 |
| `docs/life-service-mcp-catalog.md` | 改 | 追加「本轮接入状态」：模块、风险档、Key 变量名、验证命令 |
| `local-sync/mcpGateway.test.mjs` | 新增 | 19 条离线协议测试（假 MCP server） |
| `local-sync/mcpConfig.test.mjs` | 新增 | 6 条配置读写/脱敏/校验测试 |
| `local-sync/mcpWiring.test.mjs` | 新增 | 7 条接线测试：manifest 合并、read/order/pay、只读令牌、未配置降级 |

### 旅行服务 × 高德/飞常准（2026-11-22 追加）

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `local-sync/mcpToolbox.mjs` | 新增 | 场景工具箱：只读直调、场景匹配、参数表单（纯逻辑复用 `src/domain/mcpToolbox.ts`） |
| `src/domain/mcpToolbox.ts` | 新增 | 场景关键词匹配、JSON Schema 表单、参数类型转换（前端与本机网关共用） |
| `src/domain/travelTools.ts` | 新增 | 交通条目 → 场景、参数预填、结果摘要 |
| `local-sync/server.mjs` | 改 | `GET /api/mcp/tools`（已启用服务的工具目录）与 `POST /api/mcp/call`（只读直调，下单/支付拒绝） |
| `src/data/mcpTools.ts` | 新增 | 前端工具目录与只读调用客户端 |
| `src/features/trips/TravelTools.tsx` | 新增 | 旅记页「旅程工具」：航班动态/火车余票/路线/周边/地图快捷动作，参数表单，结果内联 |
| `src/features/trips/TripDetailPage.tsx` | 改 | 挂入旅程工具 |
| `src/features/services/ServicesPage.tsx` | 重做 | 按「出门前 / 在路上 / 到了 / 吃点什么」场景组织，服务与 Key 收进折叠区 |
| `local-sync/mcpToolbox.test.mjs`、`local-sync/travelTools.test.mjs` | 新增 | 9 条测试：场景匹配、预填、类型转换、只读拦截 |

设计要点：上游工具名会变，所以不写死工具名；页面按场景关键词匹配工具，匹配不到就让用户从工具列表里挑。所有页面直调只允许 `read`，下单/支付必须回到助手的「下一句确认」流程。

### 账号系统

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `functions/account.mjs` | 新增 | PBKDF2、会话签发/校验、改密、会话列表、吊销、退出全部、注销、账号摘要与统计 |
| `functions/routes.mjs` | 改 | 接入 `GET /api/account`、`POST /api/account/password`、`GET /api/account/sessions`、`DELETE /api/account/sessions/:id`、`POST /api/account/logout-all`、`POST /api/account/delete` |
| `functions/account.test.mjs` | 新增 | 6 条账号管理单测 |
| `src/features/settings/AccountPanel.tsx` | 新增 | 账号信息、数据统计、登录设备、改密码、退出设备/全部设备（注销按钮未放） |
| `src/features/settings/SettingsPage.tsx` | 改 | 云端登录后显示账号区 |
| `src/features/settings/McpAccountPanel.test.tsx` | 新增 | 7 条组件测试（MCP 面板 + 账号面板） |

### 校园服务

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `docs/campus-operation-inventory.md` | 新增 | 199 个操作按 14 域盘点：读写、权限、必填参数、可用性结论、高频接入建议、缺口边界 |
| `tools/campus-inventory.mjs` | 新增 | 盘点文档生成脚本（读 `functions/campus-manifest.mjs`） |
| `src/features/campus/campusErrors.ts` | 新增 | 四类降级（未连接、缺权限、PAT 失效、上游超时）与确认/参数错误的统一文案与动作 |
| `src/features/campus/CampusPage.tsx` | 改 | 错误结果改用统一提示；补「知识检索/快速问答」快捷入口；域名图标补全；重试按钮 |
| `local-sync/campusErrors.test.mjs` | 新增 | 5 条错误文案单测 |
| `e2e/campus.spec.ts` | 改 | 追加「授权缺失/上游失败」降级 e2e 用例（依赖云端接口 mock） |

## 三、验证

已执行（本环境可用）：

```bash
node --test-isolation=none --test local-sync/mcpGateway.test.mjs local-sync/mcpConfig.test.mjs local-sync/mcpWiring.test.mjs local-sync/campusErrors.test.mjs functions/account.test.mjs
# ℹ tests 43  ℹ pass 43  ℹ fail 0

npx tsc --noEmit
# exit 0
```

既有不 spawn 的模块测试（`campusModules.test.mjs` 等）通过 5/6；唯一失败是 `agentModules.test.mjs` 的 `spawn EPERM`，属环境限制，与本次改动无关。

网关路由端到端验证（临时数据目录，真实启动 `local-sync/server.mjs`）：

```text
GET  /api/health                          → {"ok":true,"service":"shunshou-gateway"}
POST /api/login                           → 200，拿到会话 token
GET  /api/mcp/services                    → 8 个服务，未配置/stdio 需桥状态正确，URL 全脱敏
PUT  /api/mcp/services/amap               → 200，enabled:true、configured:true、urlMasked:"https://mcp.amap.com/mcp?key=***"
POST /api/mcp/services/variflight/probe   → 400 mcp_not_configured（未配置，未发上游请求）
```

保存后的配置写入 `local-sync/data/mcp-servers.json`（临时目录测试后已清理），真实值不会出现在接口响应里。

旅行工具路由端到端验证（假 MCP server + 真实启动网关）：

```text
PUT  /api/mcp/services/amap            → ready
GET  /api/mcp/tools                    → 3 个工具（amap_maps_textsearch/read、amap_maps_direction_driving/read、amap_taxi_create_order/order）
POST /api/mcp/call（只读工具）          → ok，返回上游文本
POST /api/mcp/call（下单工具）          → 400 tool_not_read_only
```

**未执行（环境限制）**：

```bash
npm test            # vitest 加载 vite.config.ts 时 esbuild spawn EPERM
npm run build       # 同上
npx playwright test # 需要浏览器与 dev server，本环境 spawn 受限，未跑
```

因此 `SettingsPage.test.tsx` 与新增的 `McpAccountPanel.test.tsx` **只做了 TypeScript 类型检查，没有实际运行**；e2e 降级用例同理。需要你在普通终端复跑：

```bash
npm test
npm run build
npx playwright install --with-deps chromium   # 首次
npx playwright test
```

## 四、未完成 / 需要你决定

1. **真实 MCP Key**：高德 `AMAP_WEB_KEY`、飞常准 `VARIFLIGHT_KEY`、快递100 `KD100_KEY`、滴滴 `DIDI_MCP_KEY`（sandbox）、瑞幸 `LUCKIN_MCP_TOKEN`、麦当劳 `MCD_MCP_TOKEN`；华风爱科 `WEATHERCN_OPENAPI_KEY` 还需先自建 stdio→HTTP 桥；飞猪要装 `@fly-ai/flyai-cli`。填进设置页后点「测试连接」即可验证。
2. **账号注销**：后端已有接口（密码 + `confirmation: "delete-account"`），前端没放按钮。需要你定清理范围（只删账号与会话，还是云端账本/记录一起删）后再暴露。
3. **校园 199 操作给助手**：现在助手只有 7 个 `campus_*` 工具（走本机 HDU-Helper），199 操作只在云端校园页面。要扩展助手，需要把云端 `/api/campus/run` 以安全方式接到本机助手，属于下一轮。
4. **云端部署**：`functions/` 的改动没有部署到 Qoder Sites（本轮不部署、不推送）。
5. **真实校园账号联调**：没有你的 HDUHelp 授权，校园操作只验证了鉴权路径与错误格式，没有逐项调用上游。

## 五、无 commit 说明

`git status` 显示本轮改动均为未提交状态；`functions/` 整个目录在本仓库从未被 git 跟踪（`git ls-files functions` 为空），所以它的改动没有 diff 基线，回滚需手动删除/恢复文件。`git log` 最新提交仍是 `b9e6c1c`，本轮没有产生 commit。
