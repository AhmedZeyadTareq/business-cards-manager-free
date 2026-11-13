// Unit tests never use real services: fixed fake env, mocked fetch, no database.
Object.assign(process.env, {
  AUTH_SECRET: "unit-test-secret-unit-test-secret-1234",
  OPENROUTER_API_KEY: "test-key",
  MONGODB_URI: "mongodb://127.0.0.1:1/unit",
  MONGODB_DB: "cards_test",
});
for (const key of Object.keys(process.env)) {
  if (key.startsWith("AI_") || key === "OPENROUTER_BASE_URL" || key === "APP_TIME_ZONE") {
    delete process.env[key];
  }
}
