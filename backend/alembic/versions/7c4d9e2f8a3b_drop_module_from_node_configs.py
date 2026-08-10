"""drop module column from node_configs

Revision ID: 7c4d9e2f8a3b
Revises: 5f0e9c2a7b1d
Create Date: 2026-08-10 21:00:00.000000

破坏性重构：移除 node_configs.module 列与索引。模块的多样化已由
「节点模板 + 节点配置」承担，module 维度冗余（画板仅存在 bookplate 一个模块）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c4d9e2f8a3b'
down_revision: Union[str, Sequence[str], None] = '5f0e9c2a7b1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # SQLite 删除列需 batch 重建；先删索引再删列
    op.drop_index(op.f('ix_node_configs_module'), table_name='node_configs')
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.drop_column('module')


def downgrade() -> None:
    """Downgrade schema.（破坏性重构，不保证数据回迁）"""
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.add_column(sa.Column('module', sa.String(), nullable=True))
    op.create_index(op.f('ix_node_configs_module'), 'node_configs', ['module'], unique=False)
    # 历史数据补回默认模块（如有需要可在此执行 UPDATE）
    op.execute("UPDATE node_configs SET module = 'bookplate' WHERE module IS NULL")
