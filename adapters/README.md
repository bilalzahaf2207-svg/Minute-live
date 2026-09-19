Emplacement prévu pour un adaptateur de flux enseigne (partenariat/affiliation).

Interface attendue :
  module.exports = {
    nom: 'Enseigne',
    async catalogue({ lat, lon, magasinId }) {
      // -> [{ code, name, brand, size, qty, unit, nutri, image, price }]
    }
  };

buildCatalog() dans server.js fusionne ces résultats avec Open Prices ;
un prix officiel d'enseigne prime toujours sur un relevé communautaire.

Volontairement vide : le scraping des sites drive est contraire aux CGU
de la plupart des enseignes. Voir README.md à la racine.
