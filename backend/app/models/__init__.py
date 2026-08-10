# models package
# 集中导入所有模型，保证 Base.metadata.create_all 能创建全部表
from app.models.user import User
from app.models.generation import Generation
from app.models.favorite import Favorite
from app.models.public_share import PublicShare
from app.models.llm_config import LLMConfig
from app.models.prompt_template import PromptTemplate
from app.models.node_config import NodeConfig
from app.models.app_setting import AppSetting
from app.models.fastclaw_agent_config import FastClawAgentConfig
