"""Expectativas frente a resultados: eventos, expectativas y resultados reales.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-05

Tres tablas nuevas, nada que tocar en las existentes:

- `catalyst_events`: el evento (resultados trimestrales primero; la misma forma
  para investor days, guidance, decisiones regulatorias o lanzamientos).
- `expectations`: lo que se esperaba de cada métrica antes del evento, con su
  fuente separada (consenso, guidance, modelo interno, reglas, usuario).
  INMUTABLE: una expectativa reescrita después del resultado no mide nada.
- `event_actuals`: lo que salió, con su documento. Solo se añaden filas: una
  reexpresión es una fila nueva con su propia fecha.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TRIGGERS = (
    """CREATE TRIGGER IF NOT EXISTS expectativa_no_se_modifica
       BEFORE UPDATE ON expectations
       BEGIN SELECT RAISE(ABORT, 'expectations es inmutable: lo que se esperaba no se reescribe'); END""",
    """CREATE TRIGGER IF NOT EXISTS expectativa_no_se_borra
       BEFORE DELETE ON expectations
       BEGIN SELECT RAISE(ABORT, 'expectations no se borra: borrar las fallidas falsearía la calibración'); END""",
    """CREATE TRIGGER IF NOT EXISTS real_no_se_modifica
       BEFORE UPDATE ON event_actuals
       BEGIN SELECT RAISE(ABORT, 'event_actuals solo admite filas nuevas'); END""",
)


def _existe(tabla: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(tabla)


def _indice(tabla: str, nombre: str, columnas: list[str]) -> None:
    if nombre not in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(tabla)}:
        op.create_index(nombre, tabla, columnas)


def upgrade() -> None:
    if not _existe("catalyst_events"):
        op.create_table(
            "catalyst_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("symbol", sa.String(length=16), nullable=False),
            sa.Column("tipo", sa.String(length=24), nullable=False),
            sa.Column("periodo", sa.String(length=16), nullable=True),
            sa.Column("periodo_fin", sa.String(length=10), nullable=True),
            sa.Column("fecha_prevista", sa.String(length=10), nullable=True),
            sa.Column("descripcion", sa.Text(), nullable=True),
            sa.Column("creado_en", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("symbol", "tipo", "periodo", name="uq_evento_periodo"),
            sa.CheckConstraint(
                "tipo IN ('earnings','investor_day','guidance_update','regulatorio','lanzamiento','otro')",
                name="ck_evento_tipo",
            ),
        )
    _indice("catalyst_events", "ix_evento_symbol_fecha", ["symbol", "fecha_prevista"])

    if not _existe("expectations"):
        op.create_table(
            "expectations",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("event_id", sa.Integer(), nullable=False),
            sa.Column("metrica", sa.String(length=48), nullable=False),
            sa.Column("fuente_tipo", sa.String(length=16), nullable=False),
            sa.Column("fuente", sa.String(length=96), nullable=False),
            sa.Column("valor", sa.Float(), nullable=True),
            sa.Column("bajo", sa.Float(), nullable=True),
            sa.Column("alto", sa.Float(), nullable=True),
            sa.Column("operador", sa.String(length=4), nullable=True),
            sa.Column("unidad", sa.String(length=24), nullable=True),
            sa.Column("informacion_hasta", sa.DateTime(timezone=True), nullable=False),
            sa.Column("registrado_en", sa.DateTime(timezone=True), nullable=False),
            sa.Column("detalle", sa.JSON(), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["catalyst_events.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("event_id", "metrica", "fuente_tipo", "fuente", name="uq_expectativa"),
            sa.CheckConstraint(
                "fuente_tipo IN ('consenso','guidance','modelo_interno','reglas','usuario')",
                name="ck_expectativa_fuente",
            ),
            sa.CheckConstraint(
                "valor IS NOT NULL OR bajo IS NOT NULL OR alto IS NOT NULL",
                name="ck_expectativa_con_cifra",
            ),
        )
    _indice("expectations", "ix_expectativa_evento", ["event_id"])

    if not _existe("event_actuals"):
        op.create_table(
            "event_actuals",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("event_id", sa.Integer(), nullable=False),
            sa.Column("metrica", sa.String(length=48), nullable=False),
            sa.Column("valor", sa.Float(), nullable=True),
            sa.Column("unidad", sa.String(length=24), nullable=True),
            sa.Column("fuente", sa.String(length=96), nullable=False),
            sa.Column("publicado", sa.String(length=25), nullable=False),
            sa.Column("registrado_en", sa.DateTime(timezone=True), nullable=False),
            sa.Column("detalle", sa.JSON(), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["catalyst_events.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("event_id", "metrica", "fuente", name="uq_resultado_real"),
        )
    _indice("event_actuals", "ix_real_evento", ["event_id"])

    for sql in TRIGGERS:
        op.execute(sql)


def downgrade() -> None:
    """Solo si no hay expectativas registradas: no se pueden reconstruir después."""
    n = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM expectations")).scalar()
    if n:
        raise RuntimeError(
            f"Hay {n} expectativa(s) registradas. Deshacer 0007 las borraría, y lo que "
            "se esperaba antes de un evento no se puede volver a saber después. No se deshace."
        )
    for trigger in ("real_no_se_modifica", "expectativa_no_se_borra", "expectativa_no_se_modifica"):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.drop_index("ix_real_evento", table_name="event_actuals")
    op.drop_table("event_actuals")
    op.drop_index("ix_expectativa_evento", table_name="expectations")
    op.drop_table("expectations")
    op.drop_index("ix_evento_symbol_fecha", table_name="catalyst_events")
    op.drop_table("catalyst_events")
