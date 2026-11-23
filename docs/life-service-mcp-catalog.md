# 生活服务 MCP 接入清单（2026-11-22 调研）

本轮只做调研，**没有改任何代码**。目标是先确认"哪些能接、怎么接、接之前要办什么"，再决定顺序。

核实方式：官方文档原文 + 对端点发真实请求 + `npm view` 查包。文末标注每条结论的证据。

## 一、结论先说

1. **个人身份可自助、能真接的共 8 家**：高德地图、华风爱科天气、滴滴、瑞幸、麦当劳中国、快递100、Aqara、微信读书。微信读书是 Skill 不是 MCP；飞书/钉钉是远程 MCP，但要自建应用并过权限审批。
2. **飞猪没有 MCP**，走的是 `@fly-ai/flyai-cli`（8 个搜索命令，只搜不下单）。对我们反而是好事：包一层 CLI 就能当工具用。
3. **蜜雪冰城、肯德基、星巴克没有自建 MCP**；蜜雪/肯德基是挂在「支付宝 AI 开放平台」和「千问 App」的 Skill 里，平台面向商家邀测，个人接不了。
4. **美团 / 大众点评明确没有面向第三方的消费端 MCP**。饿了么的官方 MCP 是淘宝闪购**商家经营侧**，不是点外卖。
5. **能真实花钱的工具有 3 个**：滴滴 `taxi_create_order`、瑞幸 `createOrder`、麦当劳 `create-order`。三家都必须由用户本人完成支付（扫码 / 支付链接），AI 无法代付——这条恰好和顺手"不替你付款"的边界一致。
6. **校园、求职、金融、政务四类的官方 MCP 数量是 0**。学习通、知网只有社区逆向版（自持 cookie / 机构 SSO），不上生产。
7. **餐饮门店和电商巨头基本闭合**：海底捞、霸王茶姬、古茗、茶百道、沪上阿姨、库迪、Tims、汉堡王、德克士、华莱士、塔斯汀、老乡鸡、好利来、全家、罗森、7-11 全部只有小程序，无开放平台；淘宝、拼多多、闲鱼、小红书、抖音/快手本地生活要么只服务商家，要么只有 Playwright 逆向版。

## 二、总表

| 服务 | 场景 | 官方 | 传输 / 端点 | 鉴权 | 个人可自助 | 真实交易 | 端点实测 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 高德地图 | 地图/路线/天气/专属地图 | ✅ | Streamable HTTP `https://mcp.amap.com/mcp?key=K`；stdio `@amap/amap-maps-mcp-server` | Web 服务 Key | ✅ 需个人实名 | ❌ 只出唤端链接 | ✅ 200 |
| 滴滴 | 打车/地图/路线 | ✅ | `https://mcp.didichuxing.com/mcp-servers?key=K`（sandbox 加 `-sandbox`） | 滴滴账号登录控制台激活 Key | ✅ | ⚠️ 真实下单 | ✅ 文档页 200 |
| 瑞幸 | 咖啡点单到店自取 | ✅ | `https://gwmcp.lkcoffee.com/order/user/mcp` | OAuth token（登录开放平台获取） | ✅ | ⚠️ 下单后本人扫码付 | ✅ 401 `oauth token is not found` |
| 麦当劳 | 麦乐送/到店取/团餐/积分 | ✅ | `https://mcp.mcd.cn`，`Authorization: Bearer <token>` | 手机号验证码 → 激活 Token | ✅ | ⚠️ 下单返回支付链接 | ✅ 400 未带鉴权 |
| 快递100 | 快递轨迹/时效/价格 | ✅ | `https://api.kuaidi100.com/mcp/streamable?key=K`；另有 SSE 与 `uvx kuaidi100-mcp` | 开放平台 Key | ❓ 后台叫"企业管理后台"，需确认是否要企业身份 | ❌ 只查不寄 | ✅ 200 |
| 飞猪 FlyAI | 机/酒/门票/玩乐搜索 | ✅ 但**非 MCP** | `npm i -g @fly-ai/flyai-cli`（v1.0.16） | `flyai config set FLYAI_API_KEY`；不填 Key 也能跑体验模式 | ✅ 需淘宝账号+实名 | ❌ 仅搜索，`jumpUrl` 导流 | ✅ 包存在 |
| 飞常准 | 航班动态/火车余票/空铁联运 | ✅ | `https://ai.variflight.com/servers/tripmatch/mcp`，`X-API-Key` | 注册送 50 元额度 | ✅ | ❌ 只查 | ✅ 401 未带 key |
| 百度地图 | 地图/路线 | ✅ | `https://mcp.map.baidu.com/mcp?ak=K`；stdio `@baidumap/mcp-server-baidu-map` | 服务端 AK | ✅ 需实名 | ❌ | ✅ 406（需 MCP 握手） |
| 腾讯位置服务 | 地图/路线 | ✅ | `https://mcp.map.qq.com/mcp?key=K&format=1`，仅 HTTP 无 stdio | Key | ✅ | ❌ | ✅ 400 未带参数 |
| 支付宝支付 | 收单/查询/退款 | ✅ | 魔搭托管 `mcp-server-alipay` | 沙箱免资质；生产需商家签约 | 沙箱可 | ⚠️ 生产涉资金 | 📄 仅文档 |
| 华风爱科天气 | 实况/预报/预警/AQI/分钟降水 | ✅ 中国气象局华风体系 | stdio `pip install weatherwork-consumer-mcp`（v0.3.4），env `WEATHERCN_OPENAPI_KEY` | 个人实名注册 | ✅ | ❌ 只读 | ✅ PyPI 200 |
| Aqara 绿米 | 智能家居设备/场景/能耗 | ✅ | `https://agent.aqara.com/open/mcp`，Bearer | Aqara 账号登录即拿 `aqara_api_key` | ✅ | ⚠️ 真控设备 | ✅ 401 需 token |
| 微信读书 | 书架/笔记/阅读统计 | ✅ 但**非 MCP**（Skill） | `npx skills add Tencent/WeChatReading -g`，网关 `https://i.weread.qq.com/api/agent/gateway` | 个人 API Key `wrk-` 自助 | ✅ | ❌ 只读 | ✅ 网关 401 |
| 什么值得买 | 商品/价格/内容搜索 | ✅ | `https://mcp-api.zhidemai.com/mcp`（SSE） | 需商务申请 Key，非自助 | ❓ 学生可能过不了 | ❌ 只读 | ✅ SSE 握手成功 |
| 飞书 | 云文档/消息 | ✅ | `POST https://mcp.feishu.cn/mcp` | 自建应用 + 权限审批 | ❌ 需开发者身份 | ❌ | ✅ 401 `oauth required` |
| 钉钉 | 企业协作 | ✅ | `POST https://mcp.dingtalk.com/mcp` | 企业内部应用 | ❌ | ❌ | ✅ 200 `sso_need_login` |
| 同花顺 iFinD | 行情/财务/公告 | ✅ | 站点 `mcp.51ifind.com` 200，端点未公开 | iFinD 付费/机构账号 | ❌ | ❌ 只读 | ✅ 站点 200 |
| 哈啰顺风车 | 顺风车下单支付 | ✅ | 端点未公开，首期仅授权平台 | 商务申请 | ❌ | ⚠️ 全链路交易 | ⚠️ 未证实 |
| 蜜雪冰城 / 肯德基 | 茶饮/快餐点单 | ❌ | 无公开端点，仅支付宝 AI 开放平台 / 千问 Skill | 商家邀测 | ❌ | — | — |
| 美团 / 大众点评 | 外卖/本地生活 | ❌ | 无消费端 MCP | — | ❌ | — | — |
| 饿了么 | 外卖 | 商家侧 | 淘宝闪购商家 MCP | 服务商身份 | ❌ | — | — |
| 淘宝/天猫/闪购 | 电商 | 商家侧 | 开放平台内 MCP，无公共 URL | ISV 审核、保证金 5 万 | ❌ | — | — |
| 京东/拼多多/闲鱼/小红书/抖音 | 电商/内容 | ❌ | 仅社区逆向版 | — | ❌ | — | — |
| 海底捞/霸王茶姬/古茗/茶百道/库迪/Tims/汉堡王等 | 门店点单 | ❌ | 仅小程序，无开放平台 | — | ❌ | — | — |
| 顺丰/菜鸟/极兔/丰巢/京东物流 | 物流 | ❌ | 仅 REST 开放平台 | 企业资质/月结 | ❌ | — | — |
| 京东健康/阿里健康/叮当快药/Keep/薄荷 | 医疗健康 | ❌ | 仅 REST 或商家 API | 企业 | ❌ | — | — |
| 学习通/知网 | 校园/学术 | ❌ | 仅社区逆向版（cookie/SSO） | — | ⚠️ 自持凭证 | — | — |
| 实习僧/BOSS/猎聘/智联 | 求职 | ❌ | 仅企业向 REST | 商务合作 | ❌ | — | — |
| 政务/缴费/12123/社保 | 政务民生 | ❌ | 无 | — | ❌ | — | — |

