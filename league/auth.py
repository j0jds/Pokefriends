# =====================================================================
# LIGA POKÉMON — login do admin (senha única + token de sessão)
# =====================================================================
import hashlib
import hmac
import secrets
import time

from flask import current_app, request

from .banco import db
from .regras import erro


def senha_certa(senha):
    """Compara a senha sem vazar informação pelo tempo de resposta."""
    if not isinstance(senha, str):
        return False
    h = lambda x: hashlib.sha256(x.encode("utf-8", "replace")).digest()
    return hmac.compare_digest(h(senha), h(current_app.config["ADMIN_SENHA"]))


def _assinar(token):
    """O que fica no banco é uma assinatura do token feita com a senha do admin:
    quem ler o banco não consegue usar o login, e trocar a senha derruba todos os logins."""
    chave = current_app.config["ADMIN_SENHA"].encode("utf-8", "replace")
    return hmac.new(chave, token.encode("utf-8", "replace"), hashlib.sha256).hexdigest()


def criar_sessao():
    """Gera o token do admin e guarda a sessão no banco (vale em todos os workers)."""
    token = secrets.token_hex(24)
    agora = int(time.time())
    con = db()
    con.execute("DELETE FROM sessao WHERE expira <= ?", (agora,))  # limpa as vencidas
    con.execute(
        "INSERT INTO sessao (token, expira) VALUES (?, ?)",
        (_assinar(token), agora + current_app.config["SESSAO_S"]),
    )
    con.commit()
    return token


def eh_admin():
    """A requisição traz um token de admin válido (cabeçalho X-Token)?"""
    token = request.headers.get("X-Token")
    if not token:
        return False
    linha = db().execute("SELECT expira FROM sessao WHERE token = ?", (_assinar(token),)).fetchone()
    return bool(linha and linha["expira"] > time.time())


def exigir_admin():
    """Bloqueia a rota se não for admin."""
    if not eh_admin():
        raise erro(401, "Sessão expirada. Entre como admin de novo.")


def encerrar_sessao():
    token = request.headers.get("X-Token") or ""
    db().execute("DELETE FROM sessao WHERE token = ?", (_assinar(token),))
    db().commit()
