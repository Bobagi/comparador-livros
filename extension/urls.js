// Logica pura (sem chrome.*) de montagem de URL e allowlist de host, para ser
// unit-testada. Segredo de seguranca das duas: o host/esquema e SEMPRE literal
// do proprio produto, nunca vem do input.

// URL do site a partir de um host FIXO (backend) + query do usuario codificada.
// O esquema e o host sao literais -> nao ha como injetar javascript:/host outro.
export function buildSiteUrl(backend, query) {
  let url = backend + '/';
  const q = (query || '').trim();
  if (q) url += '?q=' + encodeURIComponent(q.slice(0, 120));
  return url;
}

// A pagina que pede uma coleta tem que ser um host do proprio produto. O
// sufixo '/' e o que impede o bypass por prefixo
// (https://farolivro.bobagi.space.evil.com/ NAO comeca com
//  https://farolivro.bobagi.space/).
export function pageAllowed(pageHosts, url) {
  return !!url && pageHosts.some((h) => url.startsWith(h + '/'));
}

// Texto amigavel para cada resultado de chrome.runtime.requestUpdateCheck.
// Compartilhado pelo popup e pelo site para a copy ficar consistente.
// `version` = versao nova (quando disponivel).
export function updateStatusText(status, version) {
  switch (status) {
    case 'update_available':
      return version
        ? `Atualizando o Farolivro para a v${version}...`
        : 'Atualizando o Farolivro...';
    case 'no_update':
      return 'Voce ja esta na versao mais recente.';
    case 'throttled':
      return 'O Chrome esta limitando a checagem. Tente de novo em alguns minutos.';
    default:
      // 'error' (ex.: extensao carregada em modo desenvolvedor, sem loja) ou
      // qualquer status inesperado: o Chrome atualiza sozinho de qualquer forma.
      return 'Nao deu para checar agora. O Chrome atualiza a extensao sozinho em ate algumas horas.';
  }
}
