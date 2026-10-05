"""Efectivo disponible, anotado por el usuario.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-05

Una tabla nueva y nada más. Sin efectivo conocido, el motor de coste de
oportunidad no puede saber si comprar algo exige vender otra cosa; con esta
tabla, lo anotado manda y lo no anotado es desconocido, no cero.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("cash_balances"):
        op.create_table(
            "cash_balances",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("moneda", sa.String(length=8), nullable=False),
            sa.Column("importe", sa.Float(), nullable=False),
            sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
            sa.Column("registrado_en", sa.DateTime(timezone=True), nullable=False),
            sa.Column("nota", sa.Text(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint("importe >= 0", name="ck_efectivo_no_negativo"),
        )
    if "ix_efectivo_moneda_fecha" not in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("cash_balances")}:
        op.create_index("ix_efectivo_moneda_fecha", "cash_balances", ["moneda", "as_of"])


def downgrade() -> None:
    n = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM cash_balances")).scalar()
    if n:
        raise RuntimeError(f"Hay {n} anotación(es) de efectivo. Deshacer 0008 las borraría. No se deshace.")
    op.drop_index("ix_efectivo_moneda_fecha", table_name="cash_balances")
    op.drop_table("cash_balances")
