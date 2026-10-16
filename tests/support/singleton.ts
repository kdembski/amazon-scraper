// Drops the cached instance so the next getInstance() builds a fresh one
export const resetSingleton = (singleton: unknown) => {
  (singleton as { instance?: unknown }).instance = undefined;
};
