"""add group_order column to node_configs

Revision ID: a1b2c3d4e5f6
Revises: 9f0a1b2c3d4e
Create Date: 2026-08-10 23:30:00.000000

节点配置增加 group_order（自定义分组排序序号，同组共享；0 表示未排序）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '9f0a1b2c3d4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.add_column(sa.Column('group_order', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.drop_column('group_order')
