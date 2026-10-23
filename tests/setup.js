// Global test guardrail: block accidental real network requests in unit tests.
// Tests that exercise HTTP clients (e.g. GoogleDriveAdapter) must explicitly stub global.fetch.
globalThis.fetch = async (url) => {
  throw new Error(
    `[TestGuard] Unmocked network fetch("${url}") is forbidden in unit tests. Inject a mock or stub global.fetch.`
  );
};
