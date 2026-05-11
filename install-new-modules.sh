#!/bin/bash
# ============================================================
# Script d'installation des nouveaux modules
# ErrorLog + UserReport + permissions
# Usage : bash install-new-modules.sh
# ============================================================

set -e

# Charger DATABASE_URL depuis .env (lecture directe, robuste aux caractères spéciaux)
if [ -f .env ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
  export DATABASE_URL
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERREUR : DATABASE_URL non défini dans .env"
  exit 1
fi

echo ""
echo "============================================================"
echo "  BrethrenApp - Installation nouveaux modules"
echo "============================================================"
echo ""

# ── Étape 1 : Migration error_logs ───────────────────────────
echo "▶ [1/3] Vérification table error_logs..."
node -e "
const { Client } = require('pg');
const fs = require('fs');
async function run() {
  const c = new Client({ connectionString: '$DATABASE_URL' });
  await c.connect();
  const r = await c.query(\"SELECT to_regclass('public.error_logs') as t\");
  if (r.rows[0].t) {
    console.log('   ✓ error_logs déjà existante - ignorée');
  } else {
    const sql = fs.readFileSync('./prisma/migrations/add_error_logs.sql', 'utf8');
    await c.query(sql);
    console.log('   ✓ error_logs créée avec succès');
  }
  await c.end();
}
run().catch(e => { console.error('   ✗ Erreur:', e.message); process.exit(1); });
"

# ── Étape 2 : Migration user_reports ─────────────────────────
echo "▶ [2/3] Vérification table user_reports..."
node -e "
const { Client } = require('pg');
const fs = require('fs');
async function run() {
  const c = new Client({ connectionString: '$DATABASE_URL' });
  await c.connect();
  const r = await c.query(\"SELECT to_regclass('public.user_reports') as t\");
  if (r.rows[0].t) {
    console.log('   ✓ user_reports déjà existante - ignorée');
  } else {
    const sql = fs.readFileSync('./prisma/migrations/add_user_reports.sql', 'utf8');
    await c.query(sql);
    console.log('   ✓ user_reports créée avec succès');
  }
  await c.end();
}
run().catch(e => { console.error('   ✗ Erreur:', e.message); process.exit(1); });
"

# ── Étape 3 : Seed permissions ────────────────────────────────
echo "▶ [3/3] Mise à jour des permissions..."
npx ts-node --project tsconfig.json prisma/seeds/index.ts

echo ""
echo "============================================================"
echo "  Installation terminée avec succès !"
echo ""
echo "  Modules actifs :"
echo "   * /api/v1/error-logs   -> journaux d'erreurs serveur"
echo "   * /api/v1/user-reports -> signalements utilisateurs"
echo ""
echo "  Frontend :"
echo "   * Bouton rouge visible sur toutes les pages"
echo "   * Page admin : /user-reports"
echo "   * Page admin : /error-logs"
echo "============================================================"
echo ""
