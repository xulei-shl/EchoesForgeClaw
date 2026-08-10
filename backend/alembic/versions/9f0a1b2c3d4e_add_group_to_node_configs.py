"""add group column to node_configs

Revision ID: 9f0a1b2c3d4e
Revises: 8e5f6a7b9c0d
Create Date: 2026-08-10 23:00:00.000000

节点配置增加可选自定义分组（画板「+」菜单分组展示）；空值按模板类型分组。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f0a1b2c3d4e'
down_revision: Union[str, Sequence[str], None] = '8e5f6a7b9c0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.add_column(sa.Column('group', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.drop_column('group')
