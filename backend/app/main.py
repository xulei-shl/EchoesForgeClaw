import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from alembic.config import Config
from alembic import command

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logging.getLogger("app.services.llm_service").setLevel(logging.INFO)
from app.core.database import SessionLocal
# 导入 models 包以注册全部表（User / Generation / Favorite / PublicShare）
from app import models  # noqa: F401
from app.models.user import User
from app.core.security import get_password_hash
from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.generations import router as generations_router
from app.api.favorites import router as favorites_router
from app.api.public import router as public_router
from app.api.admin.llm_configs import router as admin_llm_configs_router
from app.api.admin.prompts import router as admin_prompts_router
from app.api.admin.node_configs import router as admin_node_configs_router
from app.api.admin.settings import router as admin_settings_router
from app.api.admin.fastclaw_agents import router as admin_fastclaw_agents_router
from app.modules.bookplate.router import router as bookplate_router
from app.models.app_setting import AppSetting
from app.models.prompt_template import PromptTemplate
from app.services.llm_service import DEFAULT_SYSTEM_PROMPT, DEFAULT_COVER_SYSTEM_PROMPT
import asyncio
import contextlib

# 默认系统设置（首次启动时写入）
DEFAULT_SETTINGS = {
    "douban.base_url": (
        "https://m.douban.com/rexxar/api/v2/book/isbn",
        "豆瓣 API 基础地址（一般无需修改）",
    ),
    "douban.qps": ("0.5", "豆瓣请求速率（次/秒），建议 ≤ 0.5 以防反爬"),
    "douban.proxy": ("", "豆瓣请求 HTTP 代理，如 http://127.0.0.1:7890（留空不使用）"),
}


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时执行数据库迁移与种子数据初始化（阻塞型操作，放到线程中执行，
    # 避免在运行中的事件循环里直接调用导致死锁/卡死）
    await asyncio.to_thread(_startup_init)

    yield
    # 关闭时的清理操作


def _startup_init():
    # 启动时执行数据库迁移（Alembic）：全新库自动建表，老库执行增量迁移
    alembic_cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")

    # 自动创建默认管理员账号 admin/admin123
    db = SessionLocal()
    try:
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            new_admin = User(
                username="admin",
                password_hash=get_password_hash("admin123"),
                role="admin",
                is_active=True
            )
            db.add(new_admin)
            db.commit()

        # 首次启动写入默认系统设置
        for key, (value, description) in DEFAULT_SETTINGS.items():
            existing = db.query(AppSetting).filter(AppSetting.key == key).first()
            if not existing:
                db.add(AppSetting(key=key, value=value, description=description))

        # ---- 默认提示词模板（按固定 key 判重，name 可编辑不影响种子身份） ----
        DEFAULT_PROMPT_KEY = "bookplate.prompt_generation.default"
        COVER_PROMPT_KEY = "bookplate.image_analysis.default"
        # prompt_generation 默认提示词实为「藏书票图像提示词生成」的 system prompt，名字与用途保持一致
        DEFAULT_PROMPT_NAME = "藏书票图像生成默认提示词"
        COVER_PROMPT_NAME = "封面分析默认提示词"

        # 按 key 写入默认提示词（查不到才插入，name/content 的修改永远保留）
        default_seeds = [
            PromptTemplate(
                key=DEFAULT_PROMPT_KEY,
                name=DEFAULT_PROMPT_NAME,
                node_type="prompt_generation",
                content=DEFAULT_SYSTEM_PROMPT,
                is_active=True,
            ),
            PromptTemplate(
                key=COVER_PROMPT_KEY,
                name=COVER_PROMPT_NAME,
                node_type="image_analysis",
                content=DEFAULT_COVER_SYSTEM_PROMPT,
                is_active=True,
            ),
        ]
        for seed in default_seeds:
            exists = (
                db.query(PromptTemplate)
                .filter(PromptTemplate.key == seed.key)
                .first()
            )
            if not exists:
                db.add(seed)
        db.commit()
    finally:
        db.close()

app = FastAPI(title="BookForge API", lifespan=lifespan)

# 挂载静态目录，提供生成的藏书票图片访问
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# CORS 配置，允许 localhost:5173
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(generations_router)
app.include_router(favorites_router)
app.include_router(public_router)
app.include_router(bookplate_router)
app.include_router(admin_llm_configs_router, prefix="/api", tags=["admin"])
app.include_router(admin_prompts_router, prefix="/api", tags=["admin"])
app.include_router(admin_node_configs_router, prefix="/api", tags=["admin"])
app.include_router(admin_settings_router, prefix="/api", tags=["admin"])
app.include_router(admin_fastclaw_agents_router, prefix="/api", tags=["admin"])

@app.get("/")
def root():
    return {"message": "Welcome to BookForge API"}
