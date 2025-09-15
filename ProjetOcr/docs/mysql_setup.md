# Déploiement MySQL + phpMyAdmin (Accès multi-utilisateurs)

## 1. Objectif
Centraliser les lignes extraites (une ligne = un article) dans MySQL pour que toute l'équipe puisse consulter via phpMyAdmin (ou un outil BI) sans partager de fichiers locaux.

## 2. Choix d'hébergement
Options :
- VPS (Ubuntu/Debian) avec installation manuelle de `mysql-server` + `phpmyadmin`.
- Hébergeur mutualisé offrant déjà un MySQL + interface phpMyAdmin.
- Docker (compose) exposant MySQL et phpMyAdmin.

### Exemple Docker Compose
```yaml
version: '3.8'
services:
  db:
    image: mysql:8.3
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: change_me_root
      MYSQL_DATABASE: Ocrproject
      MYSQL_USER: ocruser
      MYSQL_PASSWORD: change_me_user
    ports:
      - "3306:3306"
    command: ["--character-set-server=utf8mb4","--collation-server=utf8mb4_unicode_ci"]
    volumes:
      - mysql_data:/var/lib/mysql

  phpmyadmin:
    image: phpmyadmin:latest
    restart: unless-stopped
    environment:
      PMA_HOST: db
      UPLOAD_LIMIT: 64M
    ports:
      - "8080:80"
    depends_on:
      - db

volumes:
  mysql_data:
```
Accès phpMyAdmin : http://VOTRE_IP:8080/

## 3. Création utilisateur sécurisé
Si installation manuelle :
```sql
CREATE DATABASE Ocrproject CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ocruser'@'%' IDENTIFIED BY 'change_me_user';
GRANT ALL PRIVILEGES ON Ocrproject.* TO 'ocruser'@'%';
FLUSH PRIVILEGES;
```
Activer écoute réseau : dans `/etc/mysql/mysql.conf.d/mysqld.cnf` commenter `bind-address` ou mettre `0.0.0.0`, puis :
```bash
sudo systemctl restart mysql
```
Ajouter firewall :
```bash
sudo ufw allow 3306/tcp
```
(Option : restreindre plus tard aux IP de confiance.)

## 4. Variables `.env`
```
MYSQL_HOST=IP_OU_DNS
MYSQL_PORT=3306
MYSQL_USER=ocruser
MYSQL_PASSWORD=change_me_user
MYSQL_DATABASE=Ocrproject
```

## 5. Table utilisée
La table `sheet_rows` est créée automatiquement au premier insert :
```
 id (PK), created_at, num_client, nom_client, nom_modele, coloris,
 reference, taille_ou_code, quantite, prix_unitaire, total, devise,
 source_filename, ocr_conf, llm_conf, overall_conf
```

## 6. Vérification API
- Démarrer le serveur Node.
- Faire un POST /extract avec une image.
- Consulter /mysql/status → { enabled: true, rows: X }
- Vérifier dans phpMyAdmin : SELECT * FROM sheet_rows ORDER BY id DESC;

## 7. Sécurité minimale
- Changer les mots de passe par défaut immédiatement.
- Restreindre les IP (firewall) si possible.
- Pas de compte root exposé publiquement.
- Sauvegardes : dump quotidien via `mysqldump`.

## 8. Sauvegarde / Restauration
```bash
mysqldump -h HOST -u ocruser -p Ocrproject > backup.sql
mysql -h HOST -u ocruser -p Ocrproject < backup.sql
```

## 9. Migration depuis ancien SQLite
Si vous aviez un fichier `data/ocr_data.db` :
```
npm i better-sqlite3
node scripts/migrate_sqlite_to_mysql.js data/ocr_data.db
```

## 10. Prochaines améliorations
- Index sur (num_client, reference).
- Ajout d'une table `clients` et `commandes` pour normaliser.
- Endpoint filtre: /mysql/search?num_client=xxx&ref=YYYY.

---
Contact: Ajouter un README pour l'équipe avec URL phpMyAdmin + identifiants.
