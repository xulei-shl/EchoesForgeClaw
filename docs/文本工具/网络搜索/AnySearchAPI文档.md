# AnySearch API 文档

AI 统一搜索基础设施

API Base URL`https://api.anysearch.com`

```
# 注意：通过 MCP / Skill 方式使用时，AI 代理会自动处理参数路由。直接调用 API 时，开发者需根据使用场景手动填写合适的 tag 和 params，以获得最佳搜索效果。

curl -X POST https://api.anysearch.com/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Go 1.26 release notes",
    "tag": "code.doc",
    "params": {"library": "golang"},
    "max_results": 10
   }' 
```

```
# 注意：通过 MCP / Skill 方式使用时，AI 代理会自动处理参数路由。直接调用 API 时，开发者需根据使用场景手动填写合适的 tag 和 params，以获得最佳搜索效果。

curl -X POST https://api.anysearch.com/v1/search \
  -H "Authorization: Bearer YOUR_ANYSEARCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Go 1.26 release notes",
    "tag": "code.doc",
    "params": {"library": "golang"},
    "max_results": 10
  }'  
```

## 认证

AnySearch 搜索 API (/v1/*) 支持灵活的认证策略，您可以根据业务阶段选择是否携带 API Key：

调用方式   Header      格式额度与限流规则

匿名调用  不提供 Authorization 头      按客户端 IP 维度进行限流，并消耗每日免费额度 (Daily Free Quota)

认证调用   Authorization: Bearer YOUR_ANYSEARCH_API_KEY       按 API Key 绑定的付费额度计费，享有更高的并发限流阈值

注意：如果您在请求中携带了 Authorization 头但 Key 非法、已禁用或已过期，系统将返回 401 Unauthorized 或 403 Forbidden，而不会降级为匿名调用。

## API 接口

POST /v1/search

统一搜索接口。根据查询意图自动路由至最佳数据源，并对结果进行融合排序。

可选 API Key 认证（匿名按 IP 限流并消耗每日免费额度）

请求参数

query string 必选 搜索查询

max_results int 非必选  返回结果数量，例如 10，默认 10，范围 1–20

tag string 非必选   子域能力标签，单个值，格式为 {domain}.{sub_domain}，例如 "code.doc"

zone string  非必选地区，取值为 cn 或 intl

language string  非必选  偏好语言，例如 zh-CN 或 en

params  object  非必选   透传给 AnyMix 的扩展参数，例如 {"ticker": "AAPL"}

format string  非必选  输出格式，取值为 json 或 markdown

```
curl -X POST https://api.anysearch.com/v1/search \
  -H "Authorization: Bearer YOUR_ANYSEARCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Go 1.26 release notes",
    "max_results": 10
  }'
```

```
curl -X POST https://api.anysearch.com/v1/search \
  -H "Authorization: Bearer YOUR_ANYSEARCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Go 1.26 release notes",
    "tag": "code.doc",
    "params": {"library": "golang"},
    "max_results": 10
  }
```





## 响应格式

成功的 200 请求会返回包含 results 数组和 metadata 的 JSON 结构。

Results 字段说明

title (string)结果标题

url (string)原始来源 URL

snippet (string)简短摘要

content (string)清洗后的正文内容



Metadata 字段说明

total_results (int)返回的结果总数

search_time_ms (int)搜索总耗时（毫秒）

完整响应示例

```
{
  "code": 0,
  "message": "success",
  "request_id": "a035db5c-2380-4c1d-900d-15c3d1f41a5a",
  "data": {
    "results": [
      {
        "title": "Go 1.26 Release Notes",
        "url": "https://go.dev/doc/go1.26",
        "snippet": "Go 1.26 is a major release...",
        "content": "Detailed content here..."
      }
    ],
    "metadata": {
      "total_results": 10,
      "search_time_ms": 946
    }
  }
}
```

错误响应示例

```
{
    "code": -1,
    "message": "Missing required params for tag 'code.doc': library.",
    "request_id": "a035db5c-2380-4c1d-900d-15c3d1f41a5a",
}
```



## 错误码

所有错误响应均包含 request_id 字段。429 响应额外包含 Retry-After 和 X-RateLimit-* 响应头。

400invalid_request请求体非法、query 为空、tag / zone / format等字段值非法

400invalid_extract_urlextract 工具的 url 缺失、scheme 非 http/https、URL 解析失败、缺少 host

401invalid_api_keyAPI Key 不存在、已禁用、未绑定账号或账号缺失

401invalid_auth_headerAuthorization 头格式不合法（不是 Bearer xxx 形式）

402daily_free_quota_exhausted匿名 IP 当日免费额度已用尽；响应中会带自动注册账号信息（username / password / api_key），可直接使用该 Key 继续调用

402quota_exhaustedAPI Key 或账号当前周期付费额度已用尽，data 含 quota_limit / quota_used / quota_remaining

402user_daily_quota_exhausted注册用户当日免费额度已用尽，且账号未购买付费额度，需等次日重置或购买套餐

403expired_api_keyAPI Key 已过期

403private_capability_not_enabled当前 API Key 未启用所请求的私有 capability，需联系运营开通

403account_disabledAPI Key 关联账号已被禁用

415extract_unsupported_contentextract 目标响应 Content-Type 不是 text/html

429rate_limit_exceeded_user账号维度聚合限流（同一账号下所有 Key 合并计算）触发

429rate_limit_exceeded单个 API Key 或匿名 IP 维度限流触发，data 含 retry_after / limit / remaining / reset_at

500internal_error服务端内部错误，可重试

502extract_fetch_failedextract 抓取失败：DNS / TCP / TLS / 读 body / 解析 HTML 等层面错误（非超时）

502extract_upstream_errorextract 目标站返回非 2xx HTTP 响应

503quota_check_failed额度检查依赖暂不可用，建议短暂退避后重试

503guard_evaluate_failedGuard 评估阶段依赖（KeyStore / 限流器等）返回错误，建议短暂退避后重试

503capability_temporarily_unavailable所请求的能力（含底层插件后端）暂时不可用，建议退避重试

503service_unavailable服务暂时不可用，建议退避重试

504extract_timeoutextract 抓取超时（默认 30s 上限）