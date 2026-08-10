from sqlalchemy import Column, Integer, String, Boolean, DateTime
from app.core.timeutils import get_current_time
from app.core.database import Base


class FastClawAgentConfig(Base):
    """FastClaw Agent 配置（连接 FastClaw 运行时所需的接入参数）。

    - base_url: FastClaw 服务地址（如 http://127.0.0.1:8787）
    - api_key: 明文存储于数据库，对外响应一律只返回 has_api_key 布尔标记
    - agent_id: FastClaw 中可调用的 agent 标识（agt_...）
    - 同一 (module, stage) 通过 StageConfig.agent_config_id 绑定，与「提示词+大模型」模式互斥
    """

    __tablename__ = "fastclaw_agent_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    base_url = Column(String, default="", nullable=False)
    api_key = Column(String, default="", nullable=False)
    agent_id = Column(String, default="", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
