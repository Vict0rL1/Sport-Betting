# Fase 9 — Cierre

1. **Doctor**: que compruebe todo lo añadido en las fases 1–8. Copias, migraciones, retención,
   ingestas, confianza, analítica, producto y seguridad ya tenían su sección; faltaban los trabajos
   programados, los canales de notificación, los interruptores, la frescura de los datos por deporte
   y las fuentes. Van en una sección nueva, **OPERACIÓN**, con sus comprobaciones puras en
   `doctor/checks.ts` (probadas) y la lectura del estado en `scripts/doctor.ts`.
2. **CHANGELOG** con las cifras de antes y después donde cambian: tests, comprobaciones, doctor,
   rendimiento, Lighthouse y los backtests de cada deporte (que no cambian: ninguna probabilidad
   publicada se ha tocado). Tenis tras el cambio de fuente y fútbol y tenis contra el mercado, con
   lo que se puede y lo que no se puede medir aquí.
3. **PR a `main`** con el resumen completo y los planes de cada fase. No se fusiona.

## Lo que salió

- **OPERACIÓN** en el doctor: trabajos que fallaron en su última pasada o se quedaron «en marcha»
  más de 6 h, canales configurados y envíos fallidos en 24 h, interruptores (encendidos, inactivos
  por falta de variable, anulaciones de interruptores que ya no existen), frescura de los resultados
  por deporte con su temporada (aviso si en plena temporada pasan más de 21 días sin uno nuevo, y
  nunca en las tres primeras semanas de la temporada) y, con `npm run doctor -- --fuentes`, una
  petición ligera a cada fuente de datos para saber si contesta desde la máquina.
- En este entorno el doctor pasa de 1 error y 2 avisos a **1 error y 4 avisos**. Los dos nuevos son
  reales: los resultados de tenis (TML congelado en enero) y de béisbol (Retrosheet publica al
  acabar la temporada y la MLB Stats API está bloqueada aquí) van meses atrasados en plena
  temporada. Con `--fuentes`, de diez fuentes solo GitHub contesta; las otras nueve devuelven 403
  del proxy de la red.
- **Tenis tras el cambio de fuente**: no hubo cambio posible. Sackmann sigue en 404, TML se congeló
  el 17 de enero y tennis-data.co.uk (la alternativa, con la WTA y las cuotas) está bloqueada aquí.
  Las cifras del tenis son las de la línea base.
- **Fútbol y tenis contra el mercado**: no se pueden medir con esta base. Ninguno de los 30.791
  partidos de fútbol ni de los 30.853 de tenis guardados trae cuota histórica (football-data.co.uk y
  tennis-data.co.uk, las dos fuentes de cuotas de cierre, están bloqueadas). La única comparación
  con el mercado de cierre es la de la NFL. No se rellena con nada.
