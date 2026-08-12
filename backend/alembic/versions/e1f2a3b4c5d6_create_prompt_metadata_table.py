"""create prompt_metadata table for Bifrost prompt preview images

Revision ID: e1f2a3b4c5d6
Revises: c4d5e6f7a8b0
Create Date: 2026-08-12 00:00:00.000000

Bifrost 官方 Prompt Repository 数据无图片字段；本地新增 prompt_metadata 表
记录每个提示词的预览图路径（图片文件存 backend/static/prompt-previews/），
列表/详情接口合并返回给前端做悬停预览与详情展示。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7a8b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'prompt_metadata',
        sa.Column('prompt_id', sa.String(length=64), nullable=False),
        sa.Column('preview_image', sa.String(length=512), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('prompt_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('prompt_metadata')
