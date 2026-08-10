"""drop module column from prompt_templates

Revision ID: 8e5f6a7b9c0d
Revises: 7c4d9e2f8a3b
Create Date: 2026-08-10 22:00:00.000000

破坏性重构：移除 prompt_templates.module 列与索引（与 node_configs 保持一致）。
提示词模板按「节点模板类型（node_type）」归属即可，模块维度冗余。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8e5f6a7b9c0d'
down_revision: Union[str, Sequence[str], None] = '7c4d9e2f8a3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # SQLite 删除列需 batch 重建；先删索引再删列
    op.drop_index(op.f('ix_prompt_templates_module'), table_name='prompt_templates')
    with op.batch_alter_table('prompt_templates') as batch_op:
        batch_op.drop_column('module')


def downgrade() -> None:
    """Downgrade schema.（破坏性重构，不保证数据回迁）"""
    with op.batch_alter_table('prompt_templates') as batch_op:
        batch_op.add_column(sa.Column('module', sa.String(), nullable=True))
    op.create_index(op.f('ix_prompt_templates_module'), 'prompt_templates', ['module'], unique=False)
    # 历史数据补回默认模块（如有需要可在此执行 UPDATE）
    op.execute("UPDATE prompt_templates SET module = 'bookplate' WHERE module IS NULL")
