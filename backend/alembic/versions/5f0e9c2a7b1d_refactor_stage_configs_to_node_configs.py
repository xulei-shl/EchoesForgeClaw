"""refactor stage_configs to node_configs

Revision ID: 5f0e9c2a7b1d
Revises: b3f9d2e1a4c7
Create Date: 2026-08-10 20:00:00.000000

破坏性重构：
- stage_configs → node_configs：stage 语义替换为 node_type，新增 name / is_active，
  放开 (module, stage) 唯一约束（同一模板允许多条配置 = 多个节点变体）。
- prompt_templates.stage → node_type：提示词模板归属节点模板类型。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5f0e9c2a7b1d'
down_revision: Union[str, Sequence[str], None] = 'b3f9d2e1a4c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. 新建 node_configs 表（节点配置：模板类型 + 可选的 llm/prompt/agent 绑定）
    op.create_table(
        'node_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('module', sa.String(), nullable=False),
        sa.Column('node_type', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('llm_config_id', sa.Integer(), nullable=True),
        sa.Column('prompt_id', sa.Integer(), nullable=True),
        sa.Column('agent_config_id', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['agent_config_id'], ['fastclaw_agent_configs.id'], ),
        sa.ForeignKeyConstraint(['llm_config_id'], ['llm_configs.id'], ),
        sa.ForeignKeyConstraint(['prompt_id'], ['prompt_templates.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_node_configs_id'), 'node_configs', ['id'], unique=False)
    op.create_index(op.f('ix_node_configs_module'), 'node_configs', ['module'], unique=False)
    op.create_index(op.f('ix_node_configs_node_type'), 'node_configs', ['node_type'], unique=False)

    # 2. 旧阶段绑定迁入：stage → node_type，并给出默认名称；is_active 置 1
    op.execute(
        """
        INSERT INTO node_configs (module, node_type, name, llm_config_id, prompt_id, agent_config_id, is_active, created_at, updated_at)
        SELECT
            module,
            CASE stage
                WHEN 'stage2' THEN 'prompt_generation'
                WHEN 'stage2.cover' THEN 'image_analysis'
                WHEN 'stage3' THEN 'image_generation'
                ELSE stage
            END,
            CASE stage
                WHEN 'stage2' THEN '提示词生成'
                WHEN 'stage2.cover' THEN '图片分析'
                WHEN 'stage3' THEN '图像生成'
                ELSE stage
            END,
            llm_config_id,
            prompt_id,
            agent_config_id,
            1,
            created_at,
            updated_at
        FROM stage_configs
        """
    )
    op.drop_table('stage_configs')

    # 3. prompt_templates：stage 值映射到新 node_type，种子 key 同步更新
    op.execute("UPDATE prompt_templates SET stage = 'prompt_generation' WHERE stage = 'stage2'")
    op.execute("UPDATE prompt_templates SET stage = 'image_analysis' WHERE stage = 'stage2.cover'")
    op.execute("UPDATE prompt_templates SET stage = 'image_generation' WHERE stage = 'stage3'")
    op.execute("UPDATE prompt_templates SET key = 'bookplate.prompt_generation.default' WHERE key = 'bookplate.stage2.default'")
    op.execute("UPDATE prompt_templates SET key = 'bookplate.image_analysis.default' WHERE key = 'bookplate.stage2.cover.default'")

    # 4. 列改名 stage → node_type（SQLite 需 batch 模式；先删旧索引再建新索引）
    op.drop_index('ix_prompt_templates_stage', table_name='prompt_templates')
    with op.batch_alter_table('prompt_templates') as batch_op:
        batch_op.alter_column('stage', new_column_name='node_type')
    op.create_index(
        op.f('ix_prompt_templates_node_type'),
        'prompt_templates',
        ['node_type'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema.（破坏性重构，不保证数据回迁）"""
    op.drop_index(op.f('ix_prompt_templates_node_type'), table_name='prompt_templates')
    with op.batch_alter_table('prompt_templates') as batch_op:
        batch_op.alter_column('node_type', new_column_name='stage')
    op.create_index(op.f('ix_prompt_templates_stage'), 'prompt_templates', ['stage'], unique=False)
    op.drop_index(op.f('ix_node_configs_node_type'), table_name='node_configs')
    op.drop_index(op.f('ix_node_configs_module'), table_name='node_configs')
    op.drop_index(op.f('ix_node_configs_id'), table_name='node_configs')
    op.drop_table('node_configs')
