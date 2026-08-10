from sqlalchemy import Column, Integer, String, Boolean, DateTime
from app.core.timeutils import get_current_time
from app.core.database import Base


class FastClawAgentConfig(Base):
    """FastClaw Agent 配置（连接 FastClaw 运行时所需的接入参数）。

    - base_url: FastClaw 服务地址（如 http://127.0.0.1:8787）
    - api_key: 明文存储于数据库，对外响应一律只返回 has_api_key 布尔标记
    - agent_id: FastClaw 中可调用的 agent 标识（agt_...）
    - 同一节点模板通过 NodeConfig.agent_config_id 绑定，与「提示词+大模型」模式互斥
    """

    __tablename__ = "fastclaw_agent_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # FastClaw agent 的真实名字（AgentRecord.name，如 "Xulei"），由「拉取」选择或
    # admin 列表懒解析回填；供画布节点 / 阶段配置等界面展示可读名字（agent_id 不可读）
    agent_name = Column(String, default="", nullable=False)
    base_url = Column(String, default="", nullable=False)
    api_key = Column(String, default="", nullable=False)
    agent_id = Column(String, default="", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
