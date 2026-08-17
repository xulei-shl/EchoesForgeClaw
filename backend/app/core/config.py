from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "BookForge"
    SECRET_KEY: str = "default-secret-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 # 24 小时
    DATABASE_URL: str = "sqlite:///./bookforge.db"

    # 图像生成（OpenAI 兼容 API，留空则启用 Mock 占位图）
    OPENAI_IMAGE_API_KEY: str = ""
    OPENAI_IMAGE_BASE_URL: str = ""
    OPENAI_IMAGE_MODEL: str = ""

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"

    # Bifrost 管理 API 认证（自部署默认 Basic Auth，username:password）。
    # 首次启动时种子化到系统设置（admin/settings 的 bifrost.username / bifrost.password），
    # 之后以页面修改为准（仅在设置缺失时重新种子）。
    BIFROST_USERNAME: str = ""
    BIFROST_PASSWORD: str = ""

    # 万年历节点（MXNZP 节假日/万年历 API）凭据；留空时该节点提示未配置
    MXNZP_APP_ID: str = ""
    MXNZP_APP_SECRET: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
