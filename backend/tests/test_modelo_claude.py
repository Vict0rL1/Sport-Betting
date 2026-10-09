"""El modelo de Claude sale de la configuración (ítem 1.11).

Antes estaba escrito «claude-opus-5» en el código, y un id que el API no
conocía llegaba a la pantalla como «Error del API de Claude: 404». La
estimación de coste usaba la tarifa de Opus 5 fuera cual fuera el modelo.
"""

from __future__ import annotations

import anthropic
import httpx
import pytest

from app.config import Settings
from app.llm.anthropic_provider import AnthropicProvider
from app.llm.base import LLMUnavailableError
from app.routers.earnings import _coste_estimado


def _no_encontrado() -> anthropic.NotFoundError:
    respuesta = httpx.Response(404, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
    return anthropic.NotFoundError("model: claude-que-no-existe", response=respuesta, body=None)


def test_por_defecto_es_sonnet_5_5(monkeypatch):
    monkeypatch.delenv("CLAUDE_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    assert Settings(_env_file=None).claude_model == "claude-sonnet-5-5"


def test_claude_model_lo_cambia_y_el_nombre_anterior_se_sigue_leyendo(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    monkeypatch.setenv("CLAUDE_MODEL", "claude-opus-5-5")
    assert Settings(_env_file=None).claude_model == "claude-opus-5-5"
    monkeypatch.delenv("CLAUDE_MODEL")
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-opus-5-5")
    assert Settings(_env_file=None).claude_model == "claude-opus-5-5"


@pytest.mark.parametrize("metodo", ["interpret", "extract"])
def test_un_modelo_que_el_api_no_conoce_se_dice_con_su_nombre(metodo, monkeypatch):
    llm = AnthropicProvider("clave-de-prueba", "claude-que-no-existe")

    def falla(*_, **__):
        raise _no_encontrado()

    monkeypatch.setattr(llm.client.beta.messages, "create", falla)
    monkeypatch.setattr(llm.client.beta.messages, "stream", falla)
    with pytest.raises(LLMUnavailableError) as e:
        if metodo == "interpret":
            llm.interpret("sistema", "texto")
        else:
            llm.extract("sistema", "texto", dict)
    assert str(e.value) == "Modelo de Claude no válido: claude-que-no-existe. Revisa CLAUDE_MODEL en .env."


def test_el_coste_se_estima_con_la_tarifa_del_modelo_configurado():
    sonnet = _coste_estimado(1_000_000, "claude-sonnet-5-5", salida=100_000)
    opus = _coste_estimado(1_000_000, "claude-opus-5-5", salida=100_000)
    assert sonnet["usd_estimado"] == pytest.approx(2.0 + 1.0)
    assert opus["usd_estimado"] == pytest.approx(4.0 + 2.0)
    assert "claude-sonnet-5-5" in sonnet["nota"]


def test_sin_tarifa_conocida_no_se_inventa_un_precio():
    r = _coste_estimado(12345, "claude-del-futuro")
    assert r["usd_estimado"] is None
    assert r["tokens_entrada"] == 12345
    assert "No hay tarifa conocida para el modelo claude-del-futuro" in r["nota"]
