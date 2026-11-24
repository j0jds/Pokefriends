// =====================================================================
// LIGA POKÉMON — front-end (JS puro, sem bibliotecas)
// =====================================================================

// ---------- Configurações ----------
const ATUALIZA_MS = 30000; // atualização automática da tela
const PONTOS_PADRAO = { j1: [3, 0], j2: [0, 3], empate: [1, 1] }; // pontos sugeridos [t1, t2] por resultado

// ---------- Estado ----------
let dados = { admin: false, tabela: [], jogadores: [], lutas: [] }; // tudo que vem do servidor
let aba = "tabela"; // aba aberta
let filtroRodada = ""; // rodada filtrada ('' = todas)
let token = lerToken(); // login do admin

// ---------- Utilitários ----------
const $ = (seletor) => document.querySelector(seletor);

// Escapa texto para não quebrar o HTML (segurança contra nomes maliciosos).
const esc = (t) =>
  String(t).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );

// Lê/guarda o token no navegador (try/catch: alguns navegadores bloqueiam).
function lerToken() {
  try {
    return localStorage.getItem("token") || "";
  } catch {
    return "";
  }
}
function guardarToken(t) {
  token = t;
  try {
    t ? localStorage.setItem("token", t) : localStorage.removeItem("token");
  } catch {
    /* ignora */
  }
}

// Mostra uma mensagem rápida na parte de baixo da tela.
function aviso(msg, comErro = false) {
  const el = $("#aviso");
  el.textContent = msg;
  el.className = "mostra" + (comErro ? " erro" : "");
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (el.className = ""), 2500);
}

// Chama a API. Lança erro com a mensagem do servidor se algo falhar.
async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json", "x-token": token },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "Erro inesperado.");
  return j;
}

// Executa uma ação de gravação, fecha a janela, recarrega os dados e avisa.
async function tentar(acao, janela) {
  try {
    await acao();
    janela?.close();
    await carregar();
    aviso("Salvo!");
  } catch (e) {
    aviso(e.message, true);
    carregar().catch(() => {}); // se a sessão expirou, a tela volta ao modo visitante
  }
}

// ---------- Carregar e desenhar ----------

// Busca tudo no servidor e redesenha a tela.
async function carregar() {
  dados = await api("GET", "/api/dados");
  render();
}

// Desenha cabeçalho, abas e o conteúdo da aba atual.
function render() {
  document.body.classList.toggle("admin", dados.admin);
  $("#btn-admin").textContent = dados.admin ? "Sair" : "Admin";
  if (!dados.admin && aba === "jogadores") aba = "tabela";
  document
    .querySelectorAll(".aba")
    .forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  $("#tela").innerHTML = {
    tabela: htmlTabela,
    lutas: htmlLutas,
    jogadores: htmlJogadores,
  }[aba]();
}

// Mensagem de "nada por aqui".
const vazio = (txt) => `<p class="vazio">${txt}</p>`;

// Últimos 5 resultados de um treinador, em bolinhas V (verde) / E (cinza) / D (vermelha).
function forma(id) {
  const letra = (l) => {
    if (l.resultado === "empate") return "e";
    return (l.resultado === "j1") === (l.j1 === id) ? "v" : "d";
  };
  return dados.lutas
    .filter((l) => l.resultado && (l.j1 === id || l.j2 === id))
    .slice(-5)
    .map((l) => `<i class="bolinha ${letra(l)}">${letra(l).toUpperCase()}</i>`)
    .join("");
}

// Aba Tabela: classificação ordenada pelo servidor.
function htmlTabela() {
  if (!dados.tabela.length) return vazio("Nenhum treinador cadastrado ainda.");
  const linhas = dados.tabela
    .map(
      (t, i) => `
    <tr class="pos${i + 1}">
      <td>${i + 1}º</td><td class="nome">${esc(t.nome)}</td><td class="pts">${
        t.pontos
      }</td>
      <td>${t.jogos}</td><td>${t.v}</td><td>${t.e}</td><td>${
        t.d
      }</td><td class="forma">${forma(t.id)}</td>
    </tr>`
    )
    .join("");
  return `<div class="rolagem"><table>
    <tr><th>#</th><th class="nome">Treinador</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th>Últimos</th></tr>
    ${linhas}</table></div>`;
}

