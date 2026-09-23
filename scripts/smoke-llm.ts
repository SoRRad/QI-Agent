/**
 * One live call through the configured provider.
 *
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm smoke:llm
 *
 * Prints the provider, the model that answered, latency and token counts. It
 * NEVER prints a key or any fragment of one, and it does not touch the
 * database, so it can be run by IT against a new gateway before the
 * application is deployed.
 */
import "dotenv/config";
import { createLlm, driverFromEnv, LlmError, type LlmCallRecord } from "@/lib/llm";

async function main(): Promise<void> {
  const driver = driverFromEnv();
  // A holder rather than a `let`: the auditor assigns it inside a closure,
  // which TypeScript's narrowing cannot see.
  const seen: { record: LlmCallRecord | null } = { record: null };

  const llm = createLlm(
    { feature: "smoke" },
    {
      driver,
      audit: async (r) => {
        seen.record = r;
      },
    },
  );

  console.log(`provider  ${driver.name}`);
  console.log(`model     ${driver.model} (configured)`);

  const reply = await llm.complete({
    prompt: "Reply with the single word OK and nothing else.",
    maxTokens: 1_000,
  });

  const r = seen.record;
  console.log(`served by ${r?.model ?? "unknown"}`);
  console.log(`latency   ${r?.latencyMs ?? "?"} ms`);
  console.log(`tokens    ${r?.inputTokens ?? "?"} in / ${r?.outputTokens ?? "?"} out`);
  console.log(`reply     ${JSON.stringify(reply.trim().slice(0, 80))}`);

  if (driver.name === "mock") {
    console.log("\nThis was the mock provider. Set LLM_PROVIDER and its credentials to test a real one.");
  } else if (!/\bok\b/i.test(reply)) {
    console.log("\nThe provider answered, but not with OK. The connection works; check the model configuration.");
  } else {
    console.log("\nOK — the provider is reachable and answering.");
  }
}

main().catch((error: unknown) => {
  // LlmError messages are written to be safe to print: no keys, no headers.
  console.error(error instanceof LlmError ? `${error.name}: ${error.message}` : "Smoke test failed.");
  process.exit(1);
});
