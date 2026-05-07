# ⚡ MontageAI

Outil web qui génère des pubs vidéo verticales (TikTok / Reels / Shorts) en 1 clic. **100 % navigateur, 100 % gratuit, aucun backend.**

L'utilisateur fournit ses propres clés API (Pexels, Pixabay, ElevenLabs — toutes free tier). Tout le rendu se fait localement via **ffmpeg.wasm**.

## ✨ Comment ça marche

1. Tu colles tes 3 clés API dans l'onglet **Clés API** (stockées en localStorage uniquement)
2. Tu remplis le wizard 6 étapes (projet → modèle → script → visuels → audio → générer)
3. Le navigateur appelle Pexels/Pixabay/ElevenLabs pour récupérer stock + voix + musique
4. ffmpeg.wasm compose la vidéo localement (~30s-2min selon ton CPU)
5. Tu télécharges le MP4

Aucune donnée ne quitte ton navigateur. Pas de tracking. Pas de coût d'hébergement.

## 🚀 Déploiement Vercel (1 minute)

```bash
# 1. Clone ce repo
git clone <your-fork-url> montage-ai
cd montage-ai/build

# 2. Push sur GitHub
git remote set-url origin git@github.com:USER/REPO.git
git push -u origin main

# 3. Sur vercel.com → "New Project" → import le repo → Deploy
```

Vercel détectera automatiquement `vercel.json` et appliquera les headers COOP/COEP nécessaires à ffmpeg.wasm.

**Important** : la racine du projet Vercel doit être `build/` (le dossier qui contient `index.html`).

### Alternative : GitHub Pages

GitHub Pages ne supporte pas les headers COOP/COEP custom → ffmpeg.wasm tournera en mode mono-thread (plus lent mais fonctionnel).

```bash
# Settings → Pages → Source: main /build
```

### Alternative : Cloudflare Pages

Idem Vercel — créer `_headers` à la racine :

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

## 🧑‍💻 Développement local

```bash
cd build/
python3 server.py
# → http://localhost:5173
```

Le serveur Python custom envoie les bons headers COOP/COEP. Un simple `python3 -m http.server` ne marchera **pas** pour le mode multi-thread.

## 🔑 Obtenir les clés API (toutes gratuites)

| Provider | URL | Free tier |
|---|---|---|
| **Pexels** | https://www.pexels.com/api/ | Illimité (rate-limit raisonnable) |
| **Pixabay** | https://pixabay.com/api/docs/ | 100 req/min |
| **ElevenLabs** | https://elevenlabs.io/app/settings/api-keys | 10 000 chars/mois |

⚠️ **Pour ElevenLabs** : à la création de la clé, **coche bien la permission "Text to Speech"** sinon tu auras une 401.

## 📐 Limites techniques

- **Durée max** : ~30s recommandé (au-delà ffmpeg.wasm risque OOM en navigateur)
- **Mémoire** : 2 Go max par tab Chrome → suffit pour 9:16 / 25s
- **Vitesse** : 30s vidéo = ~30-90s rendering selon CPU
- **Mobile** : ça marche mais c'est lent (1-2 min pour 25s)
- **Safari** : limite SharedArrayBuffer plus stricte → mode mono-thread auto

## 🏗 Architecture

```
build/
├── index.html         # UI 3 onglets (clés / créer / about)
├── css/style.css      # dark theme
├── js/
│   ├── app.js         # main controller
│   ├── api.js         # Pexels/Pixabay/ElevenLabs clients (browser fetch)
│   ├── composer.js    # ffmpeg.wasm wrapper + canvas overlays
│   └── templates.js   # presets viral / POV / ASMR / custom
├── server.py          # dev server with COOP/COEP
├── vercel.json        # COOP/COEP headers for prod
└── package.json
```

## 🆚 Limites vs version "agent" (le projet parent OpenMontage)

Cette webapp est une version simplifiée de [OpenMontage](https://github.com/anthropics/openmontage). Elle ne remplace pas un vrai agent vidéo — elle exécute juste le pipeline de base. Diffs :

| Feature | OpenMontage (agent) | MontageAI (webapp) |
|---|---|---|
| Génération script créatif | ✅ via LLM | ❌ user-écrit ou template |
| Choix scène intelligent | ✅ analyse contexte | ❌ ordre des inputs |
| Pipelines spécialisés | ✅ 12 pipelines | ❌ 4 templates |
| Génération image IA | ✅ FLUX/DALL-E | ❌ stock seulement |
| Composition runtime | Remotion / HyperFrames / FFmpeg | ffmpeg.wasm |
| Coût | dépend providers | toujours 0 € |

Si tu veux la puissance complète, utilise OpenMontage. Si tu veux juste créer une pub vite et gratuit, utilise cette webapp.

## 📝 Licence

MIT.
