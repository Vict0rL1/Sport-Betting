"""La regla común contra el sesgo de anticipación.

    information_available_at <= decision_timestamp

Lo que más fácil se cuela no es el dato claramente futuro, sino el del MISMO
día: un 8-K «del 12 de septiembre» no se conocía a las 14:35 del 12 si la SEC lo
aceptó a las 21:00. Estos tests fijan cómo se resuelve cada caso.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app import punto_en_el_tiempo as pit
from app.analysis.backtest import momentum_12_1, point_in_time_period

DECISION = datetime(2026, 9, 12, 14, 35, tzinfo=timezone.utc)


def test_un_instante_anterior_esta_disponible_y_uno_posterior_no():
    assert pit.disponible_en("2026-09-12T14:34:59+00:00", DECISION) is True
    assert pit.disponible_en("2026-09-12T14:35:00Z", DECISION) is True
    assert pit.disponible_en("2026-09-12T14:35:01+00:00", DECISION) is False


def test_las_zonas_horarias_se_respetan():
    # 10:30 en Nueva York (UTC-4) son las 14:30 UTC: anterior.
    assert pit.disponible_en("2026-09-12T10:30:00-04:00", DECISION) is True
    # 11:00 en Nueva York son las 15:00 UTC: posterior.
    assert pit.disponible_en("2026-09-12T11:00:00-04:00", DECISION) is False


def test_un_dia_anterior_esta_disponible_y_uno_posterior_no():
    assert pit.disponible_en("2026-09-11", DECISION) is True
    assert pit.disponible_en(date(2026, 9, 13), DECISION) is False


def test_el_mismo_dia_sin_hora_no_se_puede_probar():
    """La SEC fecha por día: un filing del 12 pudo llegar a las 21:00."""
    assert pit.disponible_en("2026-09-12", DECISION) is None
    assert pit.estado("2026-09-12", DECISION) == pit.DESCONOCIDO


def test_el_mismo_dia_cuenta_si_el_sistema_lo_tenia_antes():
    obtenido = datetime(2026, 9, 12, 13, 0, tzinfo=timezone.utc)
    assert pit.disponible_en("2026-09-12", DECISION, obtenido_en=obtenido) is True
    tarde = datetime(2026, 9, 12, 15, 0, tzinfo=timezone.utc)
    assert pit.disponible_en("2026-09-12", DECISION, obtenido_en=tarde) is False


def test_sin_fecha_es_desconocido_no_disponible():
    for vacio in (None, "", "no es una fecha", "2026-13-45"):
        assert pit.disponible_en(vacio, DECISION) is None


def test_una_decision_por_dia_compara_por_dia():
    """La convención del backtest, que decide al cierre."""
    assert pit.disponible_en("2026-09-12", date(2026, 9, 12)) is True
    assert pit.disponible_en("2026-09-13", date(2026, 9, 12)) is False
    assert pit.disponible_en("2026-09-12T23:00:00+00:00", date(2026, 9, 12)) is True


def test_un_datetime_sin_zona_se_lee_como_utc():
    """SQLite pierde la zona al guardar; toda la app escribe en UTC."""
    assert pit.disponible_en(datetime(2026, 9, 12, 14, 0), DECISION) is True
    assert pit.disponible_en(datetime(2026, 9, 12, 15, 0), DECISION) is False


def test_filtrar_separa_disponible_futuro_y_sin_fecha():
    noticias = [
        {"t": "antes", "published_at": "2026-09-12T09:00:00+00:00"},
        {"t": "despues", "published_at": "2026-09-12T18:00:00+00:00"},
        {"t": "sin fecha", "published_at": None},
    ]
    r = pit.filtrar(noticias, lambda n: n["published_at"], DECISION)
    assert [n["t"] for n in r["disponibles"]] == ["antes"]
    assert [n["t"] for n in r["futuros"]] == ["despues"]
    assert [n["t"] for n in r["sin_fecha"]] == ["sin fecha"]


def test_el_backtest_usa_la_regla_comun():
    """`point_in_time_period` y el momentum preguntan al helper: misma regla."""
    periodos = [{"end_date": "2021-12-31", "filed_at": "2022-02-15", "revenue": 1}]
    assert point_in_time_period(periodos, [], date(2022, 2, 15)) is not None
    assert point_in_time_period(periodos, [], date(2022, 2, 14)) is None

    # 150 sesiones pasadas + 100 futuras: si las futuras contaran, habría las
    # 200 que exige el momentum y saldría un número.
    pasado = [{"ts": f"2021-{1 + i // 28:02d}-{1 + i % 28:02d}", "close": 100.0} for i in range(150)]
    futuro = [{"ts": f"2022-{1 + i // 28:02d}-{1 + i % 28:02d}", "close": 200.0} for i in range(100)]
    assert momentum_12_1(pasado + futuro, date(2021, 12, 31)) is None
