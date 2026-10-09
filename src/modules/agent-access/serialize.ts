import type { TokenScope } from "@/modules/api-tokens/scope";
import type { AgentConnection } from "./grants";

/**
 * A connection as it crosses into the browser.
 *
 * Its own file for the reason `api-tokens/serialize.ts` gives: a `"use server"`
 * module may export only async functions, and a synchronous helper beside the
 * actions typechecks, tests green and fails in `next build`.
 */
export interface SerializedConnection {
  readonly id: string;
  readonly clientName: string;
  readonly scope: TokenScope;
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export function serializeConnection(
  connection: AgentConnection,
): SerializedConnection {
  return {
    ...connection,
    createdAt: connection.createdAt.toISOString(),
    lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
  };
}
