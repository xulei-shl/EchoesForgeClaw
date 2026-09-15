# 企业微信通知设置 — 功能与实现参考

> 复用来源项目：SDI-CNKI（学术定题服务系统）
> 本文档提炼「通知设置」Tab 的功能设计 + 实际代码关键逻辑，供其他项目快速复用参考。

---

## 一、功能概述

通知采用**企业微信群机器人 Webhook**（Markdown 消息）实现，定位为「任务阶段/完成/失败」的异步事件通知，而非站内信。

### 核心设计要点

| 要点 | 说明 |
|------|------|
| **配置粒度** | 每用户独立配置一条 Webhook URL + 启用开关（`user_notification_configs`，`user_id` 唯一） |
| **不进行 URL 去重** | 不同账号可配置相同 Webhook（如加入同一个群），各自独立发送，消息正文含「用户名 + 任务名」以区分 |
| **发送归属** | Worker 根据任务实例的 `creator_id` 查找该用户的配置；仅当 `enabled=true` 且 `webhook_url` 非空时才发送 |
| **失败不阻断主流程** | 通知发送包裹在最外层 try/except 中，任何异常（网络、HTTP 错误）仅记录日志，绝不抛出，不影响检索/分析/下载主任务 |
| **超时控制** | 发送请求 `httpx.AsyncClient(timeout=10)`，避免阻塞 Worker |
| **消息类型** | 固定 `msgtype: "markdown"`，使用企业微信 Markdown 子集 |

### 通知触发场景（实际代码）

| 场景 | 触发位置 | stage 值 | status |
|------|----------|----------|--------|
| 检索完成 | `app/worker/cnki_worker.py` | `检索` | `search_completed` |
| 检索失败 | `app/worker/cnki_worker.py` | `检索` | `failed`（`error_message`） |
| 分析完成 | `app/worker/llm_worker.py` | `分析` | `analyzing_completed` |
| 分析失败 | `app/worker/llm_worker.py` | `分析` | `failed` |
| 下载完成 | `app/worker/download_worker.py` | `下载` | `completed` |
| 下载失败 | `app/worker/download_worker.py` | `下载` | `failed` |

> ⚠️ **已知实现瑕疵（复用前建议修正）**：`cnki_worker.py` 在检索完成分支对 `send_notification` **重复调用了两次**（约 253-270 行与 271-288 行完全相同的 payload），会导致用户收到两条重复检索通知。复用时删除其一。

---

## 二、数据模型

### 表 `user_notification_configs`（每用户一条）

```python
# app/models/user_notification_config.py
class UserNotificationConfig(Base):
    __tablename__ = "user_notification_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                     unique=True, nullable=False, index=True)
    webhook_url = Column(Text, nullable=True)
    enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=timezone.now,
                        server_default=text("(datetime('now', 'localtime'))"), nullable=False)
    updated_at = Column(DateTime, default=timezone.now, onupdate=timezone.now,
                        server_default=text("(datetime('now', 'localtime'))"), nullable=False)

    user = relationship("User", backref="notification_config")
```

关键点：
- `user_id` 加 `unique=True` 约束，保证「一用户一配置」，更新时使用 upsert 语义（先查后建）。
- 外键 `ondelete="CASCADE"`：删除用户时配置自动清理。
- `webhook_url` 允许为 `NULL`，代表未配置（跳过通知）。

### 数据库迁移（Alembic）

```python
# alembic/versions/005_add_user_notification_configs.py
def upgrade() -> None:
    op.create_table(
        "user_notification_configs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(),
                  sa.ForeignKey("users.id", ondelete="CASCADE"),
                  unique=True, nullable=False, index=True),
        sa.Column("webhook_url", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(),
                  server_default=sa.text("(datetime('now', 'localtime'))"), nullable=False),
        sa.Column("updated_at", sa.DateTime(),
                  server_default=sa.text("(datetime('now', 'localtime'))"), nullable=False),
    )
```

---

## 三、后端接口

### 3.1 用户自助配置（任意登录用户）

前缀 `/api/v1/user`，路由文件 `app/routers/user_notification_config.py`。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET`  | `/notification-config` | 获取当前用户配置，无记录返回 `{webhook_url: null, enabled: false}` |
| `PUT`  | `/notification-config` | 更新当前用户配置（upsert），仅更新传入字段 |
| `POST` | `/notification-config/test` | 用指定 URL 发送一条测试 Markdown 消息，校验配置有效性 |

```python
class NotificationConfigUpdate(BaseModel):
    webhook_url: str | None = None
    enabled: bool | None = None

