# =====================================================================
# LIGA POKÉMON — regras: erros, validações e CRUD (treinador, luta, final)
# =====================================================================
import json
import re
import sqlite3

from flask import current_app, jsonify, request
from werkzeug.exceptions import HTTPException

from .banco import db


# ---------- Erros ----------

class ErroApi(Exception):
    """Erro com status HTTP (400, 401, 404...). A mensagem vai para a tela."""

    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def erro(status, msg):
    return ErroApi(status, msg)


def traduzir(e):
    """Transforma qualquer exceção em (status HTTP, mensagem em português)."""
    if isinstance(e, ErroApi):
        return e.status, str(e)
    if isinstance(e, HTTPException):  # 404, 405, 413... do próprio Flask
        if e.code == 404 and request.path.startswith("/api/"):
            return 404, "Rota não encontrada."
        padrao = {404: "Não encontrado.", 405: "Método não permitido.", 413: "Corpo grande demais."}
        return e.code or 500, padrao.get(e.code, e.description)
    if isinstance(e, sqlite3.IntegrityError):
        if "UNIQUE" in str(e):
            return 409, "Esse nome já está cadastrado."
        if "FOREIGN KEY" in str(e):
            return 400, "Jogador não existe."
    current_app.logger.error("Erro interno", exc_info=e)
    return 500, "Erro interno."


def registrar_erros(app):
    """Toda falha vira JSON {erro: "..."}, que é o que o app.js espera."""

    @app.errorhandler(Exception)
    def _tratar(e):
        status, msg = traduzir(e)
        return jsonify({"erro": msg}), status


# ---------- Utilitários ----------

def ler_corpo():
    """Lê o JSON enviado (limite em LIMITE_CORPO; passou disso = erro 413)."""
    bruto = request.get_data(cache=False)
    if not bruto.strip():
        return {}
    try:
        corpo = json.loads(bruto)
    except ValueError:
        raise erro(400, "JSON inválido.")
    if not isinstance(corpo, dict):
        raise erro(400, "JSON inválido.")
    return corpo


def inteiro(v, nome, padrao=None):
    """Converte para inteiro; vazio vira o padrão; texto inválido gera erro (limite ±100000)."""
    if v is None or v == "":
        return padrao
    n = None
    if isinstance(v, bool):
        pass
    elif isinstance(v, int):
        n = v
    elif isinstance(v, float) and v.is_integer():
        n = int(v)
    elif isinstance(v, str) and re.fullmatch(r"\s*[+-]?[0-9]+\s*", v):
        n = int(v)
    if n is None or abs(n) > 100000:
        raise erro(400, f"{nome} inválido.")
    return n


def achou(cursor):
    """Garante que a operação mudou alguma linha."""
    if not cursor.rowcount:
        raise erro(404, "Não encontrado.")


# ---------- Treinador ----------

def nome_valido(b):
    """Valida e limpa o nome do treinador."""
    nome = str(b.get("nome") or "").strip()
    if not nome or len(nome) > 40:
        raise erro(400, "Nome deve ter de 1 a 40 letras.")
    return nome


class JOGADOR:
    @staticmethod
    def criar(b):
        db().execute("INSERT INTO jogador (nome) VALUES (?)", (nome_valido(b),))

    @staticmethod
    def editar(id_, b):
        achou(db().execute("UPDATE jogador SET nome = ? WHERE id = ?", (nome_valido(b), id_)))

    @staticmethod
    def apagar(id_):
        # apaga as lutas e a finalização dele junto (ON DELETE CASCADE)
        achou(db().execute("DELETE FROM jogador WHERE id = ?", (id_,)))


# ---------- Luta ----------

def replay_valido(txt):
    """Valida o log do replay (texto do Showdown). Vazio = sem replay."""
    log = str(txt or "").strip()
    if not log:
        return None
    if not re.search(r"^\|player\|p1\|", log, re.MULTILINE):
        raise erro(400, "Arquivo de replay inválido (não achei o log da batalha).")
    return log


def luta_valida(b):
    """Valida e limpa os dados de uma luta. Pontos negativos são permitidos."""
    l = {
        "rodada": inteiro(b.get("rodada"), "Rodada", 1),
        "j1": inteiro(b.get("j1"), "Jogador 1"),
        "j2": inteiro(b.get("j2"), "Jogador 2"),
        "resultado": b.get("resultado") or None,
        "pts1": inteiro(b.get("pts1"), "Pontos do jogador 1", 0),
        "pts2": inteiro(b.get("pts2"), "Pontos do jogador 2", 0),
    }
    if l["rodada"] < 1:
        raise erro(400, "Rodada deve ser 1 ou mais.")
    if not l["j1"] or not l["j2"] or l["j1"] == l["j2"]:
        raise erro(400, "Escolha dois jogadores diferentes.")
    if l["resultado"] and l["resultado"] not in ("j1", "j2", "empate"):
        raise erro(400, "Resultado inválido.")
    return l


class LUTA:
    @staticmethod
    def criar(b):
        l = luta_valida(b)
        db().execute(
            "INSERT INTO luta (rodada, j1, j2, resultado, pts1, pts2, replay) VALUES (?,?,?,?,?,?,?)",
            (l["rodada"], l["j1"], l["j2"], l["resultado"], l["pts1"], l["pts2"], replay_valido(b.get("replay"))),
        )

    @staticmethod
    def editar(id_, b):
        l = luta_valida(b)
        novo_replay = replay_valido(b.get("replay")) if "replay" in b else None
        achou(
            db().execute(
                "UPDATE luta SET rodada=?, j1=?, j2=?, resultado=?, pts1=?, pts2=? WHERE id=?",
                (l["rodada"], l["j1"], l["j2"], l["resultado"], l["pts1"], l["pts2"], id_),
            )
        )
        # replay: ausente = mantém o atual; texto = troca; vazio = remove
        if "replay" in b:
            db().execute("UPDATE luta SET replay = ? WHERE id = ?", (novo_replay, id_))

    @staticmethod
    def apagar(id_):
        achou(db().execute("DELETE FROM luta WHERE id = ?", (id_,)))


# ---------- Finalização ----------

def final_valido(b):
    """'finished' exige data/hora (AAAA-MM-DDTHH:MM[:SS])."""
    status = "finished" if b.get("status") == "finished" else "andamento"
    data = str(b.get("data") or "").strip()
    if status == "andamento":
        return status, None
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?", data):
        raise erro(400, "Informe a data e hora da finalização.")
    return status, data


class FINAL:
    @staticmethod
    def editar(id_, b):
        """id = id do treinador. Cria a linha se ainda não existe."""
        status, data = final_valido(b)
        db().execute(
            """INSERT INTO final (jogador, status, data) VALUES (?,?,?)
               ON CONFLICT(jogador) DO UPDATE SET status = excluded.status, data = excluded.data""",
            (id_, status, data),
        )


# recurso da URL -> regras (usado em /api/<recurso>)
CRUD = {"jogador": JOGADOR, "luta": LUTA, "final": FINAL}