## 三、可直接抄的配置

```json
{
  "mcpServers": {
    "amap":  { "url": "https://mcp.amap.com/mcp?key=<AMAP_WEB_KEY>" },
    "didi":  { "type": "streamable_http", "url": "https://mcp.didichuxing.com/mcp-servers-sandbox?key=<DIDI_MCP_KEY>" },
    "luckin":{ "type": "streamableHttp", "url": "https://gwmcp.lkcoffee.com/order/user/mcp",
               "headers": { "Authorization": "Bearer <LUCKIN_MCP_TOKEN>" } },
    "mcd":   { "type": "streamablehttp", "url": "https://mcp.mcd.cn",
               "headers": { "Authorization": "Bearer <MCD_MCP_TOKEN>" } },
    "kuaidi100": { "url": "https://api.kuaidi100.com/mcp/streamable?key=<KD100_KEY>" },
    "variflight": { "url": "https://ai.variflight.com/servers/tripmatch/mcp",
                    "headers": { "X-API-Key": "<VARIFLIGHT_KEY>" } },
    "aqara": { "type": "streamableHttp", "url": "https://agent.aqara.com/open/mcp",
               "headers": { "Authorization": "Bearer <AQARA_API_KEY>" } }
  }
}
```

天气（stdio，`WEATHERCN_OPENAPI_KEY` 由 platform.weathercn.com 实名注册获得）：

```json
{ "mcpServers": { "weathercn": {
  "command": "uvx", "args": ["weatherwork-consumer-mcp"],
  "env": { "WEATHERCN_OPENAPI_KEY": "<KEY>" } } } }
```

微信读书（Skill，不是 MCP）：

```bash
npx skills add Tencent/WeChatReading -g
export WEREAD_API_KEY=wrk-xxxxxxxx   # 到 weread.qq.com/r/weread-skills 领
```

飞猪（CLI，不是 MCP）：

```bash
npm i -g @fly-ai/flyai-cli
flyai config set FLYAI_API_KEY "<key>"   # 不设也能跑体验模式
flyai search-hotel  --dest-name "杭州" --poi-name "西湖" --check-in-date 2026-12-01 --check-out-date 2026-12-02
flyai search-flight --origin "北京" --destination "上海" --dep-date 2026-12-05
flyai search-train  --origin "杭州" --destination "上海" --dep-date 2026-12-05
flyai keyword-search --query "杭州三日游"
```

## 四、各家能力与坑

### 高德（第一优先）
- 17 个工具：地理/逆地理编码、IP 定位、天气、驾车/步行/骑行/公交规划、距离测量、关键词/周边/详情搜索、导航唤端、打车唤端。
- **`personal_map` 是差异化能力**：把行程点位生成专属地图链接，Safari 打开即可导入高德 App。顺手的"旅记/行程"模块可以直接吃到这个。
- 个人认证开发者有 **1 年**免费月配额（自认证起算），数值以控制台为准；QPS 可单独购买。
- 坑：官方 **2026-03-17 已下线通用级 SSE**，只留 Streamable HTTP 和 stdio。`/sse?key=` 现在仍能响应，但不要用。

### 滴滴（第二优先，涉钱）
- 13 个工具：6 个 `taxi_*`（预估/叫车/查询/取消/司机位置/唤端链接）+ 7 个 `maps_*`。
- 硬约束（文档原文）：经纬度必须传**字符串**、格式 `lng,lat`；坐标必须先用 `maps_textsearch` 现查，不许用模型记忆；`taxi_create_order` **必须用户明确确认**，否则报 `-32010`。
- 开发阶段必须用 `-sandbox` 端点：返回 Mock 数据、不产生真实订单，还能模拟完整订单状态流转。
- `traceId` 有时效，预估完要立刻确认下单，过期要重新预估（`-32021`）。

