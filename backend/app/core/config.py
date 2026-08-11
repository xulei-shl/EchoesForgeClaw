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

    class Config:
        env_file = ".env"

settings = Settings()
