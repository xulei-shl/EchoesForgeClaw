from datetime import datetime
from zoneinfo import ZoneInfo

# 定义统一的上海时区
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")

def get_current_time() -> datetime:
    """
    获取当前的上海时间，所有涉及到时间的地方都应该调用此方法
    以保证时区的一致性
    """
    return datetime.now(SHANGHAI_TZ)
