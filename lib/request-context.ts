import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context, carried implicitly through async calls.
 *
 * The PHI guard runs inside the database client, several calls away from the
 * route handler that knows who the user is and which warnings they have
 * acknowledged. Threading that through every function signature would be the
 * kind of plumbing someone eventually forgets, so it travels here instead.
 */
export interface RequestContext {
  userId: string | null;
  /**
   * Fingerprints of warn-tier PHI flags the user has explicitly acknowledged
   * for this request. Block-tier flags cannot be acknowledged.
   */
  acknowledgedPhi: ReadonlySet<string>;
  /**
   * Set only for trusted, committed system content — the demo seed. Warn-tier
   * flags pass without acknowledgement. Block tier STILL applies, which is
   * what makes every seed run a proof that the seed contains no identifiers.
   */
  trustedContent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `context` in scope.
 *
 * The `async () => await fn()` wrapper is load-bearing, not stylistic. Prisma
 * query promises are LAZY: nothing executes until something calls `.then()`.
 * Without the inner await, `runWithContext(ctx, () => db.x.create(...))` would
 * return the unexecuted query, the context would exit, and the query would
 * then run OUTSIDE it — invisible to the PHI guard's acknowledgement check.
 * Awaiting inside the store makes the `.then()` happen in scope, whatever
 * shape of function the caller passes.
 */
export function runWithContext<T>(context: RequestContext, fn: () => PromiseLike<T>): Promise<T> {
  return storage.run(context, async () => await fn());
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requestContext(
  userId: string | null,
  acknowledged: Iterable<string> = [],
): RequestContext {
  return { userId, acknowledgedPhi: new Set(acknowledged) };
}