@router.put("/notification-config")
async def update_notification_config(
    data: NotificationConfigUpdate,
    current_user = Depends(get_current_user_from_header),
    db: AsyncSession = Depends(get_db),
):
    config = (await db.execute(
        select(UserNotificationConfig)
        .where(UserNotificationConfig.user_id == current_user.id)
    )).scalar_one_or_none()
    if not config:
        config = UserNotificationConfig(user_id=current_user.id)
        db.add(config)
    if data.webhook_url is not None:
        config.webhook_url = data.webhook_url.strip() if data.webhook_url else None
    if data.enabled is not None:
        config.enabled = data.enabled
    await db.commit()
    return {"webhook_url": config.webhook_url, "enabled": config.enabled}
```

`PUT` 语义注意：用 `is not None` 判断，允许前端显式传 `null` 清空 URL / 关闭开关，同时不影响未传字段。

**测试接口**：直接向后端 `webhook_url` POST 一条固定测试消息，返回成功/失败。注意测试消息**不经过** `user_notification_configs` 表（独立使用传入 URL），因此测试不会污染用户配置。

### 3.2 管理员查看所有用户配置

前缀 `/api/v1/admin`，路由文件 `app/routers/admin_notification_configs.py`。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET`  | `/user-notification-configs` | 列出所有用户及其通知配置（左外连接） |

```python
stmt = (
    select(User, UserNotificationConfig)
    .outerjoin(UserNotificationConfig, User.id == UserNotificationConfig.user_id)
    .order_by(User.username)
)
# 映射到 {user_id, username, email, role, is_active, webhook_url, enabled, updated_at}
```

管理员**只读**（无编辑/测试接口），编辑权仅限各用户本人。

### 3.3 全局 Webhook 配置（遗留/备选）

系统配置表 `system_configs` 中存在键 `webhook_enterprise_wechat`（管理员在「系统设置」配置，含 `/test` 端点）。**但当前 `send_notification` 实现并未读取该全局键** —— 实际发送仅依赖每用户 `user_notification_configs`。

> 复用建议：若希望「全局兜底 + 每用户覆盖」两级策略，可在 `load_webhook_url` 中增加：用户未配置时回退到系统全局 Webhook。

---

## 四、核心服务逻辑（可直接复用）

文件：`app/services/wecom_notifier.py`

### 4.1 入口 `send_notification`

```python
async def send_notification(db, instance_data: dict, user_id: int | None = None) -> None:
    try:
        if user_id is None:
            user_id = instance_data.get("user_id")
        if not user_id:
            logger.info("未指定用户，跳过通知"); return

        webhook_url = await load_webhook_url(db, user_id)
        if not webhook_url:
            logger.info(f"用户 {user_id} 未配置 Webhook，跳过通知"); return

        instance_id = instance_data.get("instance_id")
        if instance_id:
            instance_data["detail_stats"] = await _compute_detailed_stats(db, instance_id)

        markdown_content = _build_markdown(instance_data)
        payload = {"msgtype": "markdown", "markdown": {"content": markdown_content}}

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code != 200:
                logger.error(f"企微通知发送失败: HTTP {resp.status_code} {resp.text}")
            else:
                logger.info("企微通知发送成功")
    except Exception as e:
        logger.error(f"企微通知异常（已忽略）: {e}")
```

复用要点：
1. **最外层 try/except 吞掉所有异常** —— 通知是「尽力而为」的旁路，绝不可影响主业务。
2. **user_id 解析优先级**：显式传参 > `instance_data["user_id"]`；缺失直接跳过。
3. **仅查库取 URL，不传敏感信息出服务边界**。

### 4.2 加载 Webhook

```python
async def load_webhook_url(db, user_id: int) -> Optional[str]:
    result = await db.execute(
        select(UserNotificationConfig).where(
            UserNotificationConfig.user_id == user_id,
            UserNotificationConfig.enabled == True,   # 关键：enabled 才发送
        )
    )
    config = result.scalar_one_or_none()
    if config and config.webhook_url:
        return config.webhook_url.strip()
    return None
```

### 4.3 详细统计（可选增强）

