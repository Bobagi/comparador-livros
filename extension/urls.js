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
