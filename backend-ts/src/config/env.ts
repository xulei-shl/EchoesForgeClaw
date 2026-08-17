/**
 * 环境变量配置（对应 Python `app/core/config.py` 的 Settings）。
 * 优先级：进程环境变量 > .env 文件（dev 由 tsx/vite 加载，生产由部署环境注入）。
 */

export interface EnvConfig {
  projectName: string;
  secretKey: string;
  algorithm: 'HS256';
  accessTokenExpireMinutes: number;
  databaseUrl: string;
  /** 图像生成（OpenAI 兼容 API，留空则启用 Mock 占位图） */
  openaiImageApiKey: string;
  openaiImageBaseUrl: string;
  openaiImageModel: string;
  adminUsername: string;
  adminPassword: string;
  /** Bifrost 管理 API 认证（自部署默认 Basic Auth，启动时种子化到系统设置） */
  bifrostUsername: string;
  bifrostPassword: string;
  /** 万年历节点（MXNZP 节假日/万年历 API）凭据；留空时该节点提示未配置 */
  mxnzpAppId: string;
  mxnzpAppSecret: string;
  /** 前端 CORS 来源（逗号分隔，默认本地开发端口 5173/5180） */
  corsOrigins: string[];
}

export const env: EnvConfig = {
  projectName: process.env.PROJECT_NAME ?? 'BookForge',
  secretKey: process.env.SECRET_KEY ?? 'default-secret-key',
  algorithm: 'HS256',
  accessTokenExpireMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES ?? 60 * 24),
  databaseUrl: process.env.DATABASE_URL ?? 'sqlite:///./bookforge.db',
  openaiImageApiKey: process.env.OPENAI_IMAGE_API_KEY ?? '',
  openaiImageBaseUrl: process.env.OPENAI_IMAGE_BASE_URL ?? '',
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? '',
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin123',
  bifrostUsername: process.env.BIFROST_USERNAME ?? '',
  bifrostPassword: process.env.BIFROST_PASSWORD ?? '',
  mxnzpAppId: process.env.MXNZP_APP_ID ?? '',
  mxnzpAppSecret: process.env.MXNZP_APP_SECRET ?? '',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5180')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
