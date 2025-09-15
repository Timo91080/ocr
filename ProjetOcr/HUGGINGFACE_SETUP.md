# 🤗 Configuration Hugging Face

## Comment obtenir votre clé API Hugging Face (GRATUITE) :

### 1. Créer un compte
1. Allez sur [huggingface.co](https://huggingface.co)
2. Cliquez sur "Sign Up" (inscription)
3. Créez votre compte avec email/mot de passe

### 2. Obtenir votre token d'accès
1. Une fois connecté, cliquez sur votre avatar en haut à droite
2. Allez dans **Settings** (Paramètres)
3. Dans le menu de gauche, cliquez sur **Access Tokens**
4. Cliquez sur **New token** (Nouveau token)
5. Donnez un nom à votre token (ex: "ocr-project")
6. Sélectionnez le type **Read** (suffisant pour notre usage)
7. Cliquez sur **Generate token**
8. **COPIEZ** votre token (il commence par `hf_...`)

### 3. Configurer le projet
1. Ouvrez le fichier `.env`
2. Remplacez `your_huggingface_token_here` par votre token :
   ```
   HUGGINGFACE_API_KEY=hf_votre_token_ici
   ```

### 4. Redémarrer le serveur
```bash
npm run dev
```

## Avantages de Hugging Face :
- ✅ **Gratuit** avec limites généreuses
- ✅ **Pas d'installation** locale requise
- ✅ **Modèles spécialisés** pour l'extraction de texte
- ✅ **API simple** et rapide

## Modèles utilisés :
- **microsoft/DialoGPT-medium** : Génération et analyse de texte
- **dbmdz/bert-large-cased-finetuned-conll03-english** : Extraction d'entités
- **Fallback regex** : En cas de problème API

## Limites gratuites :
- **1000 requêtes/jour** par modèle
- Largement suffisant pour votre projet !

---

## ⚡ Démarrage rapide

1. Obtenez votre token Hugging Face (gratuit)
2. Mettez-le dans `.env`
3. Lancez `npm run dev`
4. Testez sur http://localhost:3000

C'est tout ! 🎉