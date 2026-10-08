# Glosario

Un término por concepto en toda la app (ítem 1.8 del plan de correcciones).
La columna **Nunca** no es decorativa: `backend/tests/test_glosario.py` la lee
y falla si uno de esos términos aparece en un texto para el usuario, sea del
backend (sobre el paquete de casos extremos), del frontend (cadenas y texto
JSX de `frontend/src`) o del diccionario de etiquetas (`backend/app/etiquetas.py`).
Para añadir una prohibición, se añade aquí.

Las etiquetas de los códigos internos (`gross_margin` → «margen bruto») viven
en `backend/app/etiquetas.py`; este documento fija las palabras.

| Concepto | Término | Nunca | Nota |
|---|---|---|---|
| Beneficio por acción | BPA | EPS | «BPA diluido», «crecimiento del BPA». |
| Flujo de caja libre | flujo de caja libre (FCF) | FCF yield | «FCF» solo como abreviatura en compuestos ya fijados: «margen de FCF», «FCF de partida», «rentabilidad por FCF». |
| Rentabilidad del flujo de caja libre sobre el precio | rentabilidad por FCF | FCF yield | |
| Rentabilidad por dividendo | rentabilidad por dividendo | Div. yield, dividend yield | |
| Coste anual de un ETF | coste anual | Expense ratio | Se explica en dinero: «75 al año por cada 10.000 invertidos». |
| Nivel de salida por pérdida | stop | stop loss, stop-loss | Se fija al abrir la posición. |
| Valor relativo frente a comparables | puntuación | | «z-score» solo dentro de una explicación técnica. |
| Postura escrita sobre una empresa | tesis | | Con puntos de invalidación medibles. |
| Lo que tienes de un valor | posición | | Varios lotes del mismo símbolo son una posición. |
| Todo lo que tienes | cartera | | **Pendiente de la Fase 3** (fusión de «Portafolio» y «Cartera» en la navegación): hasta entonces conviven los dos nombres de pestaña. |
| Lista de valores seguidos | lista de seguimiento | | **Pendiente de la Fase 3**: la pestaña aún se llama «Watchlist». |
| Previsión que publica la propia empresa | guidance de la dirección | | Extraída por IA con cita verificada; nunca se presenta como dato calculado. |
| Ganancia o pérdida | P&L | | «realizado» (posiciones cerradas) y «no realizado» (abiertas). |
| Precio fuera de lo esperable | precio viejo | | Rescatado de caché porque todas las fuentes fallaron; siempre con su antigüedad. |
| Dato que falta | sin datos / desconocido | | Ausente ≠ cero: nunca se rellena con 0. |
