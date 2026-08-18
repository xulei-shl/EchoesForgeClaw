# Paris Musées（巴黎博物馆）API 使用分析

> 面向「艺术图片检索 (GLAM)」节点后端 `glam-search-service.ts` 的 Paris Musées 接入，
> 重点是部署到服务器前的**鉴权与出口 IP** 注意事项。
> 参考对接实现：`docs/GLAM/museo-main/api/paris.js`（本项目 `searchParis` 与之完全一致）。

---

## 1. 基本事实

| 项目 | 内容 |
|---|---|
| 服务商 | Paris Musées（巴黎市立 14 家博物馆联合馆藏） |
| API 地址 | `http://apicollections.parismusees.paris.fr/graphql`（注意：**HTTP 非 HTTPS**） |
| 协议 | GraphQL（POST，body 为 `{ "query": "..." }`） |
| 鉴权方式 | 请求头 `auth-token: <token>` + `Content-Type: application/json` |
| 官方文档 | https://apicollections.parismusees.paris.fr/ |
| 获取入口 | 官网「Créer un nouveau compte」注册账号 → 登录后生成 token |
| 项目配置键 | 管理端「系统设置」→ `paris.api_key`（敏感，掩码显示） |

### 鉴权验证（重要）

同一 GraphQL 端点，**无 `auth-token` 或 token 无效时返回 HTTP 403**（内容为 Drupal 的 HTML 拒绝页）；
**token 有效时返回 200 + JSON 数据**。403 与 JSON 是同一端点的两种状态，不要误认为是域名/网络问题。

---

## 2. 项目内接入点

后端：`backend-ts/src/services/glam-search-service.ts`

- `searchParis(apiKey, query, limit)`：组装 GraphQL 查询，POST 到上述端点，带 `auth-token` 头（约 468–506 行）
- key 读取：`/api/modules/bookplate/glam-providers` 与 `/api/modules/bookplate/glam-search` 路由
  从系统设置 `paris.api_key` 读出（`router.ts` 836、865 行；内部会 `.trim()`）
- 未配置 key 时：不在可用来源列表、聚合模式自动跳过，单源检索给出「未配置」指引而非 403
- GraphQL 查询要点（与官方 explorer 一致）：
  - 过滤条件：`type=oeuvre`、`field_visuels` 非空、`field_visuels.entity.field_image_libre=1`（仅 CC0 自由图）
  - 标题模糊匹配：`{ field: "title", value: "%关键词%", operator: LIKE }`（空关键词 = `%%` ≈ 随机浏览）
  - 无分页（GraphQL `limit` 上限 100，后端取 `min(limit*3, 100)` 再 `slice(0, limit)`）

---

## 3. 常见问题：HTTP 403

### 症状
节点选择 Paris Musées 后报错「Paris Musées 请求失败（HTTP 403）」。

### 排查路径（已实测）

| 检查项 | 结论 |
|---|---|
| `paris.api_key` 存储值（读 DB） | 与用户配置一致、36 位 UUID、无多余空格 |
| 本机带 key 直连 GraphQL（PowerShell / Node fetch） | **200** |
| 完整复刻后端查询（含空词 `%%`、含关键词） | **200** |
| 不带 key 请求同一端点 | **403**（HTML 拒绝页） |
| 运行中后端 `POST /glam-search {provider:'paris'}` | **200**，返回作品与图片 |

### 根因
**token 与「申请/生成它的出口 IP」绑定（或存在对机房/数据中心 IP 的区域/反爬限制）。**
同一把 key，在注册它的网络环境里可用；换一台服务器（出口 IP 不同）或走了代理/VPN，
请求特征与我方 key 绑定信息不一致，就被拒绝返回 403。
类似的还有 AIC（`www.artic.edu/iiif` 对国内直连与数据中心代理出口均 403，
见前端 `ArtImageSearchNode.tsx` 中 `HIDDEN_GLAM_SOURCES` 注释）。

> 官方 CGU 未明文写死「IP 绑定」，但实测与社区实践均指向：token 的可达性跟随注册时的网络环境。

### 快速验证命令（部署机上执行）

```bash
curl -X POST 'http://apicollections.parismusees.paris.fr/graphql' \
  -H 'Content-Type: application/json' \
  -H 'auth-token: 你的key' \
  -d '{"query":"{ nodeQuery(filter:{conditions:[{field:\"type\",value:\"oeuvre\"}]},limit:1){entities{... on NodeOeuvre{title}}}}"}'
```

- 返回 JSON = key 有效；
- 返回 HTML 403 = 出口 IP 不被该 key 接受。

---

## 4. 部署到服务器时的注意事项

### 4.1 最优做法：在目标网络重新生成 key

1. 在服务器（或其所属网络/出口 IP）上访问 https://apicollections.parismusees.paris.fr/
   登录原有账号，重新生成一个新的应用 token。
   **不要沿用在本机/家宽环境下申请的 key**——它大概率在服务器上 403。
2. 用第 3 节的 curl 在**服务器本机**验证新 key 返回 200。
3. 将新 key 写入管理端「系统设置」→ `paris.api_key`，重新检索 Paris Musées 验证。

### 4.2 兜底：出网代理（若服务器出口 IP 不受 key 绑定或需要固定出口）

若服务器本身没有可用出口，或目标 IP 随时会变，可为 GLAM 检索增加可配置 HTTP 代理
（方案参考现有 `douban.proxy` 设置项的做法）：

- 在 `glam-search-service.ts` 的 Paris（及其他需要代理的来源）fetch 前套用代理；
  Node 原生 `fetch` 无内置代理，需要用 `undici` 的 `ProxyAgent` 或 `https-proxy-agent`。
- 让代理出口 IP 与申请 key 时的 IP 保持一致，即可稳定生效。
- 影响面：`searchParis`（单源）与 `provider='all'` 聚合检索都会走到这里，需一起覆盖。

### 4.3 部署自检清单

- [ ] 服务器能访问 `apicollections.parismusees.paris.fr`（80 端口，非 443）
- [ ] 已在**服务器网络**重新生成 token 并在服务器本机 curl 验证 200
- [ ] `paris.api_key` 已更新为服务器环境可用的 key（掩码界面下注意不要因「留空=不修改」误存空值）
- [ ] `GET /glam-providers` 返回的 providers 含 `paris`
- [ ] 画布节点单源检索 Paris Musées 返回作品图；「全部来源」聚合下不再出现 Paris 403

---

## 5. 已知边界

- 无分页：Paris 不支持 offset，「加载更多」不会出现（`NO_PAGINATION_PROVIDERS` 含 `paris`）。
- 字段约束：`field_image_libre=1` 只出 CC0 图，符合「公有领域可商用」选图原则。
- token 语义官方未承诺绑定 IP，若遇反爬加强，预期行为仍以「注册环境可用」为准。