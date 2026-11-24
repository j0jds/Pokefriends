// =====================================================================
// LIGA POKÉMON — servidor (API + arquivos do site). Sem dependências.
// Requer Node 22.5+ (usa o SQLite embutido: node:sqlite).
// =====================================================================
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

// ---------- Configuração (pode vir de variáveis de ambiente) ----------
const PORTA = process.env.PORT || 3000;
const SENHA_ADMIN = process.env.ADMIN_SENHA || "admin123";
const ARQUIVO_DB = process.env.DB_ARQUIVO || path.join(__dirname, "dados.db");
const PUBLICO = path.join(__dirname, "public");
const SESSAO_MS = 12 * 60 * 60 * 1000; // login do admin vale 12h
const TIPOS = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
};

// ---------- Banco de dados (2 tabelas) ----------
const db = new DatabaseSync(ARQUIVO_DB);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
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
    CHECK (j1 <> j2)
  );
`);

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

// Lutas com o nome dos dois jogadores, por rodada.
const SQL_LUTAS = `
  SELECT l.*, a.nome AS n1, b.nome AS n2
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
      if (txt.length > 1e5) {
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
      "INSERT INTO luta (rodada, j1, j2, resultado, pts1, pts2) VALUES (?,?,?,?,?,?)"
    ).run(l.rodada, l.j1, l.j2, l.resultado, l.pts1, l.pts2);
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
  },
  apagar: (id) => achou(db.prepare("DELETE FROM luta WHERE id = ?").run(id)),
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
  const crud = { jogador: JOGADOR, luta: LUTA }[recurso];
  if (!crud) throw erro(404, "Rota não encontrada.");

  if (metodo === "POST" && !id) crud.criar(await lerCorpo(req));
  else if (metodo === "PUT" && id) crud.editar(Number(id), await lerCorpo(req));
  else if (metodo === "DELETE" && id) crud.apagar(Number(id));
  else throw erro(405, "Método não permitido.");
  enviar(res, 200, { ok: true });
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
    res.writeHead(200, {
      "Content-Type":
        (TIPOS[path.extname(arquivo)] || "application/octet-stream") +
        "; charset=utf-8",
      "Cache-Control": "no-cache",
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
      if (pathname.startsWith("/api/")) await api(req, res, pathname);
      else estatico(res, decodeURIComponent(pathname));
    } catch (e) {
      const t = traduzir(e);
      enviar(res, t.status, { erro: t.erro });
    }
  })
  .listen(PORTA, () => {
    console.log(`Liga Pokémon rodando em http://localhost:${PORTA}`);
    if (!process.env.ADMIN_SENHA)
      console.warn(
        'ATENÇÃO: usando a senha padrão "admin123". Defina ADMIN_SENHA.'
      );
  });
