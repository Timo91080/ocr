# Intégration Google Sheets

Cette fonctionnalité est **optionnelle**. Si un utilisateur tiers clone votre projet, il peut :
- Ne pas activer l'envoi vers Google Sheets (par défaut désactivé)
- Fournir ses propres identifiants (compte de service + Sheet) et activer l'intégration

## 1. Activer ou désactiver
Dans `.env` :
```
ENABLE_GOOGLE_SHEETS=1   # activer
ENABLE_GOOGLE_SHEETS=0   # désactiver (par défaut)
```

## 2. Créer une feuille Google Sheets
1. Aller sur https://sheets.google.com et créer une feuille vide.
2. Copier l'ID du document (dans l'URL entre `/d/` et `/edit`). Exemple :
   - URL : `https://docs.google.com/spreadsheets/d/1AbCdEFghiJKLmnopQRstUVwxYZ1234567890/edit#gid=0`
   - ID  : `1AbCdEFghiJKLmnopQRstUVwxYZ1234567890`

## 3. Créer un compte de service
1. Console Google Cloud : https://console.cloud.google.com/
2. Créer (ou choisir) un projet.
3. Activer l'API Google Sheets (API & Services > Library > Google Sheets API > Enable).
4. IAM & Admin > Service Accounts > Create service account.
5. Donner un nom (ex: `ocr-extraction-bot`).
6. Rôles minimaux : `Editor` (ou plus restrictif + access sur la feuille uniquement via partage).
7. Créer une clé JSON et télécharger le fichier.

## 4. Ajouter les variables d'environnement
Dans `.env` :
```
ENABLE_GOOGLE_SHEETS=1
GOOGLE_SHEET_ID=ID_DE_LA_FEUILLE
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxxx@project-id.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n...\n-----END PRIVATE KEY-----\n"
```
- Important : Les retours à la ligne de la clé privée doivent être échappés `\n` si tu mets sur une seule ligne.
- Si tu colles tel quel depuis le JSON original, convertir chaque vraie nouvelle ligne en \n.

## 5. Partager la feuille
Dans Google Sheets > Partager > Ajouter l'email du compte de service avec le rôle Éditeur.
Sans ce partage, l'écriture échouera (`PERMISSION_DENIED`).

## 6. Structure de la ligne écrite
Ordre actuel :
1. Timestamp (ISO)
2. Nom complet
3. Numéro client
4. Code privilège
5. Téléphone portable
6. Livraison domicile
7. Point relais principal
8. Autre point relais
9. Nombre d'articles
10. Nom produit (1er)
11. Référence (1er)
12. Taille / Code (1er)
13. Prix unitaire (1er)
14. Sous-total articles
15. Participation frais livraison
16. Total commande
17. Total avec frais
18. Devise

## 7. Désactivation propre
Mettre `ENABLE_GOOGLE_SHEETS=0` et redémarrer. Le code ne tente plus d'écrire (log neutre).

## 8. Dépannage
| Problème | Cause probable | Solution |
|----------|----------------|----------|
| `invalid_grant` | Mauvais format clé privée (\n manquants) | Re-formater clé avec \n |
| `PERMISSION_DENIED` | Feuille non partagée avec le compte de service | Partager la feuille |
| Aucun log d'envoi | ENABLE_GOOGLE_SHEETS=0 ou variables manquantes | Vérifier .env |
| Append silencieusement ignoré | DEBUG désactivé | Mettre OCR_DEBUG=1 |

## 9. Personnalisation
- Modifier `buildRow()` dans `googleSheetsService.js` pour changer les colonnes.
- Dupliquer chaque article : faire une boucle sur `extraction.articles` et envoyer plusieurs lignes (ajout futur possible).

## 10. Sécurité
Ne jamais committer votre clé privée dans le dépôt public. Fournir un `.env` séparé.

---
Pour étendre (multi-articles, entêtes automatiques), ouvrez une issue interne ou demandez l'assistant.
