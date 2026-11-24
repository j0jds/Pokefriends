// =====================================================================
// LIGA POKÉMON — servidor (API + arquivos do site). Sem dependências.
// Requer Node 22.5+ (usa o SQLite embutido: node:sqlite).
// =====================================================================
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const util = require("node:util");
const { DatabaseSync } = require("node:sqlite");

// ---------- Configuração (arquivo config.env ou variáveis de ambiente) ----------

// Lê o config.env (formato CHAVE='valor') sem sobrescrever variáveis de ambiente reais.
// Assim a senha fica fora do código e fora do git.
function carregarConfig() {
  try {
    const texto = fs
      .readFileSync(path.join(__dirname, "..", "config", "config.env"), "utf8")
      .replace(/^\uFEFF/, "");
    for (const [chave, valor] of Object.entries(util.parseEnv(texto)))
      process.env[chave] ??= valor;
  } catch {
    /* sem config.env: usa só as variáveis de ambiente */
  }
}
carregarConfig();
const SENHA_ADMIN = process.env.ADMIN_SENHA;
if (!SENHA_ADMIN) {
  console.error(
    "Defina ADMIN_SENHA no arquivo config.env (veja config.exemplo.env) antes de iniciar o servidor."
  );
  process.exit(1);
}
const PORTA = process.env.PORT || 3000;
const ARQUIVO_DB = process.env.DB_ARQUIVO || path.join(__dirname, "..", "data", "dados.db");
const PUBLICO = path.join(__dirname, "..", "public");
const LIMITE_CORPO = 2e6; // tamanho máximo do JSON recebido (replays são grandes)
const SESSAO_MS = 12 * 60 * 60 * 1000; // login do admin vale 12h
const TIPOS = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

