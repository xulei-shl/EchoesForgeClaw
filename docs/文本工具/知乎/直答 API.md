# 直答 API

## 接口说明

该接口提供知乎直答 3 个模型档位：快速回答、深度思考、智能思考。

当前支持 3 个请求字段：

- `model`
- `messages`
- `stream`

## 接口信息

| 说明        | 值                                                           |
| :---------- | :----------------------------------------------------------- |
| HTTP URL    | `https://developer.zhihu.com/v1/chat/completions`            |
| HTTP Method | `POST`                                                       |
| 请求类型    | `application/json`                                           |
| 响应类型    | `application/json`（`stream=false`） / `text/event-stream`（`stream=true`） |

## 鉴权

Header：

- `Authorization: Bearer <your_access_secret>`
- `X-Request-Timestamp: <unix_seconds>`

说明：

- 当前统一使用 Access Secret 的 Bearer 鉴权语义。
- `X-Request-Timestamp` 为秒级 Unix 时间戳。

## 请求参数

### Body

| 名称       | 类型           | 必填 | 说明                                                         |
| :--------- | :------------- | :--- | :----------------------------------------------------------- |
| `model`    | String         | 是   | 模型档位，支持 `zhida-fast-1p5`、`zhida-thinking-1p5`、`zhida-agent` |
| `messages` | Array[Message] | 是   | 对话消息列表                                                 |
| `stream`   | Bool           | 否   | 是否流式返回，默认 `false`                                   |

Message：

| 名称      | 类型   | 必填 | 说明     |
| :-------- | :----- | :--- | :------- |
| `role`    | String | 是   | 消息角色 |
| `content` | String | 是   | 问题内容 |

## 响应说明

### 非流式（`stream=false`）

```json
{
  "id": "chatcmpl-xxxx",
  "object": "chat.completion",
  "created": 1740470400,
  "model": "zhida-thinking-1p5",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "reasoning_content": "先给出分析过程...",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ]
}
```

### 流式（`stream=true`）

```text
data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","created":1740470400,"model":"zhida-thinking-1p5","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"先分析背景"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","created":1740470400,"model":"zhida-thinking-1p5","choices":[{"index":0,"delta":{"content":"最终回答片段"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","created":1740470400,"model":"zhida-thinking-1p5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

说明：

- 服务端会发送心跳注释：`: keep-alive`

## 错误响应

```json
{
  "error": {
    "message": "xxx",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

流式中途错误（HTTP 200 已发出）返回：

```text
data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","created":1740470400,"model":"zhida-thinking-1p5","choices":[{"index":0,"delta":{},"finish_reason":"error"}],"error":{"message":"Internal server error","type":"server_error","code":"internal_error"}}

data: [DONE]
```

## 注意事项

1. 当前仅保证 `model/messages/stream` 三个字段的能力语义。
2. 其他请求字段当前不作为正式支持能力，不保证生效。
3. `id` 在同一次流式响应中保持一致。
4. `model` 为必填，缺失时返回 `missing_required_parameter`。
5. 支持 role、content 上下文传参的模型：`zhida-fast-1p5`、`zhida-thinking-1p5`。
6. 实际可用模型还会受租户授权配置影响。