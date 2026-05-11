# Production Docker

Ce dossier contient la configuration Docker de production pour le backend API.

## Ce qui part dans l'image API

- `src/`
- `prisma/`
- `public/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`

Le frontend, le mobile, les tests, les caches, les docs, les builds locaux et les fichiers temporaires sont exclus par `.dockerignore`.

## Premiere installation

Depuis la racine du projet :

```bash
cp production/.env.example production/.env
```

Remplir `production/.env`, surtout :

- `POSTGRES_PASSWORD`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGIN`
- `SMTP_*`

Generer les secrets JWT :

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Demarrer

```bash
cd production
docker compose build
docker compose up -d
```

Le service `migrate` applique automatiquement :

```bash
npx prisma migrate deploy
```

## Verifier

```bash
cd production
docker compose ps
docker compose logs -f api
curl http://localhost:3000/health
```

## Seed initial

Uniquement si la base est vide :

```bash
cd production
docker compose run --rm api node dist/prisma/seeds/index.js
```

Changer immediatement les mots de passe des comptes crees par le seed.

## Reverse proxy HTTPS

En prod, exposer l'API via Nginx ou Caddy :

```text
https://api.tondomaine.com -> http://127.0.0.1:3000
```

Garder `CORS_ORIGIN` limite a l'URL du frontend admin.

## Si votre serveur utilise l'ancien Compose

Si `docker compose` ne marche pas, utiliser la commande avec tiret :

```bash
cd production
docker-compose build
docker-compose up -d
```