// ---------- Banco de dados (3 tabelas) ----------
fs.mkdirSync(path.dirname(ARQUIVO_DB), { recursive: true }); // cria data/ se não existir
const db = new DatabaseSync(ARQUIVO_DB);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = DELETE;   -- grava direto no dados.db (sem arquivos -wal/-shm)
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
`);
// Bancos criados antes do replay ganham a coluna nova sem perder dados.
if (
  !db
    .prepare("PRAGMA table_info(luta)")
    .all()
    .some((c) => c.name === "replay")
) {
  db.exec("ALTER TABLE luta ADD COLUMN replay TEXT");
}

// Classificação: os PONTOS somam sempre que forem lançados na luta;
// J/V/E/D só contam quando a luta tem resultado.
// Ordem: mais pontos, depois mais vitórias, depois nome.
const SQL_TABELA = `
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
   GROUP BY j.id ORDER BY pontos DESC, v DESC, j.nome`;

// Finalizações: todos os treinadores; quem está 'finished' vem primeiro, na ordem em
// que terminou; os demais vêm depois, por nome. Quem nunca foi editado = 'andamento'.
const SQL_FINAL = `
  SELECT j.id, j.nome, COALESCE(f.status, 'andamento') AS status, f.data
    FROM jogador j LEFT JOIN final f ON f.jogador = j.id
   ORDER BY (f.status = 'finished') DESC, f.data, f.rowid, j.nome`;

// Lutas com o nome dos dois jogadores, por rodada.
const SQL_LUTAS = `
  SELECT l.id, l.rodada, l.j1, l.j2, l.resultado, l.pts1, l.pts2, l.replay IS NOT NULL AS replay,
         a.nome AS n1, b.nome AS n2
    FROM luta l JOIN jogador a ON a.id = l.j1 JOIN jogador b ON b.id = l.j2
   ORDER BY l.rodada, l.id`;

// ---------- Utilitários ----------

// Cria um erro com status HTTP (400, 401, 404...).
const erro = (status, msg) => Object.assign(new Error(msg), { status });

// Converte erros do SQLite em mensagens amigáveis.
function traduzir(e) {
  if (e.status) return { status: e.status, erro: e.message };
  if (/UNIQUE/.test(e.message))
    return { status: 409, erro: "Esse nome já está cadastrado." };
  if (/FOREIGN KEY/.test(e.message))
    return { status: 400, erro: "Jogador não existe." };
  console.error(e);
  return { status: 500, erro: "Erro interno." };
}

// Envia resposta JSON.
function enviar(res, status, corpo) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corpo));
}

// Lê o corpo JSON da requisição (limite de 100 KB).
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let txt = "";
    req.on("data", (c) => {
      txt += c;
      if (txt.length > LIMITE_CORPO) {
        req.destroy();
        falha(erro(413, "Corpo grande demais."));
      }
    });
    req.on("end", () => {
      try {
        ok(JSON.parse(txt || "{}"));
      } catch {
        falha(erro(400, "JSON inválido."));
      }
    });
  });
}

// Converte para inteiro; vazio vira o padrão; texto inválido gera erro.
function inteiro(v, nome, padrao) {
  if (v === "" || v == null) return padrao;
  const n = Number(v);
  if (!Number.isInteger(n) || Math.abs(n) > 100000)
    throw erro(400, `${nome} inválido.`);
  return n;
}

// ---------- Login do admin ----------
const sessoes = new Map(); // token -> data de expiração

// Compara duas senhas sem vazar informação por tempo de resposta.
const senhaCerta = (s) => {
  const h = (x) => crypto.createHash("sha256").update(String(x)).digest();
  return crypto.timingSafeEqual(h(s), h(SENHA_ADMIN));
};

// Diz se a requisição traz um token de admin válido.
function ehAdmin(req) {
  const exp = sessoes.get(req.headers["x-token"]);
  return Boolean(exp && exp > Date.now());
}

// Bloqueia a rota se não for admin.
function exigirAdmin(req) {
  if (!ehAdmin(req))
    throw erro(401, "Sessão expirada. Entre como admin de novo.");
}

// ---------- Regras de cada tabela (criar / editar / apagar) ----------

// Garante que a operação mudou alguma linha.
function achou(r) {
  if (!r.changes) throw erro(404, "Não encontrado.");
}

// Valida e limpa o nome do treinador.
function nomeValido(b) {
  const nome = String(b.nome || "").trim();
  if (!nome || nome.length > 40)
    throw erro(400, "Nome deve ter de 1 a 40 letras.");
  return nome;
}

const JOGADOR = {
  criar: (b) =>
    db.prepare("INSERT INTO jogador (nome) VALUES (?)").run(nomeValido(b)),
  editar: (id, b) =>
    achou(
      db
        .prepare("UPDATE jogador SET nome = ? WHERE id = ?")
        .run(nomeValido(b), id)
    ),
  apagar: (id) => achou(db.prepare("DELETE FROM jogador WHERE id = ?").run(id)), // apaga as lutas dele junto
};

// Valida o log do replay (texto do Showdown). Vazio = sem replay.
function replayValido(txt) {
  const log = String(txt || "").trim();
  if (!log) return null;
  if (!/^\|player\|p1\|/m.test(log))
    throw erro(400, "Arquivo de replay inválido (não achei o log da batalha).");
  return log;
}

// Valida e limpa os dados de uma luta.
function lutaValida(b) {
  const l = {
    rodada: inteiro(b.rodada, "Rodada", 1),
    j1: inteiro(b.j1, "Jogador 1"),
    j2: inteiro(b.j2, "Jogador 2"),
    resultado: b.resultado || null,
    pts1: inteiro(b.pts1, "Pontos do jogador 1", 0),
    pts2: inteiro(b.pts2, "Pontos do jogador 2", 0),
  };
  if (l.rodada < 1) throw erro(400, "Rodada deve ser 1 ou mais.");
  if (!l.j1 || !l.j2 || l.j1 === l.j2)
    throw erro(400, "Escolha dois jogadores diferentes.");
  if (l.resultado && !["j1", "j2", "empate"].includes(l.resultado))
    throw erro(400, "Resultado inválido.");
  return l;
}

const LUTA = {
  criar: (b) => {
    const l = lutaValida(b);
    db.prepare(
      "INSERT INTO luta (rodada, j1, j2, resultado, pts1, pts2, replay) VALUES (?,?,?,?,?,?,?)"
    ).run(
      l.rodada,
      l.j1,
      l.j2,
      l.resultado,
      l.pts1,
      l.pts2,
      replayValido(b.replay)
    );
  },
  editar: (id, b) => {
    const l = lutaValida(b);
    achou(
      db
        .prepare(
          "UPDATE luta SET rodada=?, j1=?, j2=?, resultado=?, pts1=?, pts2=? WHERE id=?"
        )
        .run(l.rodada, l.j1, l.j2, l.resultado, l.pts1, l.pts2, id)
    );
    // replay: ausente = mantém o atual; texto = troca; vazio = remove
    if ("replay" in b)
      db.prepare("UPDATE luta SET replay = ? WHERE id = ?").run(
        replayValido(b.replay),
        id
      );
  },
  apagar: (id) => achou(db.prepare("DELETE FROM luta WHERE id = ?").run(id)),
};

// Validação da finalização: 'finished' exige data/hora (AAAA-MM-DDTHH:MM[:SS]).
function finalValido(b) {
  const status = b.status === "finished" ? "finished" : "andamento";
  const data = String(b.data || "").trim();
  if (status === "andamento") return { status, data: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(data))
    throw erro(400, "Informe a data e hora da finalização.");
  return { status, data };
}

// Finalização de um treinador (id = id do treinador). Cria a linha se ainda não existe.
const FINAL = {
  editar: (id, b) => {
    const f = finalValido(b);
    db.prepare(
      `INSERT INTO final (jogador, status, data) VALUES (?,?,?)
                ON CONFLICT(jogador) DO UPDATE SET status = excluded.status, data = excluded.data`
    ).run(id, f.status, f.data);
  },
};

// ---------- API ----------

// Trata todas as rotas /api/...
async function api(req, res, pathname) {
  const metodo = req.method;
  const [, recurso, id] = pathname.match(/^\/api\/(\w+)(?:\/(\d+))?$/) || [];

  // Rotas públicas
  if (metodo === "GET" && recurso === "dados") {
    return enviar(res, 200, {
      admin: ehAdmin(req),
      tabela: db.prepare(SQL_TABELA).all(),
      jogadores: db.prepare("SELECT id, nome FROM jogador ORDER BY nome").all(),
      lutas: db.prepare(SQL_LUTAS).all(),
      final: db.prepare(SQL_FINAL).all(),
    });
  }
  if (metodo === "POST" && recurso === "login") {
    if (!senhaCerta((await lerCorpo(req)).senha))
      throw erro(401, "Senha incorreta.");
    const token = crypto.randomBytes(24).toString("hex");
    sessoes.set(token, Date.now() + SESSAO_MS);
    return enviar(res, 200, { token });
  }

  // Daqui para baixo: só admin
  exigirAdmin(req);
  if (metodo === "POST" && recurso === "logout") {
    sessoes.delete(req.headers["x-token"]);
    return enviar(res, 200, { ok: true });
  }
  const crud = { jogador: JOGADOR, luta: LUTA, final: FINAL }[recurso];
  if (!crud) throw erro(404, "Rota não encontrada.");

  // POST sem id = criar; PUT com id = editar; DELETE com id = apagar
  const op = {
    POST: !id && "criar",
    PUT: id && "editar",
    DELETE: id && "apagar",
  }[metodo];
  if (!op || !crud[op]) throw erro(405, "Método não permitido.");
  crud[op](
    ...(id ? [Number(id)] : []),
    ...(metodo === "DELETE" ? [] : [await lerCorpo(req)])
  );
  enviar(res, 200, { ok: true });
}

// ---------- Replay da batalha ----------

// Escapa texto para colocar dentro de HTML.
const html = (t) =>
  String(t).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );

// Monta a página de replay do Showdown (mesma estrutura do arquivo .html original):
// o log vai num <script type="text/plain"> e o replay-embed.js do Showdown toca a batalha.
function paginaReplay(id, log) {
  const tier = (log.match(/^\|tier\|(.*)$/m) || [, "Batalha"])[1];
  const p1 = (log.match(/^\|player\|p1\|([^|]*)/m) || [, "?"])[1];
  const p2 = (log.match(/^\|player\|p2\|([^|]*)/m) || [, "?"])[1];
  return `<!DOCTYPE html>
