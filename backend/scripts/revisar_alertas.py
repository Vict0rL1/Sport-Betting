"""Revisa las alertas y avisa de las que acaban de saltar. Para `cron`.

    python scripts/revisar_alertas.py

Por qué un comando y no un hilo dentro del servidor: esta es una app local que
arrancas cuando la usas. Un planificador dentro de un proceso que puede estar
apagado no vigila nada, y además mentiría — la pestaña diría «vigilando» con el
servidor parado. Lo honesto es dejarle el calendario al sistema operativo, que
para eso está siempre encendido.

Programarlo cada quince minutos en horario de mercado (lunes a viernes,
9:30-16:00 hora de Nueva York):

    */15 13-21 * * 1-5  cd /ruta/al/repo/backend && \\
        /usr/bin/python3 scripts/revisar_alertas.py >> ~/.alertas.log 2>&1

(Las horas del cron van en la hora de tu máquina; 13-21 UTC cubre la sesión
estadounidense. Ajusta si tu reloj no está en UTC.)

En macOS, `launchd` es más fiable que `cron` para tareas de usuario, y en
Windows el Programador de tareas hace lo mismo.

## Lo que este comando NO hace

No descarga nada que no esté ya en caché si le pasas `--solo-cache`. Sin esa
opción gasta una cotización por símbolo con alerta activa, que es el coste real
de vigilar: si tienes ocho alertas y lo corras cada quince minutos, son ~256
llamadas al día. Con el tier gratuito de Finnhub (60/min) cabe de sobra, pero
conviene saberlo antes de ponerlo cada minuto.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.analysis import alertas as al  # noqa: E402
from app.config import settings  # noqa: E402
from app.db.engine import SessionLocal, init_db  # noqa: E402
from app.db.models import Alert, Instrument  # noqa: E402
from app.deps import get_service  # noqa: E402
from app.notify import notificar  # noqa: E402
from app.providers.base import DataNotFoundError  # noqa: E402
from app.providers.router import AllProvidersFailedError  # noqa: E402


def _precio(service, symbol: str, solo_cache: bool) -> float | None:
    if solo_cache:
        cache = getattr(service, "cache", None)
        payload = cache.get("quote", {"symbol": symbol}) if cache else None
        return (payload or {}).get("price")
    try:
        return service.get("quote", symbol=symbol).get("price")
    except (DataNotFoundError, AllProvidersFailedError):
        return None


def revisar(solo_cache: bool = False, avisar: bool = True) -> dict:
    init_db()
    service = get_service()
    ahora = datetime.now(timezone.utc)

    with SessionLocal() as session:
        filas = session.execute(
            select(Alert, Instrument).join(Instrument, Alert.instrument_id == Instrument.id)
        ).all()

        resultados = []
        for alerta, instrumento in filas:
            datos = {
                "id": alerta.id,
                "symbol": instrumento.symbol,
                "condition": alerta.condition,
                "active": alerta.active,
                "triggered_at": alerta.triggered_at,
            }
            precio = _precio(service, instrumento.symbol, solo_cache) if alerta.active else None
            veredicto = al.evaluar(datos, precio, ahora)
            nueva = al.es_nueva(datos, veredicto)
            if nueva:
                # Se marca ANTES de notificar. Si el aviso falla, la alerta
                # queda igualmente registrada como saltada y se ve en la app:
                # peor que un aviso perdido es un aviso repetido cada quince
                # minutos hasta que lo silencias todo.
                alerta.triggered_at = ahora
            resultados.append({"symbol": instrumento.symbol, "veredicto": veredicto, "nueva": nueva})
        session.commit()

    salida = al.resumir(resultados)

    # La marca se deja SIEMPRE, también cuando no ha saltado nada: sirve para
    # que la pestaña pueda decir «alguien está mirando» en vez de suponerlo. Una
    # pasada tranquila es justamente la prueba de que la vigilancia funciona.
    al.anotar_pasada(Path(settings.database_path).parent, salida, ahora)

    if avisar and salida["nuevas"]:
        titulo, cuerpo = al.texto_de_aviso(salida["nuevas"])
        salida["notificacion"] = notificar(titulo, cuerpo)
    return salida


def main() -> int:
    p = argparse.ArgumentParser(description="Revisa las alertas y avisa de las nuevas.")
    p.add_argument(
        "--solo-cache",
        action="store_true",
        help="no descarga cotizaciones; usa solo lo ya guardado (gratis, pero puede estar viejo)",
    )
    p.add_argument("--sin-aviso", action="store_true", help="no manda notificación de escritorio")
    p.add_argument("--json", action="store_true", help="salida en JSON")
    args = p.parse_args()

    salida = revisar(solo_cache=args.solo_cache, avisar=not args.sin_aviso)

    if args.json:
        print(json.dumps(salida, indent=2, ensure_ascii=False, default=str))
    else:
        # SIEMPRE por salida estándar, además de la notificación: con cron esto
        # acaba en el log o en el correo del sistema, donde el aviso sigue
        # existiendo aunque el escritorio no se haya enterado.
        print(f"[{datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC] {salida['resumen']}")
        aviso = salida.get("notificacion")
        if aviso and not aviso["enviado"]:
            print(f"  (no se pudo notificar al escritorio: {aviso['motivo']})")
        for rota in salida["no_evaluables"]:
            print(f"  ! {rota['veredicto']['motivo']}")

    # Código 0 siempre que la revisión se haya hecho: que una alerta salte no
    # es un fallo del comando, y devolver != 0 haría que cron lo tratara como
    # error y llenara el correo de falsos problemas.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
