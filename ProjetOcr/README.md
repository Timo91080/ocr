

# 🧾 Extracteur OCR Bon de Commande

Pipeline intelligent pour extraire des données structurées de bons de commande (client, code privilège, articles, totaux) avec validation, correction heuristique et export.





## 🚀 Fonctionnalités Clés

- Multi‑variantes OCR (prétraitements: contraste, grayscale, threshold, inversion, dilation légère, sharpen) + vote de tokens critiques
- Normalisation et désambiguïsation caractères (O/0, I/1, S/5, B/8, etc.) contextuelle
- Extraction hybride: heuristiques + LLM Groq (prompt strict JSON) + validations post‑parse
- Préservation & validation stricte `code_privilege` (3–4 caractères, ex: 4GCZ) sans sur‑correction
- Enrichissement: calcul totaux ligne si manquants (`quantité * prix_unitaire`)
- Export Google Sheets (en option) + MySQL (en option) + export XLSX & TXT
- Rapport texte lisible humain avec anomalies (placeholder coloris, écarts totaux)
- Port dynamique (3000–3010) + endpoints de diagnostic et monitoring
- Robustesse: gestion erreurs OCR/LLM, fallback heuristique, métriques qualité (OCR vs LLM vs global)

---

## 🗂️ Structure
```
src/
├── index.js                  # Serveur Express + routes API
├── services/
│   ├── extractionService.js  # Orchestration pipeline principal
│   ├── ocrService.js         # Gestion OCR.space + variantes + vote
│   ├── advancedExtraction.js # Heuristiques pré/post LLM
│   ├── groqLLMService.js     # Prompt + appel Groq + parsing sécurisé
│   ├── googleSheetsService.js# Append & export feuille publique
│   ├── mysqlStorageService.js# Persistence optionnelle MySQL
│   ├── sqliteStorageService.js# (option locale alternative si activé)
│   ├── smartLLMService.js    # Sélection/fallback service LLM
│   └── externalOcrClient.js  # Client bas niveau OCR.space
├── utils/
│   ├── imageProcessor.js     # Génération variantes Sharp/Jimp
│   └── charDisambiguator.js  # Règles de correction contextuelle
```

---

## 🧪 Données Extraites (schéma simplifié)
```
client: {
  nom_complet, numero_client (≤9), code_privilege (3–4), telephone_portable
}
livraison: { livraison_domicile, point_relais_principal, autre_point_relais }
articles: [ { nom_produit, coloris, reference, taille_ou_code, quantite, prix_unitaire, total_ligne, devise } ]
totaux: { sous_total_articles, participation_frais_livraison, total_commande, total_avec_frais, devise }
quality: { ocrConfidence, llmConfidence, overallConfidence, method }
```

---

## ⚙️ Installation
```bash
git clone https://github.com/Timo91080/ocr.git
cd ProjetOcr
npm install

```

Node ≥ 18 recommandé (ESM + Sharp). Aucun service Python requis (mode hybride retiré).

--

## ▶️ Lancement
Développement (reload auto) :
```bash
npm run dev
```
Production simple :
```bash
npm start
```
Le serveur choisit un port libre (3000–3010) et écrit `server_port.txt`.

---

## 🌐 Endpoints Principaux

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | / | Ping + version |
| GET | /health | Statut rapide process |
| POST | /extract | Upload image (multipart field: image) & extraction complète |
| POST | /extract-batch | Jusqu'à 10 images |
| GET | /download-results | Dernier résultat format texte lisible |
| GET | /export-latest-xlsx | Dernier résultat XLSX (mode simple) |
| POST | /references | Injecter références connues (améliore validation) |
| GET | /references | Liste références connues |
| GET | /ai-status | État services LLM |
| GET | /sheet/status | Statut Google Sheets (si activé) |
| GET | /mysql/status | Statut MySQL (si activé) |
| GET | /mysql/export-xlsx | Export table MySQL |

Paramètres /extract utiles (query) :
```
preprocess=true|false
orientation=true|false
threshold=true|false
contextAnalysis=true|false
```

---

## 🧵 Flux Pipeline Résumé
1. Upload image → sauvegarde local `uploads/`
2. Génération variantes (sharp) + OCR.space parallèle (limitée) → textes bruts
3. Fusion/vote tokens (références, code_privilege)
4. Heuristiques pré-LLM (détection fragments, totaux, numéros)
5. Appel Groq (prompt JSON strict, garde-fous anti-hallucination)
6. Parsing + validation + corrections (charDisambiguator, longueurs, formats)
7. Fallback heuristique si JSON invalide
8. Calcul totaux ligne manquants
9. Application contraintes (trim, code_privilege 3–4, preservation 'C')
10. Export: Google Sheets 

---

## 🧪 Qualité & Validation
- Filtrage références (pattern 6–8 chiffres ou 3+3/4 agrégés)
- Code privilège: vote + heuristique (évite conversion abusive de 'C')
- Totaux recomposés si manquants
- Confiance globale = combinaison pondérée (OCR vs LLM + fiabilité structurée)

---

## 📤 Export & Intégrations
- Google Sheets: ligne ajoutée (format simple) + URL partage public possible
- MySQL: insertion par article (clé: num_client, référence...) si configuré


---

## 🛠 Dépannage Rapide
| Problème | Cause probable | Solution |
|----------|----------------|----------|
|
| Confiance basse | Image floue / faible contraste | Activer preprocessing (par défaut true) |
| 

Logs démarrage affichent longueur clé OCR/LLM pour diagnostic.

---



## 🧭 Améliorations Possibles (Roadmap)
- Consensus caractère par position (score pondéré variantes)
- Whitelist dynamique de `code_privilege` validés
- Stockage statistiques OCR par variante
- Tests unitaires supplémentaires (parsing erreurs JSON LLM)

---






Bon usage du pipeline ✨