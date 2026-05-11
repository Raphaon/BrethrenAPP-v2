// Blacklist en mémoire pour les access tokens révoqués (logout).
// TTL = durée de vie du token access (15 min par défaut).
// Pour un déploiement multi-instances, remplacer par Redis.

const blacklist = new Map<string, number>(); // token → timestamp d'expiration

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Nettoyage automatique toutes les 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of blacklist.entries()) {
    if (now > expiry) blacklist.delete(token);
  }
}, ACCESS_TOKEN_TTL_MS);

export function blacklistAccessToken(token: string): void {
  blacklist.set(token, Date.now() + ACCESS_TOKEN_TTL_MS);
}

export function isAccessTokenBlacklisted(token: string): boolean {
  const expiry = blacklist.get(token);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    blacklist.delete(token);
    return false;
  }
  return true;
}
