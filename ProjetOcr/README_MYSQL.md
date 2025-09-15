# Guide Base de Données (MySQL / MariaDB + phpMyAdmin)

Ce document explique comment configurer et utiliser la base de données pour stocker les lignes d'articles extraites par le système.

## 1. 

Importer simplement la base fournie :

1. Ouvrir phpMyAdmin
2. Créer la base `ocrproject` (si pas déjà là)
3. Onglet "Importer" → sélectionner le fichier `sheet_rows.sql` qui se trouve dans le dossier ProjetOcr → Exécuter
4. Vérifier que la table `sheet_rows` est créée


```


Démarrer ensuite l'appli (`npm run dev`). Les extractions insèrent automatiquement les lignes (si les variables sont présentes).

