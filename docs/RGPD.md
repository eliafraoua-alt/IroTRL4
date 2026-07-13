# Registre de Traitement des Données Personnelles (RGPD)
**Version :** 1.0.0
**Date d'entrée en vigueur :** 10 Juin 2026

Ce document constitue le registre des activités de traitement de la plateforme **IRO Strength Velocity**, conformément à l'Article 30 du Règlement Général sur la Protection des Données (RGPD).

---

## 1. Responsable du Traitement
- **Organisation :** IRO Strength AI
- **Contact DPO :** rgpd@irostrength.ai
- **Adresse :** Paris, France

---

## 2. Fiches de Traitement

### Fiche 1 : Évaluation IRO & Scoring de Personnes Morales (Startups)
* **Finalité :** Analyse de la maturité et de l'indice de survie opérationnelle d'une startup pour des besoins de calibration et de prise de décision d'investissement.
* **Catégories de Données Collectées :**
  - Données sur l'entreprise (nom, SIREN, capital social, effectif estimé, données financières passives ou publiques).
  - Profils des fondateurs issus de sources publiques professionnelles (nominatifs : rôle, éducation/école, années d'expérience industrielle, brevets déposés, rôles de conseils).
* **Base Légale (Article 6 - RGPD) :**
  - **Intérêt légitime (Art. 6.1.f) :** Évaluation des risques commerciaux et modélisation prédictive de survie d'entités professionnelles d'intérêt pour la recherche et l'investissement, n'impactant pas de manière disproportionnée les droits fondamentaux des personnes physiques (fondateurs agissant dans le cadre professionnel public).
* **Destinataires des Données :** Équipe interne de modélisation, analystes certifiés IRO, investisseurs partenaires dument authentifiés.
* **Durée de Conservation :** 36 mois maximum à compter de la date de finalisation de l'analyse IRO.

### Fiche 2 : Gestion des Comptes Analystes & Traces d'Audit
* **Finalité :** Gestion des connexions, contrôle d'accès sécurisé et traçabilité des actions réalisées (logs et historique de score pour auditabilité).
* **Catégories de Données Collectées :**
  - Nom, adresse e-mail de l'analyste.
  - Horodatage des analyses lancées, détails de requêtes et logs d'utilisation de l'API.
* **Base Légale (Article 6 - RGPD) :**
  - **Exécution d'un contrat (Art. 6.1.b) :** Permettre l'accès sécurisé aux fonctionnalités personnalisées de la plateforme.
  - **Obligation légale (Art. 6.1.c) :** Tenue des journaux de sécurité face aux cyber-menaces.
* **Durée de Conservation :**
  - Comptes utilisateurs : Durée de validité du compte + 3 ans à compter du dernier contact.
  - Journaux et traces de sécurité : 12 mois glissants conformes au RGPD.

---

## 3. Droits des Personnes Concernées
Dans le cadre réglementaire européen, toute personne physique dispose à tout moment de droits exercitables concernant ses données :
1. **Droit d'accès (Art. 15) :** Demande de consultation des données collectées ou des scores intermédiaires rattachés.
2. **Droit de rectification (Art. 16) :** Demande de rectification d'éléments biographiques obsolètes des fondateurs.
3. **Droit à l'effacement (Art. 17) :** Demande de suppression définitive du dossier de la plateforme.
4. **Droit de limitation (Art. 18) :** Gel temporaire du dossier d'analyse pendant la contestation d'un claim ou d'une note.
5. **Droit d'opposition (Art. 21) :** Droit de refus de figurer dans l'index IRO Strength en motivant une situation personnelle particulière.

Pour exercer l'un de ces droits, utilisez le canal dédié : `rgpd@irostrength.ai`.

---

## 4. Politique de Sécurité et d'Anonymisation des Données
- **Anonymisation stricte :** Le dataset public d'entrainement Gold Standard (représenté par les cas `gs-096` à `gs-125`) est totalement anonymisé. Aucune dénomination sociale réelle, SIREN ou nom de fondateur n'est divulgué publiquement.
- **Sécurité et isolation :** Toute donnée d'analyse privée est protégée par des mécanismes de cryptographie en transit (TLS) et au repos, encadrée par des règles strictes sur la base de données Firestore.
