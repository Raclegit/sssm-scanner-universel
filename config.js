nhoouni,lçkkok// ═══ CONFIGURATION — MODIFIER CES VALEURS ════════════════════════
// 1. AIRTABLE_API_KEY / BASE_ID : déjà renseignés pour votre base.
// 2. TABLE_SSSM : agents SSSM (AG/CL/MC) — une ligne par scan.
//    Champs à créer : Code_Badge, Categorie, Role, Type_Mouvement,
//                      Site_Poste, Date_Heure
// 3. TABLE_PERSONNEL : personnel DAF/DAS/DVM — une ligne par
//    employé et par jour (upsert automatique Entrée/Sortie).
//    Champs à créer : Date, Matricule, Nom, Service, Poste,
//                      Heure_Entree, Heure_Sortie, Site_Poste,
//                      Saisie_QR (case à cocher)
// 4. TABLE_STOCK : marchandises/médicaments — voir schéma détaillé
//    donné précédemment (Code_Produit, Lot, Date_Expiration, etc.)
// ════════════════════════════════════════════════════════════════
const CONFIG = {
  AIRTABLE_API_KEY : "patQ1gk55HesrlVdd.191d124ae41cb7bf928e0b0f5629b2f533a14a8742f554e5874b329dd7d94b41",
  AIRTABLE_BASE_ID : "app6zYqv0ltTz66",
  TABLE_SSSM       : "SSSM_MOUVEMENTS",
  TABLE_PERSONNEL  : "POINTAGES_PERSONNEL",
  TABLE_STOCK      : "SSSM_STOCK_MOUVEMENTS",
  SITE_OPTIONS     : ["SIÈGE", "Entrepôt", "Périmètre", "Parking", "Autre"],
  ETAPE_OPTIONS    : ["Réception", "Préparation Rayon", "Expédition / Livraison"],
  HEURE_ENTREE     : "07:30",
  TOLERANCE_MIN    : 15,
};

// --- Configuration ASP ---
const ASP_TABLE = "ASP_SORTIES";
const ASP_QR_PREFIX = "ASP-SSSM|";

// PIN simple pour protéger l'accès RH (à changer selon votre préférence)
const RH_PIN = "916574";

// Statuts possibles (doivent correspondre EXACTEMENT aux options Single select créées)
const ASP_STATUT = {
  AUTORISE: "Autorisé",
  SORTI: "Sorti",
  RENTRE: "Rentré",
  EXPIRE: "Expiré",
  ANNULE: "Annulé"
};
// --- Configuration CPS (Congé Personnel SALAMA) ---
const CPS_CONGES_TABLE = "CPS_CONGES";
const CPS_SOLDES_TABLE = "CPS_SOLDES";
const CPS_QR_PREFIX = "CPS-SSSM|";

const CPS_STATUT = {
  AUTORISE: "Autorisé",
  EN_CONGE: "En congé",
  TERMINE: "Terminé",
  ANNULE: "Annulé"
};
