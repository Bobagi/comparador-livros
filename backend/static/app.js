/* Pagina do comparador. Fala com o backend por REST e com a extensao
   por eventos de DOM (payload sempre em JSON string, pelos mundos isolados). */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const form = $('#search-form');
  const input = $('#q');
  const go = $('#go');
  const extChip = $('#ext-chip');
  const extPanel = $('#ext-panel');
  const extUpdate = $('#ext-update');
  const extUpdateMsg = $('#ext-update-msg');
  const sniffer = $('#sniffer');
  const msg = $('#msg');
  const statusArea = $('#status-area');
  const results = $('#results');

  const STORE_LABEL = {
    mercadolivre: 'Mercado Livre', amazon: 'Amazon', estantevirtual: 'Estante Virtual',
    olx: 'OLX', enjoei: 'Enjoei', shopee: 'Shopee',
  };
  const STATUS_LABEL = {
    pending: 'farejando...', ok: 'ok', empty: 'vazio (parser falhou, amostra enviada)',
    blocked: 'bloqueado', error: 'erro', sem_coletor: 'sem o Farolivro',
  };
  const STATUS_LABEL_NO_EXT = { ...STATUS_LABEL, pending: 'aguardando o Farolivro' };

  let extReady = false;
  let pollTimer = null;

  const STORE_URL = 'https://chromewebstore.google.com/detail/farolivro/jnkjabpgnocifbnnceoepijbcggmkkek';

  // Versao mais recente da extensao = a do zip que este backend serve (mesmo
  // artefato enviado a loja), injetada no <meta> pelo build_index(). Formato
  // validado antes de exibir; se o meta faltar/for invalido, nada aparece.
  const extLatest = $('#ext-latest');
  const panelVer = $('#panel-ver');
  const metaVer = (document.querySelector('meta[name="farolivro-ext"]') || {}).content || '';
  const latestVer = /^\d+(\.\d+){1,3}$/.test(metaVer) ? metaVer : '';
  if (latestVer) {
    extLatest.textContent = `mais recente: v${latestVer}`;
    extLatest.hidden = false;
    panelVer.textContent = `Versao mais recente da extensao: v${latestVer}.`;
    panelVer.hidden = false;
  }

  function setExt(ready, version) {
    extReady = ready;
    extChip.replaceChildren();
    if (ready) {
      extChip.textContent = `Farolivro conectado v${version}`;
    } else {
      const a = document.createElement('a');
      a.href = STORE_URL;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Instalar o Farolivro';
      extChip.appendChild(a);
    }
    extChip.classList.toggle('chip-on', ready);
    extChip.classList.toggle('chip-off', !ready);
    extPanel.hidden = ready;
    extUpdate.hidden = !ready; // botao de atualizar so faz sentido conectado
    if (!ready) { extUpdateMsg.hidden = true; }
    // instalada != mais recente: o botao vira chamada direta de atualizacao
    const outdated = ready && latestVer && version && version !== latestVer;
    extUpdate.classList.toggle('has-update', outdated);
    extUpdate.textContent = outdated ? `Atualizar para v${latestVer}` : 'Verificar atualizacao';
  }
  setExt(false);
  extPanel.hidden = false;

  document.addEventListener('livros:ext-ready', (ev) => {
    let v = '?';
    try { v = JSON.parse(ev.detail || '{}').version || '?'; } catch {}
    setExt(true, v);
    maybeRunDeepLink();
  });
  document.dispatchEvent(new CustomEvent('livros:ping'));

  // Botao "Verificar atualizacao": pede a extensao para checar a loja e, se
  // houver versao nova aprovada, aplicar na hora (o Chrome ja atualiza sozinho
  // em algumas horas; isto so adianta). Copia da mesma copy do popup.
  function updateStatusText(status, version) {
    switch (status) {
      case 'update_available':
        return version ? `Atualizando para a v${version}...` : 'Atualizando...';
      case 'no_update': return 'Voce ja esta na versao mais recente.';
      case 'throttled': return 'O Chrome esta limitando a checagem. Tente em alguns minutos.';
      default: return 'Nao deu para checar agora. O Chrome atualiza sozinho em ate algumas horas.';
    }
  }
  extUpdate.addEventListener('click', () => {
    extUpdate.disabled = true;
    extUpdateMsg.hidden = false;
    extUpdateMsg.textContent = 'Checando...';
    document.dispatchEvent(new CustomEvent('livros:check-update'));
  });
  document.addEventListener('livros:update-status', (ev) => {
    let res = {};
    try { res = JSON.parse(ev.detail || '{}'); } catch {}
    extUpdateMsg.hidden = false;
    extUpdateMsg.textContent = updateStatusText(res.status, res.version);
    if (res.status === 'update_available') {
      // a extensao vai recarregar (o bridge cai); recarrega a pagina para
      // reconectar na versao nova
      extUpdate.textContent = 'Atualizando...';
      setTimeout(() => location.reload(), 3000);
    } else {
      extUpdate.disabled = false;
    }
  });

  document.querySelectorAll('.ex').forEach((b) => {
    b.addEventListener('click', () => { input.value = b.textContent; form.requestSubmit(); });
  });

  // Deep-link do popup da extensao: /?q=<busca> preenche e ja fareja. Espera o
  // coletor anunciar (ext-ready) para nao cair no aviso "instale"; se ele nao
  // aparecer em 2.5s, submete assim mesmo (dai o proprio fluxo avisa).
  const deepQ = (new URLSearchParams(location.search).get('q') || '').trim();
  let deepDone = false;
  function maybeRunDeepLink() {
    if (deepDone || deepQ.length < 3) return;
    deepDone = true;
    input.value = deepQ.slice(0, 120);
    history.replaceState(null, '', location.pathname);  // limpa o ?q da barra
    form.requestSubmit();
  }
  if (deepQ) setTimeout(maybeRunDeepLink, 2500);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const query = input.value.trim();
    if (query.length < 3) return;
    go.disabled = true;
    showMsg('');
    try {
      const r = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!r.ok) throw new Error(`backend ${r.status}`);
      const data = await r.json();
      if (!data.cached) {
        if (extReady) {
          document.dispatchEvent(new CustomEvent('livros:collect', {
            detail: JSON.stringify({ searchId: data.id, query, canonical: data.canonical }),
          }));
        } else {
          showMsg('Sem o Farolivro instalado nada e buscado nas lojas. Instale a extensao abaixo e fareje de novo (ou aguarde: outra maquina com o Farolivro pode completar esta busca).');
        }
      }
      if (extReady) sniffer.hidden = false;
      poll(data.id);
    } catch (e) {
      sniffer.hidden = true;
      showMsg(`Falha ao criar a busca: ${e.message}`);
      go.disabled = false;
    }
  });

  function showMsg(text) { msg.textContent = text; msg.hidden = !text; }

  function poll(id) {
    clearInterval(pollTimer);
    const started = Date.now();
    const tick = async () => {
      try {
        const r = await fetch(`/api/searches/${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error(`backend ${r.status}`);
        const data = await r.json();
        render(data);
        if (data.done || Date.now() - started > 160000) {
          clearInterval(pollTimer);
          sniffer.hidden = true;
          go.disabled = false;
        }
      } catch (e) {
        clearInterval(pollTimer);
        sniffer.hidden = true;
        go.disabled = false;
        showMsg(`Falha ao ler resultados: ${e.message}`);
      }
    };
    tick();
    pollTimer = setInterval(tick, 2000);
  }

  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function offerCard(o) {
    const card = el('article', 'card');
    card.appendChild(el('span', o.price_cents ? 'price' : 'price nd',
      o.price_cents ? brl(o.price_cents) : 'sem preco visivel'));
    card.appendChild(el('span', 't', o.title));
    const meta = el('div', 'meta');
    meta.appendChild(el('span', 'tag loja', STORE_LABEL[o.store] || o.store));
    if (o.condition) meta.appendChild(el('span', 'tag', o.condition));
    (o.formats || []).forEach((f) => meta.appendChild(el('span', 'tag', f)));
    if (o.seller) meta.appendChild(el('span', 'tag', o.seller));
    meta.appendChild(el('span', 'tag frete', '+ frete a calcular'));
    if (o.reason) meta.appendChild(el('span', 'tag', o.reason));
    const a = el('a', 'go', 'ver anuncio');
    a.href = o.url; a.rel = 'noopener nofollow'; a.target = '_blank';
    meta.appendChild(a);
    card.appendChild(meta);
    return card;
  }

  function fillGroup(sel, items) {
    const group = $(sel);
    const box = group.querySelector('.cards');
    box.replaceChildren(...items.map(offerCard));
    group.hidden = items.length === 0;
  }

  function render(data) {
    statusArea.hidden = false;
    results.hidden = false;

    const canonical = $('#canonical');
    canonical.replaceChildren();
    canonical.appendChild(document.createTextNode('Busca: '));
    canonical.appendChild(el('strong', null, data.query));
    if (data.canonical && data.canonical.title) {
      canonical.appendChild(document.createTextNode(
        ` · identificado como "${data.canonical.title}"` +
        (data.canonical.author ? ` de ${data.canonical.author}` : '') + ' (OpenLibrary)'));
    }

    const chips = $('#store-chips');
    chips.replaceChildren(...data.stores.map((s) => {
      const cls = s.status === 'ok' ? 's-ok'
        : s.status === 'pending' ? 's-wait' : 's-bad';
      const labels = extReady ? STATUS_LABEL : STATUS_LABEL_NO_EXT;
      const label = s.status === 'ok'
        ? `${STORE_LABEL[s.store]}: ${s.count} anuncio${s.count === 1 ? '' : 's'}`
        : `${STORE_LABEL[s.store]}: ${labels[s.status] || s.status}`;
      return el('span', `store-chip ${cls}`, label);
    }));

    fillGroup('#group-novo', data.confirmadas.novo);
    fillGroup('#group-usado', data.confirmadas.usado);
    fillGroup('#group-sem', data.confirmadas.sem_condicao);
    fillGroup('#group-prov', data.provaveis);

    const reasons = Object.entries(data.filtradas || {});
    const total = reasons.reduce((n, [, v]) => n + v.count, 0);
    $('#filtered-n').textContent = String(total);
    const list = $('#filtered-list');
    list.replaceChildren(...reasons.map(([reason, v]) => {
      const box = el('div');
      box.appendChild(el('div', 'f-reason', `${reason} (${v.count})`));
      v.itens.forEach((it) => {
        const line = el('div', 'f-item');
        const a = el('a', null, it.title);
        a.href = it.url; a.rel = 'noopener nofollow'; a.target = '_blank';
        line.appendChild(a);
        if (it.price_cents) line.appendChild(document.createTextNode(` · ${brl(it.price_cents)}`));
        line.appendChild(document.createTextNode(` · ${STORE_LABEL[it.store] || it.store}`));
        box.appendChild(line);
      });
      return box;
    }));
    $('#filtered').hidden = total === 0;

    const anyOffer = data.confirmadas.novo.length + data.confirmadas.usado.length +
      data.confirmadas.sem_condicao.length + data.provaveis.length;
    if (data.done && !anyOffer) {
      const allDead = data.stores.every((s) => s.status !== 'ok');
      showMsg(allDead
        ? 'Nenhuma loja respondeu com dados. Se o Farolivro esta instalado, as amostras de falha ja foram enviadas para calibrar os parsers.'
        : 'As lojas responderam mas nenhum anuncio passou no matching. Veja os filtrados abaixo.');
    }
  }
})();