### 瑞幸（涉钱）
- 7 个工具：`queryShopList` / `searchProductForMcp` / `switchProduct` / `queryProductDetailInfo` / `previewOrder` / `createOrder` / `queryOrderDetailInfo` / `cancelOrder`。
- **只支持到店自取**，明确拒绝外送。`createOrder` 返回 `payOrderQrCodeUrl`，用户自己扫码付。
- 鉴权是 OAuth token（实测未带 token 返回 `{"message":"oauth token is not found"}`），不是普通 API Key。个人登录开放平台即可拿。

### 麦当劳（涉钱）
- 18+ 工具：查店、查菜单、算价、创建订单、取消订单、查订单、订单列表、领券、积分商城、营养信息、外送地址、活动日历、团餐。
- `Authorization: Bearer <token>`，**每个 Token 600 次/分钟**，超了 429。Token 走手机号验证码自助申请。
- 仅中国大陆（不含港澳台）。

### 飞猪（只搜不下单）
- 8 个命令：`keyword-search`、`ai-search`、`search-flight`、`search-train`、`search-hotel`、`search-poi`、`search-marriott-hotel`、`search-marriott-package`。
- 首赠 5000 次 + 每日 100 次免费包；正式 Key 要实名。部分商品不回传价格，得点 `jumpUrl` 去看实时价。
- 不是 MCP，接入方式是 spawn CLI 读 JSON，在顺手侧映射成 `fliggy_search_hotel` 这类工具。

### 快递100
- 只查不寄。SSE 和 Streamable HTTP 两个端点都在官方文档里（`/mcp/sse?key=` 与 `/mcp/streamable?key=`），另有 `uvx kuaidi100-mcp` 本地模式。
- 待确认：文档写的是在"快递100企业管理后台"取 key，个人能不能自助开需要实际注册一次看。

### 支付宝
- 「支付 MCP Server」：魔搭托管，沙箱免资质可玩，生产收单要商家签约。
- 「支付宝 AI 开放平台」（2026-07-07 上线）：商家把服务封装成 MCP / Skill / Agent，首批有肯德基、蜜雪冰城、瑞幸、高德打车、滴滴。**只面向商家/机构/服务商邀测，个人接不了**。蜜雪、肯德基就卡在这一层。

### 华风爱科天气（第二优先）
- 中国气象局华风集团与 AccuWeather 的合资公司，是"中国天气网"背后的商业主体——这是目前唯一一家**官方、个人实名即可、每天 500 次免费**的天气 MCP。
- stdio 形态：`pip install weatherwork-consumer-mcp`（PyPI v0.3.4，实测存在），env 填 `WEATHERCN_OPENAPI_KEY`。19 个工具，覆盖实况、预报、预警、AQI、分钟级降水。
- 坑：和风天气 QWeather 官方文档里**没有** MCP 条目，GitHub 官方组织也没有 MCP 仓库，网上流传的和风 MCP 全是社区版（需要自备 key、自己部署）。别把它当成官方能力写进方案。
- 彩云天气的官方文档 `docs.caiyunapp.com/.../mcp` 已 404，同样只有社区版。

### Aqara（第二优先，能控设备）
- 官方远程端点 `https://agent.aqara.com/open/mcp`，Streamable HTTP + `Authorization: Bearer <aqara_api_key>`，实测未带 token 返回 `{"error":"Authorization bearer token is required."}`，端点真实。
- 登录 Aqara Agent 即拿 `aqara_api_key`，个人账号自助，无企业资质要求。
- 能力：家庭/空间、设备、场景、自动化、能耗、灯光效果、固件——**这是唯一能真"执行"而不只是"查询"的低成本入口**。
- 顺带澄清两个误判：小米澎湃OS 的 MCP 文档是"让你把自己的 MCP **发布**给小爱调用"，方向相反；华为小艺是 Intents Kit 上架，同理。