// Aba Lutas: filtro de rodada + lutas agrupadas por rodada.
function htmlLutas() {
  const rodadas = [...new Set(dados.lutas.map((l) => l.rodada))];
  const opcoes = rodadas
    .map(
      (r) =>
        `<option value="${r}" ${
          r == filtroRodada ? "selected" : ""
        }>Rodada ${r}</option>`
    )
    .join("");
  const topo = `<div class="barra">
    <select id="filtro" style="width:auto;margin:0"><option value="">Todas as rodadas</option>${opcoes}</select>
    ${
      dados.admin
        ? '<button class="btn" data-acao="nova-luta">+ Nova luta</button>'
        : ""
    }</div>`;
  const grupos = rodadas
    .filter((r) => !filtroRodada || r == filtroRodada)
    .map(
      (r) =>
        `<h2>Rodada ${r}</h2>` +
        dados.lutas
          .filter((l) => l.rodada === r)
          .map(cartaLuta)
          .join("")
    )
    .join("");
  return topo + (grupos || vazio("Nenhuma luta cadastrada."));
}

// Desenha uma luta: nomes, placar de pontos e (se admin) botões.
function cartaLuta(l) {
  const lado = (x) =>
    l.resultado === x
      ? "venceu"
      : l.resultado && l.resultado !== "empate"
      ? "perdeu"
      : "";
  const rotulo =
    { "": "Pendente", empate: "Empate" }[l.resultado ?? ""] ?? "Finalizada";
  const placar =
    l.resultado || l.pts1 || l.pts2 ? `${l.pts1} × ${l.pts2}` : "vs"; // mostra pontos mesmo se pendente
  const botoes = dados.admin
    ? `<div class="acoes">
      <button class="btn claro mini" data-acao="editar-luta" data-id="${l.id}">Editar</button>
      <button class="btn perigo mini" data-acao="apagar-luta" data-id="${l.id}">Excluir</button></div>`
    : "";
  return `<div class="luta">
    <div class="lado ${lado("j1")}">${esc(l.n1)}</div>
    <div class="placar">${placar}<small>${rotulo}</small></div>
    <div class="lado ${lado("j2")}">${esc(l.n2)}</div>${botoes}</div>`;
}

// Aba Treinadores (só admin): lista com editar/excluir.
function htmlJogadores() {
  const itens = dados.jogadores
    .map(
      (j) => `<div class="item">${esc(j.nome)}<span>
      <button class="btn claro mini" data-acao="editar-jogador" data-id="${
        j.id
      }">Editar</button>
      <button class="btn perigo mini" data-acao="apagar-jogador" data-id="${
        j.id
      }">Excluir</button></span></div>`
    )
    .join("");
  return `<div class="barra"><span></span><button class="btn" data-acao="novo-jogador">+ Novo treinador</button></div>
    <h2>Treinadores (${dados.jogadores.length})</h2>${
    itens || vazio("Nenhum treinador ainda.")
  }`;
}

// ---------- Treinadores: abrir janela, salvar, apagar ----------

// Abre a janela para criar (sem argumento) ou editar um treinador.
function abrirJogador(j) {
  const f = $("#f-jogador").elements;
  $("#titulo-jogador").textContent = j ? "Editar treinador" : "Novo treinador";
  f.jogador.value = j?.id || "";
  f.nome.value = j?.nome || "";
  $("#dlg-jogador").showModal();
}

// Salva o treinador (POST se novo, PUT se existente).
function salvarJogador(e) {
  e.preventDefault();
  const f = e.target.elements;
  const id = f.jogador.value;
  tentar(
    () =>
      api(id ? "PUT" : "POST", "/api/jogador" + (id ? "/" + id : ""), {
        nome: f.nome.value,
      }),
    $("#dlg-jogador")
  );
}

// Exclui o treinador (e as lutas dele) depois de confirmar.
function apagarJogador(id) {
  const j = dados.jogadores.find((x) => x.id === id);
  if (confirm(`Excluir ${j.nome}? As lutas dele também serão apagadas.`))
    tentar(() => api("DELETE", "/api/jogador/" + id));
}

// ---------- Lutas: abrir janela, salvar, apagar ----------

// Monta as <option> de treinadores, marcando o selecionado.
const opcoesJogador = (sel) =>
  dados.jogadores
    .map(
      (j) =>
        `<option value="${j.id}" ${j.id === sel ? "selected" : ""}>${esc(
          j.nome
        )}</option>`
    )
    .join("");