<meta charset="utf-8" />
<title>${html(tier)}: ${html(p1)} vs. ${html(p2)}</title>
<style>html,body{font-family:Verdana,sans-serif;font-size:10pt;margin:0;padding:0}body{padding:12px 0}</style>
<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">
<input type="hidden" name="replayid" value="luta-${id}" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<h1 style="font-weight:normal;text-align:center"><strong>${html(
    tier
  )}</strong><br />${html(p1)} vs. ${html(p2)}</h1>
<script type="text/plain" class="battle-log-data">
${log.replace(/<\/(script)/gi, "<\\/$1")}
</script>
</div>
<script>
let daily = Math.floor(Date.now()/1000/60/60/24);document.write('<script src="https://play.pokemonshowdown.com/js/replay-embed.js?version'+daily+'"></'+'script>');
</script>`;
}

// Responde GET /replay/ID com a página acima (404 se a luta não tem replay).
function replay(res, id) {
  const l = db.prepare("SELECT replay FROM luta WHERE id = ?").get(id);
  if (!l?.replay)
    return enviar(res, 404, { erro: "Esta luta não tem replay." });
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(paginaReplay(id, l.replay));
}

// ---------- Arquivos do site (pasta public/) ----------

// Entrega HTML/CSS/JS, bloqueando acesso a fora da pasta public.
function estatico(res, pathname) {
  const arquivo = path.join(
    PUBLICO,
    pathname === "/" ? "index.html" : pathname
  );
  if (!arquivo.startsWith(PUBLICO + path.sep))
    return enviar(res, 403, { erro: "Proibido." });
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) return enviar(res, 404, { erro: "Não encontrado." });
    const tipo = TIPOS[path.extname(arquivo)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": tipo + (/^text|svg/.test(tipo) ? "; charset=utf-8" : ""),
      "Cache-Control":
        tipo.startsWith("image/") && !tipo.includes("svg")
          ? "public, max-age=86400"
          : "no-cache", // imagens ficam 1 dia em cache
      "X-Content-Type-Options": "nosniff",
    });
    res.end(conteudo);
  });
}

// ---------- Inicialização ----------
http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://local");
      const rp = pathname.match(/^\/replay\/(\d+)$/);
      if (rp) replay(res, Number(rp[1]));
      else if (pathname.startsWith("/api/")) await api(req, res, pathname);
      else estatico(res, decodeURIComponent(pathname));
    } catch (e) {
      const t = traduzir(e);
      enviar(res, t.status, { erro: t.erro });
    }
  })
  .listen(PORTA, () => {
    console.log(`Liga Pokémon rodando em http://localhost:${PORTA}`);
  });