### 微信读书（只读，但非常适合顺手）
- 官方 Skill，不是 MCP：`npx skills add Tencent/WeChatReading -g`，API Key 以 `wrk-` 开头，到 `weread.qq.com/r/weread-skills` 自助领取。
- 六类能力：搜书、书籍信息与目录、书架、笔记划线、阅读统计、公开点评。全部只读。
- 和顺手很搭：阅读时长可以进专注统计，划线和想法可以进旅记/日记。官方 README 明确说"API Key 绑定用户身份，需要身份的接口自动注入"，不用手传参数。

### 什么值得买（备选）
- 官方真 MCP 端点 `https://mcp-api.zhidemai.com/mcp`，实测返回标准 SSE 握手（`event: endpoint` + `session_id`）。
- 但门槛是**商务申请**，不是自助注册。个人学生身份大概率过不了，先发邮件问额度再排期。
- 能力只读：商品搜索、历史价格、内容搜索。

### 飞书 / 钉钉（有端点，但门槛在企业侧）
- 飞书 `POST https://mcp.feishu.cn/mcp`，实测 `{"code":-32010,"message":"oauth required"}`；需要自建应用 + UAT/TAT + 权限审批，能力偏云文档。
- 钉钉 `POST https://mcp.dingtalk.com/mcp`，实测 `sso_need_login`；需要企业内部应用。
- 对个人 App 都不划算，除非以后做"顺手 ↔ 学校/社团飞书文档"这类场景。

### 查过但明确没有官方 MCP 的（避免重复调研）
- **校园**：超级课程表、完美校园、今日校园、中国大学MOOC、智慧树、校园跑，全部无开放平台。学习通只有社区逆向版（`chaoxing-mcp` / `xuexitong-cli`，AES 登录 + cookie），知网只有社区版（要机构 SSO）。**这两类不要上生产**。
- **求职**：实习僧有开放平台但只有 REST，`/mcp` 返回 404；BOSS、猎聘、智联、前程无忧、兼职猫、青团社均无。
- **金融**：招行、微众、平安、东方财富、雪球、天天基金无官方 MCP；同花顺 iFinD 站点在（`mcp.51ifind.com` 200）但端点未公开且要付费机构账号。国税发票查验无官方 MCP，第三方 `fpzwcx.com` 要付费 appCode。
- **政务**：交管12123、国家政务服务平台、社保、国家电网 95598，全部无。
- **物流**：顺丰丰桥、菜鸟、京东物流、极兔、丰巢、通达系，全部只有 REST 开放平台且要企业资质或月结账号。**能寄件的那几家门槛比查件高一个量级**。
- **医疗**：京东健康、阿里健康、美团买药、叮当快药、微医、好大夫、平安健康、Keep、薄荷，全部无 MCP。
- **门店**：海底捞（"嗨小店"商家平台，非点单）、盒马（走淘宝商家侧）、山姆、霸王茶姬、古茗、茶百道、沪上阿姨、库迪、Tims、汉堡王、德克士、华莱士、塔斯汀、老乡鸡、好利来、全家、罗森、7-11——全部只有小程序。
- **电商**：京东无 C 端 MCP；淘宝/天猫/闪购只服务商家（保证金 5 万）；拼多多、闲鱼、小红书、抖音/快手本地生活只有社区逆向版。
- **内容**：B站、网易云、QQ音乐、知乎、豆瓣、微博、爱奇艺、腾讯视频均只有社区爬虫版。

## 五、接到顺手里的方式（下一轮再动手）

现状：`local-sync/agentApi.mjs:234` 是硬编码的 40 个工具数组；`assistant.mjs:206` 把工具转成 OpenAI function calling 格式；`server.mjs:361` 把 `getTools` / `callTool` 注入助手。工具系统是静态的，没有 MCP。

最小改动路径：

