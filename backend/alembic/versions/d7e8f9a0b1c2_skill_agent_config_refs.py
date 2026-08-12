"""skill agent config 引用 llm_config / prompt_template

Revision ID: d7e8f9a0b1c2
Revises: c6a7b8c9d0e1
Create Date: 2026-08-12

Skill Agent 配置改为与 NodeConfig 同构：模型接入参数（url/key/model）通过
llm_config_id 引用「模型配置」，系统提示词通过 prompt_id 引用「提示词模板」。
旧字段（base_url / api_key / model_name / system_prompt）保留列，仅作存量兼容。

注：SQLite batch 模式一次重建加多个带 FK 的列会报循环依赖（Alembic 已知
限制），故此处只加列、不建 DB 级外键；引用有效性由 API 层校验 +
ORM relationship 保证（与 SQLite 默认不启用 PRAGMA foreign_keys 的行为一致）。
"""

from alembic import op
import sqlalchemy as sa

revision: str = "d7e8f9a0b1c2"
down_revision: str = "c6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 幂等：SQLite DDL 非事务性，此前失败运行可能已加过列
    from sqlalchemy import inspect

    existing = {c["name"] for c in inspect(op.get_bind()).get_columns("skill_agent_configs")}
    with op.batch_alter_table("skill_agent_configs") as batch_op:
        if "llm_config_id" not in existing:
            batch_op.add_column(sa.Column("llm_config_id", sa.Integer(), nullable=True))
        if "prompt_id" not in existing:
            batch_op.add_column(sa.Column("prompt_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("skill_agent_configs") as batch_op:
        batch_op.drop_column("prompt_id")
        batch_op.drop_column("llm_config_id")
