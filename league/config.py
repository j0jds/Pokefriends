# =====================================================================
# LIGA POKÉMON — configuração (config/config.env ou variáveis de ambiente)
# =====================================================================
import os
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent  # pasta do projeto (onde está o wsgi.py)
ARQUIVO_CONFIG = RAIZ / "config" / "config.env"

MSG_SEM_SENHA = (
    "Defina ADMIN_SENHA no arquivo config/config.env (veja config.exemplo.env) "
    "antes de iniciar o servidor."
)

# Uma linha do config.env: CHAVE=valor, CHAVE='valor' ou CHAVE="valor", com # de comentário.
_LINHA = re.compile(
    r"""^[ \t]*(?:export[ \t]+)?([\w.-]+)[ \t]*=[ \t]*"""
    r"""('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^#\r\n]*)?"""
    r"""[ \t]*(?:#.*)?$""",
    re.MULTILINE,
)


def _ler_env(texto):
    """Converte o texto do config.env em dicionário.
    Aspas simples = valor literal (nada é escapado); aspas duplas aceitam \\n."""
    valores = {}
    for m in _LINHA.finditer(texto):
        chave, valor = m.group(1), (m.group(2) or "").strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "'\"`":
            aspas, valor = valor[0], valor[1:-1]
            if aspas == '"':
                valor = valor.replace("\\n", "\n")
        valores[chave] = valor
    return valores


def carregar_config():
    """Lê o config.env sem sobrescrever variáveis de ambiente reais.
    Assim a senha fica fora do código e fora do git."""
    try:
        texto = ARQUIVO_CONFIG.read_text(encoding="utf-8-sig")
    except OSError:
        return  # sem config.env: usa só as variáveis de ambiente
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")
    for chave, valor in _ler_env(texto).items():
        os.environ.setdefault(chave, valor)


def ler_config():
    """Devolve as configurações prontas. Sem ADMIN_SENHA o app não sobe."""
    carregar_config()
    senha = os.environ.get("ADMIN_SENHA")
    if not senha:
        raise RuntimeError(MSG_SEM_SENHA)

    arquivo_db = Path(os.environ.get("DB_ARQUIVO") or RAIZ / "data" / "dados.db")
    if not arquivo_db.is_absolute():
        arquivo_db = RAIZ / arquivo_db  # caminho relativo conta a partir da pasta do projeto

    return {
        "ADMIN_SENHA": senha,
        "ARQUIVO_DB": str(arquivo_db),
        "PUBLICO": str(RAIZ / "public"),
        "PORTA": int(os.environ.get("PORT") or 3000),
        "LIMITE_CORPO": 2_000_000,  # tamanho máximo do JSON recebido (replays são grandes)
        "SESSAO_S": 12 * 60 * 60,  # login do admin vale 12h
    }