1. 新增 `local-sync/mcpGateway.mjs`，用 `@modelcontextprotocol/sdk` 的 Streamable HTTP client 连远程 server，做 `tools/list` 和 `tools/call`，带连接缓存与超时。
2. 在 `agentApi.mjs` 的 `tools` 后面合并 MCP 工具，统一命名前缀 `amap_*` / `didi_*` / `luckin_*` / `mcd_*`，避免和现有 40 个撞名。
3. 把 MCP 工具标成三档，而不是沿用现在的 read/write：
   - `read`：地图、路线、天气、查件、飞猪搜索、航班余票、读书。
   - `order`：会产生真实订单（滴滴叫车、瑞幸下单、麦当劳下单）——**必须在助手回复里先给价格/商品，等用户下一句明确确认才执行**，现有"安全写操作可以直接执行"的规则不适用于它们。
   - `pay`：一律不做，只把二维码/支付链接/唤端链接交给用户。
4. 幂等：MCP 没有 `Idempotency-Key`。下单类工具在网关层用 `requestId` 做本地去重，防止助手重试重复下单。
5. 脱敏：打车/外卖需要真实地址和手机号，和现有 `privacy.mjs` 的占位符机制冲突。建议这档工具在云端模型下**明确不走脱敏**，或只允许本机模型调用。
6. 审计：复用 `recordAudit`，把 MCP 调用一并记进 `agent-audit.json`。
7. 结果截断：地图/酒店返回的 JSON 很大，`MAX_TOOL_RESULT` 现在是 12k 字符，要给 MCP 工具单独做字段裁剪。
8. 工具数量：现在 40 个工具 + 系统提示约 6500 token，Ollama 已需要 32k 上下文。再接高德 17 + 天气 19 + 滴滴 13，工具定义会翻倍，**必须按场景懒加载**（用户问出行才挂 amap/didi，问天气才挂 weather），否则本机小模型会被工具表本身挤爆。

## 六、建议接入顺序

| 阶段 | 接什么 | 理由 | 前置动作 |
| --- | --- | --- | --- |
| 1 | 高德 | 只读、零风险、个人实名即可、覆盖最多场景、`personal_map` 能直接强化旅记 | 高德控制台实名 + 建 Web 服务 Key |
| 2 | 华风爱科天气 | 唯一官方天气 MCP，个人实名 + 500 次/天免费，和日程/行程天然咬合 | platform.weathercn.com 注册拿 key |
| 3 | 飞猪 CLI + 飞常准 | 补齐机酒/火车票，全部只读；飞常有 50 元免费额度可白验 | 淘宝实名拿 FlyAI Key；注册飞常准 |
| 4 | 快递100 | 单一只读能力，接入成本低 | 注册确认个人能否拿 Key |
| 5 | 瑞幸 + 麦当劳 | 都是品牌自建、单端点、个人可自助；支付交给用户，合规风险小 | 两个平台各登一次拿 Token |
| 6 | 微信读书 | Skill 形态，只读，和专注/旅记结合最自然，工作量约 1 天 | 领 `wrk-` Key |
| 7 | 滴滴 | 唯一能全程 API 托管下单的，也最危险 | 先在 sandbox 跑通，再加二次确认闸门 |
| 8 | Aqara | 唯一能真控设备的入口，取决于你有没有对应硬件 | 注册 Aqara Agent 拿 key |
| 长线 | 哈啰顺风车、什么值得买 | 都要商务授权，先递申请 | 商务联系 |
| 暂缓 | 蜜雪/肯德基（等支付宝邀测放开）、美团/大众点评（无开放入口）、百度/腾讯（作高德兜底）、校园/求职/金融/政务（官方为零） | — | — |

## 七、待确认（需要登录控制台才能定论）

- 高德个人认证的准确月配额数值（文档表格渲染错乱，只确认了"1 年免费"）。
- 快递100 个人身份能否开通（后台命名偏企业）。
- 瑞幸 token 的有效期与是否支持多设备。
- 飞猪 5000 次额度用完之后的实际计费（官方文案未写）。
- 支付宝支付 MCP 沙箱的准入条件。
- 华风爱科 500 次/天之外的价格；`weatherwork-consumer-mcp` 是否支持 stdio 之外的托管形态。
- Aqara 免费额度与设备数上限。
- 什么值得买个人能否申请到 Key（需商务沟通）。

## 八、证据

