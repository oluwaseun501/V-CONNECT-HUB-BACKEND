let cachedServices = null;
let cachedAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedServices() {
  if (!cachedServices || Date.now() - cachedAt >= CACHE_TTL_MS) {
    return null;
  }

  return cachedServices;
}

function setCachedServices(services) {
  cachedServices = services;
  cachedAt = Date.now();
}

function invalidateServicesCache() {
  cachedServices = null;
  cachedAt = 0;
}

module.exports = {
  getCachedServices,
  setCachedServices,
  invalidateServicesCache,
};