`_compute_detailed_stats(db, instance_id)` 在通知发送前，实时聚合该实例的：
- LLM 分析：已完成 / 通过 / 拒绝 / 失败（从 `parsed_result` JSON 中解析 `is_relevant` 或 `is_target_topic`）
- 人工审核：通过 / 拒绝（按 `task_results.is_passed`）
- 下载：成功 / 失败（按 `download_results.download_status` 分组计数）

> 若不想耦合具体业务表，可在调用 `send_notification` 时直接传入 `stats` 的 `total/valid/duplicate/analyzed/downloaded` 字段，服务会优先使用 `detail_stats`，缺失时回退到 `stats`。

### 4.4 Markdown 消息模板

```python
def _build_markdown(instance_data: dict) -> str:
    status = instance_data.get("status", "")
    is_failure = status == "failed"
    status_icon = "❌" if is_failure else "✅"
    status_text = "失败" if is_failure else "完成"
    stats = instance_data.get("stats", {})
    detail = instance_data.get("detail_stats", {})

    parts = [
        f"## 📋 {stage}{'失败' if is_failure else '完成'}通知\n",
        f"**任务名称**: {instance_data.get('meta_task_name', '-')}",
        f"**执行用户**: {instance_data.get('username', '-')}",
        f"**任务编号**: {instance_data.get('instance_no', '-')}",
        f"**执行状态**: {status_icon} {status_text}",
        f"**执行时间**: {instance_data.get('started_at', '-')} ~ {instance_data.get('completed_at', '-')}\n",
        "**数据统计**：",
    ]
    if is_failure:
        parts.append(f"> 失败原因：{instance_data.get('error_message', '未知错误')}")
    else:
        parts.append(f"- 检索总数：{stats.get('total', 0)} 条")
        parts.append(f"- 有效数据：{stats.get('valid', 0)} 条  （去重 {stats.get('duplicate', 0)} 条）")
        if detail:
            parts.append(f"- **LLM分析**：已完成 {detail.get('llm_completed', 0)}"
                         f"（通过 {detail.get('llm_passed', 0)}/拒绝 {detail.get('llm_rejected', 0)}）"
                         f" 失败 {detail.get('llm_failed', 0)}")
            parts.append(f"- **人工审核**：通过 {detail.get('manual_passed', 0)} / 拒绝 {detail.get('manual_rejected', 0)}")
            parts.append(f"- **下载**：成功 {detail.get('download_success', 0)} / 失败 {detail.get('download_failed', 0)}")
        else:
            parts.append(f"- 分析完成：{stats.get('analyzed', 0)} 条")
            parts.append(f"- 下载成功：{stats.get('downloaded', 0)} 条")
    return "\n".join(parts)
```

消息正文要素：**任务名 + 执行用户名 + 任务编号 + 状态图标 + 起止时间 + 分阶段统计**，失败场景额外展示 `error_message`。这保证了不同账号相同 Webhook 时也能区分来源。

---

## 五、前端「通知设置」Tab 应包含的 UI（本项目前端尚未实现，基于接口推断）

| 区块 | 元素 | 绑定接口 |
|------|------|----------|
| Webhook 输入 | 文本框（URL） | `GET/PUT /api/v1/user/notification-config` |
| 启用开关 | Switch（`enabled`） | 同上 |
| 保存按钮 | 提交 PUT | 同上 |
| 测试按钮 | 调起 `POST /notification-config/test`，传入当前文本框 URL | 测试用独立 URL，不依赖已保存配置 |
| 配置说明 | 提示「群机器人 Webhook 地址」 | — |

测试按钮交互建议：点击时用当前输入框 URL 直接测试，不要先保存再测，降低误操作。

---

## 六、复用 Checklist

- [ ] 建表 `user_notification_configs`（`user_id` unique + 外键级联删除）
- [ ] 编写 Alembic 迁移
- [ ] 实现 `load_webhook_url`（带 `enabled` 过滤）
- [ ] 实现 `send_notification`（**最外层 try/except 吞异常** + `httpx timeout=10`）
- [ ] 实现 `build_markdown`（含失败 `error_message` 分支）
- [ ] 在 Worker 各阶段完成/失败处调用，传入 `user_id` / `instance_id` / `stage` / `status` / `stats`
- [ ] 提供用户自助 `GET/PUT/POST test` 接口 + 管理员只读列表接口
- [ ] 修复 `cnki_worker` 检索完成重复发送问题（如沿用本项目代码）
- [ ] （可选）`load_webhook_url` 增加全局 `system_configs.webhook_enterprise_wechat` 兜底回退
