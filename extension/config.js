// Sem segredo nenhum aqui: a extensao se registra no backend no primeiro uso
// (POST /api/installs) e guarda o token proprio no chrome.storage.local.
export const CONFIG = {
  backend: 'https://farolivro.bobagi.space',
  // hosts do proprio produto onde a pagina pode pedir uma coleta (o antigo
  // livros.bobagi.space segue valido durante a migracao de dominio).
  pageHosts: ['https://farolivro.bobagi.space', 'https://livros.bobagi.space'],
};
