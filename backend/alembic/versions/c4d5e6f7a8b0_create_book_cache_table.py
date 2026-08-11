"""create book_cache table for ISBN lookup cache

Revision ID: c4d5e6f7a8b0
Revises: a1b2c3d4e5f6
Create Date: 2026-08-11 00:00:00.000000

将豆瓣 API 检索结果持久化到 book_cache 表，相同 ISBN 二次检索时
直接读库，减少豆瓣 API 请求并降低限流/反爬风险。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b0'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'book_cache',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('isbn', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False, server_default=''),
        sa.Column('subtitle', sa.String(), nullable=False, server_default=''),
        sa.Column('original_title', sa.String(), nullable=False, server_default=''),
        sa.Column('author', sa.String(), nullable=False, server_default=''),
        sa.Column('translator', sa.String(), nullable=False, server_default=''),
        sa.Column('publisher', sa.String(), nullable=False, server_default=''),
        sa.Column('producer', sa.String(), nullable=False, server_default=''),
        sa.Column('pub_year', sa.String(), nullable=False, server_default=''),
        sa.Column('pages', sa.String(), nullable=False, server_default=''),
        sa.Column('price', sa.String(), nullable=False, server_default=''),
        sa.Column('binding', sa.String(), nullable=False, server_default=''),
        sa.Column('series', sa.String(), nullable=False, server_default=''),
        sa.Column('series_link', sa.String(), nullable=False, server_default=''),
        sa.Column('rating', sa.Float(), nullable=False, server_default='0'),
        sa.Column('rating_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cover_image', sa.String(), nullable=False, server_default=''),
        sa.Column('cover_image_local', sa.String(), nullable=False, server_default=''),
        sa.Column('summary', sa.String(), nullable=False, server_default=''),
        sa.Column('author_intro', sa.String(), nullable=False, server_default=''),
        sa.Column('catalog', sa.String(), nullable=False, server_default=''),
        sa.Column('url', sa.String(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_book_cache_isbn'), 'book_cache', ['isbn'], unique=True)
    op.create_index(op.f('ix_book_cache_id'), 'book_cache', ['id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_book_cache_id'), table_name='book_cache')
    op.drop_index(op.f('ix_book_cache_isbn'), table_name='book_cache')
    op.drop_table('book_cache')