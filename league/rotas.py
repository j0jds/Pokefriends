# =====================================================================
# LIGA POKÉMON — rotas: API (/api/...), replay (/replay/ID) e arquivos do site
# =====================================================================
import os

from flask import Blueprint, current_app, jsonify, make_response, request, send_from_directory

from . import auth
from .banco import SQL_FINAL, SQL_LUTAS, SQL_TABELA, db, listar
from .regras import CRUD, erro, ler_corpo
from .replay import pagina_replay

bp = Blueprint("league", __name__)

TIPOS = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
}


# ---------- API: rotas públicas ----------

@bp.get("/api/dados")
def dados():
    """Tabela, treinadores, lutas e finalizações numa resposta só."""
    return jsonify(
        {
            "admin": auth.eh_admin(),
            "tabela": listar(SQL_TABELA),
            "jogadores": listar("SELECT id, nome FROM jogador ORDER BY nome"),
            "lutas": listar(SQL_LUTAS),
            "final": listar(SQL_FINAL),
        }
    )


@bp.post("/api/login")
def login():
    """{senha} -> {token}"""
    if not auth.senha_certa(ler_corpo().get("senha")):
        raise erro(401, "Senha incorreta.")
    return jsonify({"token": auth.criar_sessao()})


# ---------- API: daqui para baixo, só admin ----------

@bp.post("/api/logout")
def logout():
    auth.exigir_admin()
    auth.encerrar_sessao()
    return jsonify({"ok": True})


@bp.route("/api/<recurso>", methods=["GET", "POST", "PUT", "DELETE"])
@bp.route("/api/<recurso>/<int:id_>", methods=["GET", "POST", "PUT", "DELETE"])
def crud(recurso, id_=None):
    """POST sem id = criar; PUT com id = editar; DELETE com id = apagar."""
    auth.exigir_admin()
    regras = CRUD.get(recurso)
    if not regras:
        raise erro(404, "Rota não encontrada.")

    tem_id = id_ is not None
    op = {"POST": not tem_id and "criar", "PUT": tem_id and "editar", "DELETE": tem_id and "apagar"}.get(
        request.method
    )
    funcao = op and getattr(regras, op, None)
    if not funcao:
        raise erro(405, "Método não permitido.")

    args = [id_] if tem_id else []
    if request.method != "DELETE":
        args.append(ler_corpo())
    funcao(*args)
    db().commit()  # só grava se nada deu erro no meio do caminho
    return jsonify({"ok": True})


# ---------- Replay da batalha ----------

@bp.get("/replay/<int:id_>")
def replay(id_):
    """Página que toca o replay da luta (404 se a luta não tem replay)."""
    linha = db().execute("SELECT replay FROM luta WHERE id = ?", (id_,)).fetchone()
    if not linha or not linha["replay"]:
        raise erro(404, "Esta luta não tem replay.")
    resp = make_response(pagina_replay(id_, linha["replay"]))
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


# ---------- Arquivos do site (pasta public/) ----------

@bp.get("/")
def pagina_inicial():
    return arquivo("index.html")


@bp.get("/<path:caminho>")
def arquivo(caminho):
    """Entrega HTML/CSS/JS/imagens de public/. Caminhos fora da pasta dão 404."""
    mimetype = TIPOS.get(os.path.splitext(caminho)[1])
    resp = send_from_directory(current_app.config["PUBLICO"], caminho, mimetype=mimetype)
    imagem = (mimetype or "").startswith("image/") and "svg" not in mimetype
    resp.headers["Cache-Control"] = "public, max-age=86400" if imagem else "no-cache"  # imagens: 1 dia
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp
