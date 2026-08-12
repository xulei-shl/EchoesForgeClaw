"""add skill agent configs

Revision ID: c6a7b8c9d0e1
Revises: b3f9d2e1a4c7
Create Date: 2026-08-12 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Skill Agent 配置表（openai-agents-python 多步执行接入参数）
    op.create_table(
        'skill_agent_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('base_url', sa.String(), nullable=False),
        sa.Column('api_key', sa.String(), nullable=False),
        sa.Column('model_name', sa.String(), nullable=False),
        sa.Column('system_prompt', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_skill_agent_configs_id'),
        'skill_agent_configs',
        ['id'],
        unique=False,
    )

    # node_configs 增加 skill_agent_config_id（与 llm_config_id/prompt_id/agent_config_id 互斥）
    # SQLite 不支持对已有表 ALTER 添加带 FK 的列，需用 batch 模式（copy-and-move）
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.add_column(
            sa.Column(
                'skill_agent_config_id',
                sa.Integer(),
                sa.ForeignKey('skill_agent_configs.id', name='fk_node_configs_skill_agent_config_id'),
                nullable=True,
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('node_configs') as batch_op:
        batch_op.drop_column('skill_agent_config_id')
    op.drop_index(op.f('ix_skill_agent_configs_id'), table_name='skill_agent_configs')
    op.drop_table('skill_agent_configs')
