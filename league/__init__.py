# =====================================================================
# LIGA POKÉMON — aplicação Flask (API + arquivos do site)
# Requer Python 3.9+ e Flask (pip install -r requirements.txt)
# =====================================================================
from flask import Flask

from . import banco, regras, rotas
from .config import ler_config


def criar_app():
    """Monta o app: lê a configuração, prepara o banco e registra as rotas."""
    cfg = ler_config()  # sem ADMIN_SENHA lança RuntimeError (o app não sobe)

    app = Flask(__name__, static_folder=None)  # os arquivos de public/ saem pela rota em rotas.py
    app.config.update(
        ADMIN_SENHA=cfg["ADMIN_SENHA"],
        ARQUIVO_DB=cfg["ARQUIVO_DB"],
        PUBLICO=cfg["PUBLICO"],
        PORTA=cfg["PORTA"],
        SESSAO_S=cfg["SESSAO_S"],
        MAX_CONTENT_LENGTH=cfg["LIMITE_CORPO"],
    )
    app.json.ensure_ascii = False  # acentos saem como acentos no JSON
    app.json.sort_keys = False  # mantém a ordem dos campos como no SQL

    banco.iniciar_banco(cfg["ARQUIVO_DB"])
    app.teardown_appcontext(banco.fechar_banco)
    regras.registrar_erros(app)
    app.register_blueprint(rotas.bp)
    return app
