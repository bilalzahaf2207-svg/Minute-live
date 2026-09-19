/* ==========================================================
   MINUTE — couche de données en direct
   Remplace le catalogue de démonstration par les vraies
   données servies par server.js (OSM + Open Prices + OFF).
   Chargé APRÈS l'application : il réécrit FAMILIES / STORES
   puis relance le rendu.
   ========================================================== */
(function () {
  'use strict';

  /* L'URL de l'API : ?api=… dans l'URL, sinon mémorisée, sinon
     le serveur qui sert cette page (cas normal en auto-hébergé). */
  function apiBase() {
    const u = new URLSearchParams(location.search).get('api');
    if (u) { try { localStorage.setItem('minute.api', u); } catch (e) {} return u.replace(/\/$/, ''); }
    try { const v = localStorage.getItem('minute.api'); if (v) return v.replace(/\/$/, ''); } catch (e) {}
    return location.origin;   // servi par server.js
  }

  const EM = { essentiels: '🛒', frais: '🧀', bebe: '🍼', fruits: '🥕', epicerie: '🥫',
               boissons: '🧃', hygiene: '🧻', surgele: '🧊', snack: '🥨' };

  /* Couleur stable déduite du nom d'enseigne — pas de logo distant,
     la politique de sécurité de la page bloquerait l'image. */
  function couleur(nom) {
    let h = 0; for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) | 0;
    const palette = ['#0050aa', '#e2231a', '#00843d', '#1e63d0', '#f07d00', '#7c4dff',
                     '#0a2d6e', '#d40511', '#3d8b37', '#00539f'];
    return palette[Math.abs(h) % palette.length];
  }

  /* « 08:00-20:00 » → heures d'ouverture exploitables. Les horaires OSM
     ont mille formes ; on lit le cas courant et on reste prudent sinon. */
  function horaires(oh) {
    if (!oh) return { open: 8, close: 21, sur: false };
    if (/24\/7/.test(oh)) return { open: 0, close: 24, sur: true };
    const m = oh.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) return { open: 8, close: 21, sur: false };
    return { open: +m[1] + (+m[2]) / 60, close: +m[3] + (+m[4]) / 60, sur: true };
  }

  function toStore(s) {
    const h = horaires(s.opening_hours);
    const km = s.dist / 1000;
    return {
      id: s.id, name: s.name, color: couleur(s.name),
      px: 1,                                  // aucune estimation : les prix sont relevés
      dist: km, prep: Math.round(6 + km * 2),
      fee: Math.round((1.5 + km * 0.6) * 10) / 10,
      min: 10, rate: 4.3,
      open: h.open, close: h.close,
      tag: h.sur && h.close >= 24 ? 'Ouvert 24h/24' : (s.shop === 'convenience' ? 'Supérette' : null),
      noPP: false, noBio: false,
      _osm: true, _horaires: s.opening_hours || null,
      _adresse: [s.street, s.city].filter(Boolean).join(', ') || null
    };
  }

  function toFamily(f) {
    const em = EM[f.cat] || '🛒';
    return {
      id: f.key, cat: f.cat, em: em, name: f.name, unit: f.unit,
      vars: f.variants.map(v => ({
        id: v.code,
        label: v.brand || 'Sans marque indiquée',
        tier: 0,                              // pas de gamme déclarée : on classe au prix au kilo
        size: v.size || '—',
        qty: v.qty || 1, unit: v.unit || f.unit,
        price: minPrix(v),                    // sert de repli si un magasin n'a pas de relevé
        nutri: v.nutri || '',
        rate: 4.3,                            // pas de note client dans les sources ouvertes
        fam: f.key, cat: f.cat, em: em, famName: f.name,
        image: v.image || null,
        prices: v.prices || {},               // { idMagasin: {value, date} } — le cœur du direct
        _reel: true
      }))
    };
  }
  function minPrix(v) {
    const p = Object.values(v.prices || {}).map(x => x.value);
    return p.length ? Math.min.apply(null, p) : 0;
  }

  function banniere(txt, ton) {
    let el = document.getElementById('liveBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'liveBanner';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:70;padding:8px 14px;' +
        'font-size:.8rem;font-weight:700;text-align:center;color:#fff';
      document.body.appendChild(el);
    }
    el.style.background = ton === 'err' ? '#d93025' : ton === 'ok' ? '#0b7c45' : '#1e63d0';
    el.textContent = txt;
    if (ton === 'ok') setTimeout(() => el.remove(), 5000);
  }

  function position() {
    return new Promise((ok, ko) => {
      if (!navigator.geolocation) return ko(new Error('géolocalisation indisponible'));
      navigator.geolocation.getCurrentPosition(
        p => ok({ lat: p.coords.latitude, lon: p.coords.longitude }),
        e => ko(new Error('position refusée')),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
    });
  }

  async function charger() {
    const base = apiBase();
    try {
      banniere('Recherche des magasins autour de vous…');
      const pos = await position();
      banniere('Récupération des prix relevés en magasin…');

      const r = await fetch(base + '/api/catalog?lat=' + pos.lat + '&lon=' + pos.lon + '&radius=2500&stores=12');
      if (!r.ok) throw new Error('API ' + r.status);
      const data = await r.json();

      if (!data.stores || !data.stores.length) throw new Error('aucun magasin trouvé ici');
      if (!data.families || !data.families.length) {
        banniere('Magasins réels chargés, mais aucun prix relevé dans ce secteur — catalogue de démonstration conservé.', 'err');
        STORES = data.stores.map(toStore); indexData(); render();
        return;
      }

      STORES = data.stores.map(toStore);
      FAMILIES = data.families.map(toFamily);
      LIVE = { at: data.generatedAt, counts: data.counts, sources: data.sources, pos: pos };
      indexData();
      state.storeId = null; state.view = 'home'; state.cart = { storeId: null, items: {} };
      render();
      banniere('En direct : ' + data.counts.stores + ' magasins, ' +
               data.counts.familles + ' familles de produits, prix relevés en magasin.', 'ok');
      console.info('[Minute] données réelles', data.counts, data.sources);
    } catch (e) {
      banniere('Mode démonstration — ' + e.message + '. Données réelles indisponibles ici.', 'err');
      console.warn('[Minute] repli démonstration :', e);
    }
  }

  /* On ne déclenche rien tant que la page n'est pas prête, et on laisse
     l'application s'afficher immédiatement avec le catalogue de démo. */
  if (document.readyState === 'complete') setTimeout(charger, 300);
  else window.addEventListener('load', () => setTimeout(charger, 300));

  window.MinuteLive = { charger: charger, apiBase: apiBase };
})();
