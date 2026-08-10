"""add agent_name to fastclaw_agent_configs

Revision ID: b3f9d2e1a4c7
Revises: 2f4c9a17b8d3
Create Date: 2026-08-10 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f9d2e1a4c7'
down_revision: Union[str, Sequence[str], None] = '2f4c9a17b8d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # FastClaw agent 真实名字（AgentRecord.name，如 "Xulei"），由「拉取」选择或
    # admin 列表懒解析回填，供画布节点 / 阶段配置等界面展示可读名字（agent_id 不可读）。
    # SQLite ALTER ADD COLUMN 无法带 NOT NULL，先加可空列再回填 ''。
    op.add_column('fastclaw_agent_configs', sa.Column('agent_name', sa.String(), nullable=True))
    op.execute("UPDATE fastclaw_agent_configs SET agent_name = '' WHERE agent_name IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('fastclaw_agent_configs', 'agent_name')
