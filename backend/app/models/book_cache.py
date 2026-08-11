from sqlalchemy import Column, Integer, String, Float, DateTime
from app.core.timeutils import get_current_time
from app.core.database import Base


class BookCache(Base):
    """豆瓣 ISBN 检索结果缓存表。

    将豆瓣 API 返回的图书元数据持久化，相同 ISBN 二次检索时直接读库，
    减少对豆瓣 API 的请求（降低限流/反爬风险）。字段与 douban_client 的
    `map_book_payload()` 输出一一对应，读写无需额外转换。

    - isbn 唯一：作为查重键，并发检索时通过唯一约束 + IntegrityError 兜底，
      避免不同用户同时检索写入重复数据。
    - cover_image: 豆瓣原始封面 URL（供 JSON 下载 / 归档使用）
    - cover_image_local: 本地已缓存封面的静态路径（/static/covers/...），
      为空表示尚未下载成功；由后台任务补图后回写。
    """
    __tablename__ = "book_cache"

    id = Column(Integer, primary_key=True, index=True)
    isbn = Column(String, unique=True, index=True, nullable=False)

    title = Column(String, default="", nullable=False)
    subtitle = Column(String, default="", nullable=False)
    original_title = Column(String, default="", nullable=False)
    author = Column(String, default="", nullable=False)
    translator = Column(String, default="", nullable=False)
    publisher = Column(String, default="", nullable=False)
    producer = Column(String, default="", nullable=False)
    pub_year = Column(String, default="", nullable=False)
    pages = Column(String, default="", nullable=False)
    price = Column(String, default="", nullable=False)
    binding = Column(String, default="", nullable=False)
    series = Column(String, default="", nullable=False)
    series_link = Column(String, default="", nullable=False)
    rating = Column(Float, default=0.0, nullable=False)
    rating_count = Column(Integer, default=0, nullable=False)
    cover_image = Column(String, default="", nullable=False)
    cover_image_local = Column(String, default="", nullable=False)
    summary = Column(String, default="", nullable=False)
    author_intro = Column(String, default="", nullable=False)
    catalog = Column(String, default="", nullable=False)
    url = Column(String, default="", nullable=False)

    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)