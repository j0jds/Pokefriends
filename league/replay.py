# =====================================================================
# LIGA POKÉMON — página do replay (monta o HTML que toca a batalha)
# =====================================================================
import re
from html import escape
from string import Template

# Mesma estrutura do arquivo .html original do Showdown: o log vai num
# <script type="text/plain"> e o replay-embed.js do Showdown toca a batalha.
_PAGINA = Template("""<!DOCTYPE html>
<meta charset="utf-8" />
<title>${tier}: ${p1} vs. ${p2}</title>
<style>html,body{font-family:Verdana,sans-serif;font-size:10pt;margin:0;padding:0}body{padding:12px 0}</style>
<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">
<input type="hidden" name="replayid" value="luta-${id}" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<h1 style="font-weight:normal;text-align:center"><strong>${tier}</strong><br />${p1} vs. ${p2}</h1>
<script type="text/plain" class="battle-log-data">
${log}
</script>
</div>
<script>
let daily = Math.floor(Date.now()/1000/60/60/24);document.write('<script src="https://play.pokemonshowdown.com/js/replay-embed.js?version'+daily+'"></'+'script>');
</script>""")


def _achar(padrao, log, reserva):
    m = re.search(padrao, log, re.MULTILINE)
    return m.group(1).rstrip("\r") if m else reserva


def pagina_replay(id_, log):
    """Devolve o HTML do replay da luta `id_`, a partir do log salvo no banco."""
    tier = _achar(r"^\|tier\|(.*)$", log, "Batalha")
    p1 = _achar(r"^\|player\|p1\|([^|]*)", log, "?")
    p2 = _achar(r"^\|player\|p2\|([^|]*)", log, "?")
    return _PAGINA.substitute(
        id=id_,
        tier=escape(tier),
        p1=escape(p1),
        p2=escape(p2),
        # impede que o texto do log feche o <script> antes da hora
        log=re.sub(r"</(script)", r"<\\/\1", log, flags=re.IGNORECASE),
    )