// Abre a janela para criar (sem argumento) ou editar uma luta.
function abrirLuta(l) {
  if (dados.jogadores.length < 2)
    return aviso("Cadastre ao menos 2 treinadores antes.", true);
  const f = $("#f-luta").elements;
  $("#titulo-luta").textContent = l ? "Editar luta" : "Nova luta";
  f.luta.value = l?.id || "";
  f.rodada.value =
    l?.rodada ?? Math.max(1, ...dados.lutas.map((x) => x.rodada));
  f.j1.innerHTML = opcoesJogador(l?.j1 ?? dados.jogadores[0].id);
  f.j2.innerHTML = opcoesJogador(l?.j2 ?? dados.jogadores[1].id);
  f.resultado.value = l?.resultado || "";
  f.pts1.value = l?.pts1 ?? 0;
  f.pts2.value = l?.pts2 ?? 0;
  $("#dlg-luta").showModal();
}

// Ao escolher o resultado, sugere os pontos (só se ainda estiverem "intocados").
function sugerirPontos() {
  const f = $("#f-luta").elements;
  const sugestao = PONTOS_PADRAO[f.resultado.value];
  const intocado = [[0, 0], ...Object.values(PONTOS_PADRAO)].some(
    ([a, b]) => a == f.pts1.value && b == f.pts2.value
  );
  if (sugestao && intocado) [f.pts1.value, f.pts2.value] = sugestao;
}

// Se os pontos foram digitados com o resultado ainda "Pendente", deduz o resultado.
function inferirResultado() {
  const f = $("#f-luta").elements;
  const a = Number(f.pts1.value),
    b = Number(f.pts2.value);
  if (f.resultado.value || (!a && !b)) return;
  f.resultado.value = a > b ? "j1" : a < b ? "j2" : "empate";
}

// Salva a luta (POST se nova, PUT se existente).
function salvarLuta(e) {
  e.preventDefault();
  inferirResultado();
  const f = e.target.elements;
  const id = f.luta.value;
  const corpo = {
    rodada: f.rodada.value,
    j1: f.j1.value,
    j2: f.j2.value,
    resultado: f.resultado.value,
    pts1: f.pts1.value,
    pts2: f.pts2.value,
  };
  tentar(
    () => api(id ? "PUT" : "POST", "/api/luta" + (id ? "/" + id : ""), corpo),
    $("#dlg-luta")
  );
}

// Exclui a luta depois de confirmar.
function apagarLuta(id) {
  if (confirm("Excluir esta luta?"))
    tentar(() => api("DELETE", "/api/luta/" + id));
}

// ---------- Login do admin ----------

// Envia a senha; se certa, guarda o token e libera o modo admin.
async function entrar(e) {
  e.preventDefault();
  try {
    const r = await api("POST", "/api/login", {
      senha: e.target.elements.senha.value,
    });
    guardarToken(r.token);
    e.target.reset();
    $("#dlg-login").close();
    await carregar();
  } catch (err) {
    aviso(err.message, true);
  }
}

// Encerra a sessão do admin.
async function sair() {
  await api("POST", "/api/logout").catch(() => {});
  guardarToken("");
  await carregar();
}

// ---------- Eventos ----------

// Cada botão tem data-acao; aqui ficam as funções de cada ação.
const ACOES = {
  aba: (el) => {
    aba = el.dataset.aba;
    render();
  },
  admin: () => (dados.admin ? sair() : $("#dlg-login").showModal()),
  fechar: (el) => el.closest("dialog").close(),
  "nova-luta": () => abrirLuta(),
  "editar-luta": (el) =>
    abrirLuta(dados.lutas.find((l) => l.id === +el.dataset.id)),
  "apagar-luta": (el) => apagarLuta(+el.dataset.id),
  "novo-jogador": () => abrirJogador(),
  "editar-jogador": (el) =>
    abrirJogador(dados.jogadores.find((j) => j.id === +el.dataset.id)),
  "apagar-jogador": (el) => apagarJogador(+el.dataset.id),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-acao]");
  if (el) ACOES[el.dataset.acao](el);
});
document.addEventListener("change", (e) => {
  if (e.target.id === "filtro") {
    filtroRodada = e.target.value;
    render();
  }
  if (e.target.name === "resultado") sugerirPontos();
  if (e.target.name === "pts1" || e.target.name === "pts2") inferirResultado();
});
$("#f-login").addEventListener("submit", entrar);
$("#f-jogador").addEventListener("submit", salvarJogador);
$("#f-luta").addEventListener("submit", salvarLuta);

// ---------- Início ----------
carregar().catch(() => aviso("Sem conexão com o servidor.", true));
setInterval(() => {
  if (!document.querySelector("dialog[open]")) carregar().catch(() => {});
}, ATUALIZA_MS);
