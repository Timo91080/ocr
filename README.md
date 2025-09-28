@@ .. @@
 ## 🚀 Fonctionnalités Clés

 - Multi‑variantes OCR (prétraitements: contraste, grayscale, threshold, inversion, dilation légère, sharpen) + vote de tokens critiques
 - Normalisation et désambiguïsation caractères (O/0, I/1, S/5, B/8, etc.) contextuelle
 - Extraction hybride: heuristiques + LLM Groq (prompt strict JSON) + validations post‑parse
+- **🔧 Agent IA de correction automatique** : Compare avec API JSON de référence et corrige les erreurs
 - Préservation & validation stricte `code_privilege` (3–4 caractères, ex: 4GCZ) sans sur‑correction
 - Enrichissement: calcul totaux ligne si manquants (`quantité * prix_unitaire`)
 - Export Google Sheets (en option) + MySQL (en option) + export XLSX & TXT
@@ -1,6 +1,7 @@
 ## 🧵 Flux Pipeline Résumé
 1. Upload image → sauvegarde local `uploads/`
 2. Génération variantes (sharp) + OCR.space parallèle (limitée) → textes bruts
 3. Fusion/vote tokens (références, code_privilege)
 4. Heuristiques pré-LLM (détection fragments, totaux, numéros)
 5. Appel Groq (prompt JSON strict, garde-fous anti-hallucination)
 6. Parsing + validation + corrections (charDisambiguator, longueurs, formats)
-7. Fallback heuristique si JSON invalide
-8. Calcul totaux ligne manquants
-9. Application contraintes (trim, code_privilege 3–4, preservation 'C')
-10. Export: Google Sheets 
+7. **🔧 Correction automatique avec API de référence** (nouveau)
+8. Fallback heuristique si JSON invalide
+9. Calcul totaux ligne manquants
+10. Application contraintes (trim, code_privilege 3–4, preservation 'C')
+11. Export: Google Sheets 

 ---

+## 🔧 Agent IA de Correction (Nouveau)
+
+Le système intègre maintenant un agent intelligent qui :
+
+### Fonctionnement
+1. **Chargement des références** : Lit le fichier `data/bons-mock.json` contenant tous les produits de référence
+2. **Comparaison automatique** : Compare chaque article extrait avec la base de données
+3. **Correction intelligente** : 
+   - Référence exacte → Correction complète (modèle, coloris, taille, prix)
+   - Correspondance approximative → Suggestions basées sur la similarité
+4. **Recalcul automatique** : Met à jour les totaux après corrections
+
+### Configuration
+```env
+ENABLE_REFERENCE_CORRECTION=1
+LOCAL_JSON_PATH=./data/bons-mock.json
+```
+
+### API Endpoints
+- `GET /reference-api/status` : Statut et statistiques
+- `POST /reference-api/reload` : Recharger les références
+
+### Exemple de Correction
+```
+Avant correction (OCR) :
+- Référence: 3169032
+- Modèle: "ébénist" (OCR imprécis)
+- Prix: 45.00 (incorrect)
+
+Après correction (API) :
+- Référence: 3169032 ✓
+- Modèle: "Ébéniste" ✓ (corrigé)
+- Prix: 47.99 ✓ (corrigé)
+```
+
 ## 🧪 Qualité & Validation
 - Filtrage références (pattern 6–8 chiffres ou 3+3/4 agrégés)
 - Code privilège: vote + heuristique (évite conversion abusive de 'C')
+- **Correction automatique** : Vérification avec base de données de référence
 - Totaux recomposés si manquants
 - Confiance globale = combinaison pondérée (OCR vs LLM + fiabilité structurée)