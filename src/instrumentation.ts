// Validates the env at server startup: a missing or invalid key stops the server
// with one readable error listing every problem.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkConfigOrExit } = await import("./lib/config");
    checkConfigOrExit();
  }
}
