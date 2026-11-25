# =====================================================================
# LIGA POKÉMON — banco de dados (SQLite do próprio Python, sem instalar nada)
# =====================================================================
import sqlite3
from pathlib import Path

from flask import current_app, g

# ---------- Tabelas (4: jogador, luta, final e sessao) ----------
ESQUEMA = """
  CREATE TABLE IF NOT EXISTS jogador (
    id   INTEGER PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS luta (
    id        INTEGER PRIMARY KEY,
    rodada    INTEGER NOT NULL DEFAULT 1,
    j1        INTEGER NOT NULL REFERENCES jogador(id) ON DELETE CASCADE,
    j2        INTEGER NOT NULL REFERENCES jogador(id) ON DELETE CASCADE,
    resultado TEXT CHECK (resultado IN ('j1','j2','empate')), -- NULL = pendente
    pts1      INTEGER NOT NULL DEFAULT 0,
    pts2      INTEGER NOT NULL DEFAULT 0,
    replay    TEXT,                                           -- log da batalha do Showdown (opcional)
    CHECK (j1 <> j2)
  );
  CREATE TABLE IF NOT EXISTS final (
    jogador INTEGER PRIMARY KEY REFERENCES jogador(id) ON DELETE CASCADE,
    status  TEXT NOT NULL DEFAULT 'andamento' CHECK (status IN ('andamento','finished')),
    data    TEXT                                              -- quando terminou (define a ordem)
  );
  CREATE TABLE IF NOT EXISTS sessao (
    token  TEXT PRIMARY KEY,                                  -- assinatura do token (nunca o token em si)
    expira INTEGER NOT NULL                                   -- segundos Unix em que o login vence
  );
"""

# Classificação: os PONTOS somam sempre que forem lançados na luta;
# J/V/E/D só contam quando a luta tem resultado.
# Ordem: mais pontos, depois mais vitórias, depois nome.
SQL_TABELA = """
  WITH partida AS (
    SELECT j1 AS jogador, resultado IS NOT NULL AS fim, resultado = 'j1' AS v, resultado = 'empate' AS e, resultado = 'j2' AS d, pts1 AS pts
      FROM luta
    UNION ALL
    SELECT j2, resultado IS NOT NULL, resultado = 'j2', resultado = 'empate', resultado = 'j1', pts2
      FROM luta
  )
  SELECT j.id, j.nome, COALESCE(SUM(p.fim), 0) AS jogos,
         COALESCE(SUM(p.v), 0) AS v, COALESCE(SUM(p.e), 0) AS e,
         COALESCE(SUM(p.d), 0) AS d, COALESCE(SUM(p.pts), 0) AS pontos
    FROM jogador j LEFT JOIN partida p ON p.jogador = j.id
   GROUP BY j.id ORDER BY pontos DESC, v DESC, j.nome"""

# Finalizações: todos os treinadores; quem está 'finished' vem primeiro, na ordem em
# que terminou; os demais vêm depois, por nome. Quem nunca foi editado = 'andamento'.
SQL_FINAL = """
  SELECT j.id, j.nome, COALESCE(f.status, 'andamento') AS status, f.data
    FROM jogador j LEFT JOIN final f ON f.jogador = j.id
   ORDER BY (f.status = 'finished') DESC, f.data, f.rowid, j.nome"""

# Lutas com o nome dos dois jogadores, por rodada (não traz o texto do replay).
SQL_LUTAS = """
  SELECT l.id, l.rodada, l.j1, l.j2, l.resultado, l.pts1, l.pts2, l.replay IS NOT NULL AS replay,
         a.nome AS n1, b.nome AS n2
    FROM luta l JOIN jogador a ON a.id = l.j1 JOIN jogador b ON b.id = l.j2
   ORDER BY l.rodada, l.id"""


# ---------- Conexão ----------

def _conectar(arquivo):
    """Abre uma conexão nova. O SQLite exige uma por requisição (threads/workers)."""
    con = sqlite3.connect(arquivo, timeout=10)  # espera até 10s se outro worker estiver gravando
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")  # vale só para esta conexão (CASCADE depende disso)
    return con


def iniciar_banco(arquivo):
    """Cria data/ e as tabelas se não existirem; atualiza bancos antigos sem perder dados."""
    Path(arquivo).parent.mkdir(parents=True, exist_ok=True)
    con = _conectar(arquivo)
    try:
        con.execute("PRAGMA journal_mode = DELETE")  # grava direto no dados.db (sem -wal/-shm)
        con.executescript(ESQUEMA)
        # Bancos criados antes do replay ganham a coluna nova.
        colunas = [c["name"] for c in con.execute("PRAGMA table_info(luta)")]
        if "replay" not in colunas:
            con.execute("ALTER TABLE luta ADD COLUMN replay TEXT")
        con.commit()
    finally:
        con.close()


def db():
    """Conexão da requisição atual (aberta na 1ª vez que é pedida, fechada no fim)."""
    if "db" not in g:
        g.db = _conectar(current_app.config["ARQUIVO_DB"])
    return g.db


def fechar_banco(_exc=None):
    con = g.pop("db", None)
    if con is not None:
        con.close()  # o que não recebeu commit é desfeito


def listar(sql, *params):
    """Executa uma consulta e devolve uma lista de dicionários (pronta para JSON)."""
    return [dict(r) for r in db().execute(sql, params).fetchall()]
