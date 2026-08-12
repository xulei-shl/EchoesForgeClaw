"""generations: module -> node_type, final_image_url -> result_url

Revision ID: d3e4f5a6b7c8
Revises: e1f2a3b4c5d6
Create Date: 2026-08-12 12:00:00.000000

统一画布化收尾：移除 generations.module（模块概念已废弃，node_configs /
prompt_templates 早已迁移为 node_type 维度），改为记录产出该结果的节点模板
类型 node_type；同时把仅面向图片的 final_image_url 泛化为 result_url，
为后续音频/视频等节点结果铺路（同一迁移内完成，避免二次改动）。

历史数据：旧 module 恒为 'bookplate'，且全部记录均为图像节点产出，
迁移为 node_type='image_generation'。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # SQLite 列改名需 batch 重建；先删旧索引，改列后再建新索引
    op.drop_index(op.f('ix_generations_module'), table_name='generations')
    with op.batch_alter_table('generations') as batch_op:
        batch_op.alter_column('module', new_column_name='node_type')
        batch_op.alter_column('final_image_url', new_column_name='result_url')
    # 历史数据：模块已废弃，存量记录均为图像节点产出
    op.execute(
        "UPDATE generations SET node_type = 'image_generation' "
        "WHERE node_type = 'bookplate'"
    )
    op.create_index(
        op.f('ix_generations_node_type'), 'generations', ['node_type'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema.（破坏性重构，不保证数据回迁）"""
    op.drop_index(op.f('ix_generations_node_type'), table_name='generations')
    op.execute(
        "UPDATE generations SET node_type = 'bookplate' "
        "WHERE node_type = 'image_generation'"
    )
    with op.batch_alter_table('generations') as batch_op:
        batch_op.alter_column('node_type', new_column_name='module')
        batch_op.alter_column('result_url', new_column_name='final_image_url')
    op.create_index(
        op.f('ix_generations_module'), 'generations', ['module'], unique=False
    )
