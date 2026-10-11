// Subpath import: the barrel also loads NodeRedis, which needs the ioredis peer.
import { layer as nodeServicesLayer } from "@effect/platform-node/NodeServices";
import { Cause, Exit, Layer, ManagedRuntime, type Effect } from "effect";
import { CommandRunner, CommandRunnerLive } from "./process.ts";

// Effect's beta platform types leave ChildProcessSpawner in the inferred
// environment even though the NodeServices layer provides it at runtime.
const AppLayer = CommandRunnerLive.pipe(
  Layer.provide(nodeServicesLayer),
) as Layer.Layer<CommandRunner>;

export function createRuntime() {
  return ManagedRuntime.make(AppLayer);
}

export type GitInfoRuntime = ReturnType<typeof createRuntime>;

export async function runEffect<A, E>(
  runtime: GitInfoRuntime,
  effect: Effect.Effect<A, E, CommandRunner>,
  options: { signal?: AbortSignal; interruptMessage?: string } = {},
) {
  const exit = await runtime.runPromiseExit(
    effect,
    options.signal ? { signal: options.signal } : undefined,
  );
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    throw new Error(options.interruptMessage ?? "Operation was aborted.");
  }
  const [first] = Cause.prettyErrors(exit.cause);
  throw new Error(first?.message ?? Cause.pretty(exit.cause));
}