- 高德：[MCP 概述](https://lbs.amap.com/api/mcp-server/summary) / [快速接入](https://lbs.amap.com/api/mcp-server/gettingstarted) / [创建 Key](https://lbs.amap.com/api/mcp-server/create-project-and-key) / [更新日志（SSE 下线）](https://lbs.amap.com/api/mcp-server/changelog) / [配额与定价](https://lbs.amap.com/upgrade)
- 华风爱科：[天气 MCP 开发指南](https://platform.weathercn.com/doc/mcp.html) / [产品中心](https://platform.weathercn.com/products) / [PyPI weatherwork-consumer-mcp](https://pypi.org/project/weatherwork-consumer-mcp/)
- 滴滴：[DiDi MCP Server 开发者文档](https://mcp.didichuxing.com/api) / [控制台](https://mcp.didichuxing.com)
- 瑞幸：[AI 开放平台](https://open.lkcoffee.com/) / [MCP 页](https://open.lkcoffee.com/mcp) / [工具文档](https://open.lkcoffee.com/docs) / [千问 my-coffee skill](https://www.qianwenai.com/hub/skills/@bailian/my-coffee-skill)
- 麦当劳：[MCP 文档](https://open.mcd.cn/mcp/doc) / [GitHub M-China/mcd-mcp-server](https://github.com/M-China/mcd-mcp-server)
- 飞猪：[FlyAI 文档](https://flyai.open.fliggy.com/docs) / [快速开始](https://flyai.open.fliggy.com/docs/quickstart) / [GitHub alibaba-flyai/flyai-skill](https://github.com/alibaba-flyai/flyai-skill) / [npm @fly-ai/flyai-cli](https://www.npmjs.com/package/@fly-ai/flyai-cli)
- 快递100：[MCP 使用说明](https://api.kuaidi100.com/document/how-to-use-mcp-service) / [GitHub kuaidi100-MCP](https://github.com/kuaidi100-api/kuaidi100-MCP)
- 飞常准：[飞友 AI 开放平台](https://ai.variflight.com/zh)
- Aqara：[官方 MCP Server](https://github.com/aqara/aqara-mcp-server/) / [接入文档](https://docs.aqara.com/zh/docs/aqara-studio/set-up-mcp-server/)
- 微信读书：[官方 Skill 页](https://weread.qq.com/r/weread-skills) / [GitHub Tencent/WeChatReading](https://github.com/Tencent/WeChatReading)
- 什么值得买：[海纳开放平台](https://ai.zhidemai.com/)
- 飞书：[远程 MCP 开发文档](https://open.feishu.cn/document/mcp_open_tools/developers-call-remote-mcp-server) / 钉钉：[服务端 API MCP 概述](https://open.dingtalk.com/document/ai-dev/dingtalk-server-api-mcp-overview)
- 支付宝：[支付 MCP 产品介绍](https://opendocs.alipay.com/open/0h3gdq) / [魔搭 mcp-server-alipay](https://www.modelscope.cn/mcp/servers/Alipay/mcp-server-alipay) / [AI 开放平台上线报道](https://www.doit.com.cn/ai/824396301619269.html)
- 蜜雪/肯德基：[支付宝 AI 开放平台首批接入](https://m.leiphone.com/category/industrynews/MlfOVkSb0uNZp7FF.html) / [科技日报](https://www.stdaily.com/web/gdxw/2026-07/08/content_543901.html)
- 美团/点评：[21 经济网：厂商为何不买账 MCP](https://www.21jingji.com/article/20250429/herald/46916d835943a5ac0feb83726cbd0091.html) / [美团×元宝 Agent 对接](https://www.tmtpost.com/8013291.html)
- 饿了么/淘宝：[商家 MCP 文档](https://open.shop.ele.me/base/documents/mcp) / [淘宝闪购 35 个 Server](https://www.ithome.com/0/985/868.htm) / [淘宝 MCP 收费公告](https://open.taobao.com/anno?source=search&docId=25809&docType=12)
- 校园/学术：[学习通社区版](https://github.com/DanMo661/Xuexitong-mcp) / [CNKI 社区版](https://github.com/SepineTam/cnki-mcp) / [实习僧开放平台](https://open.shixiseng.com/)
- 物流：[顺丰丰桥](https://open.sf-express.com/) / [菜鸟](https://open.cainiao.com/) / [极兔](https://open.jtexpress.com.cn/) / [丰巢](https://open.fcbox.com/dev/)
- 医疗：[京东健康开放平台](https://open.healthjd.com/docs/intro/) / [薄荷 API](https://ai.boohee.com/docs/)
- 金融：[同花顺 iFinD MCP](https://mcp.51ifind.com/) / [第三方发票查验](https://fpzwcx.com/apiv1/mcpGuide.html)
- 车/家：[小米澎湃OS MCP 发布指南](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2308) / [华为小艺 MCP 上架](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/intents-kit-listing-mcp-protocol/) / [哈啰顺风车 MCP 报道](https://cn.chinadaily.com.cn/a/202604/07/WS69d4a382a310942cc49a69c3.html)

## 九、本轮接入状态（2026-11-22）

本轮已经把这套调研落成「本机网关可配置的 MCP 接入」，但**没有任何真实 Key，也没有做过真实服务联调**。真实状态以设置页显示为准。

### 已落地

| 模块 | 作用 |
| --- | --- |
| `local-sync/mcpServices.mjs` | 8 家服务目录、工具名前缀、风险档判定、配置合成、状态机 |
| `local-sync/mcpGateway.mjs` | Streamable HTTP MCP 客户端：initialize / tools/list / tools/call、会话缓存、超时、重试、截断、审计、三档闸门 |
| `local-sync/mcpConfig.mjs` | 配置读写（`local-sync/data/mcp-servers.json`）、原子写、脱敏视图、部分更新 |
| `local-sync/server.mjs` | `GET /api/mcp/services`、`PUT /api/mcp/services/:name`、`POST .../probe`、`DELETE .../:name`；保存后重建网关 |
| `local-sync/agentApi.mjs` | 把已启用服务的 MCP 工具合并进助手 manifest；read 直接执行，order 先返回待确认，pay 一律拦下 |
| `src/features/settings/McpServicesPanel.tsx` | 设置页「生活服务」配置区：启停、地址、请求头、三态、测试连接 |
| `src/data/mcpServices.ts` | 前端读配置/保存/探测的客户端与脱敏视图解析 |

### 风险档与确认

- `read`：直接执行，结果按 16k 截断。
- `order`：第一次调用只返回 `pending_confirmation`（含动作摘要与待执行参数）；用户下一句明确确认后，助手才带 `confirmed: true` 与同一 `requestId` 重试；同一 `requestId` 去重，不重复下单。
- `pay`：不执行上游，也不伪造链接；只把上游订单结果里已有的支付链接/二维码交给用户，并提示回官方 App 支付。

### 未配置时

每个服务默认 `enabled: false`、地址为空；设置页显示「未配置」，助手拿不到该服务的工具。填地址/请求头并启用后，保存即重建网关；「测试连接」会真正 `tools/list` 一次并显示工具数。

### 需要你自己申请的 Key（代码里只登记变量名）

| 服务 | 变量名 | 说明 |
| --- | --- | --- |
| 高德地图 | `AMAP_WEB_KEY` | 高德控制台建「Web 服务」Key，个人实名即可 |
| 华风爱科天气 | `WEATHERCN_OPENAPI_KEY` | 官方只有 stdio；需要自建 HTTP 桥后填桥地址 |
| 飞猪 | `FLYAI_API_KEY` + CLI 路径 | 只做 CLI 存在性检测，不自动安装、不执行 |
| 飞常准 | `VARIFLIGHT_KEY` | ai.variflight.com 注册 |
| 快递100 | `KD100_KEY` | 只查不寄 |
| 滴滴 | `DIDI_MCP_KEY` | 默认用 sandbox 端点；真实下单要用户确认 |
| 瑞幸 | `LUCKIN_MCP_TOKEN` | 到店自取，只有支付二维码交给用户 |
| 麦当劳 | `MCD_MCP_TOKEN` | 下单返回支付链接，用户自己付 |

### 验证

```bash
node --test-isolation=none --test local-sync/mcpGateway.test.mjs local-sync/mcpConfig.test.mjs local-sync/mcpWiring.test.mjs
npx tsc --noEmit
```

本环境 `npm test` / `npm run build` 因 node 派生子进程被禁（esbuild `spawn EPERM`）跑不了，只能跑 `node:test` 单进程模式与 `tsc`。真实 MCP 连通性需要你填 Key 后在设置页「测试连接」验证。
