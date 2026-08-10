"""add fastclaw agents

Revision ID: 2f4c9a17b8d3
Revises: 807a1012196f
Create Date: 2026-08-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f4c9a17b8d3'
down_revision: Union[str, Sequence[str], None] = '807a1012196f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # FastClaw Agent 配置表
    op.create_table(
        'fastclaw_agent_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('base_url', sa.String(), nullable=False),
        sa.Column('api_key', sa.String(), nullable=False),
        sa.Column('agent_id', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_fastclaw_agent_configs_id'),
        'fastclaw_agent_configs',
        ['id'],
        unique=False,
    )

    # 阶段配置增加 agent_config_id（与 llm_config_id/prompt_id 互斥，API 层校验）
    # SQLite 不支持对已有表 ALTER 添加带 FK 的列，需用 batch 模式（copy-and-move）
    with op.batch_alter_table('stage_configs') as batch_op:
        batch_op.add_column(
            sa.Column(
                'agent_config_id',
                sa.Integer(),
                sa.ForeignKey('fastclaw_agent_configs.id', name='fk_stage_configs_agent_config_id'),
                nullable=True,
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('stage_configs') as batch_op:
        batch_op.drop_column('agent_config_id')
    op.drop_index(op.f('ix_fastclaw_agent_configs_id'), table_name='fastclaw_agent_configs')
    op.drop_table('fastclaw_agent_configs')
