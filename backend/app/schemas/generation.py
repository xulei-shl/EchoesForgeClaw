from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Any, Dict, List, Optional


class GenerationCreate(BaseModel):
    """创建生成记录的请求体。"""

    module: str = "bookplate"
    stage_results: Dict[str, Any] = {}
    final_image_url: Optional[str] = ""
    status: str = "completed"


class GenerationOut(BaseModel):
    """生成记录响应（is_favorited / is_public / username 由接口计算填充）。"""

    id: int
    module: str
    name: str = ""
    stage_results: Dict[str, Any]
    final_image_url: Optional[str]
    status: str
    created_at: datetime
    is_favorited: bool = False
    is_public: bool = False
    username: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class GenerationIdAction(BaseModel):
    """收藏 / 公开接口的请求体。"""

    generation_id: int


class GenerationPage(BaseModel):
    """列表接口的分页响应信封。"""

    items: List[GenerationOut]
    total: int
    skip: int = 0
    limit: int = 20
