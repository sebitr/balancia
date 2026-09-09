import type { ApiTokenRecord } from "./service";
import type { TokenScope } from "./scope";

/**
 * A key as it crosses into the browser.
 *
 * Its own file rather than sitting beside the actions that hand it over,
 * because a `"use server"` module may export *only* async functions — every
 * export becomes a callable endpoint, so a synchronous helper in there is a
 * build error rather than a style problem. It is the kind of thing that
 * typechecks, tests green and fails in `next build`, which is why it is
 * written down here.
 *
 * Instants become strings on the way. Dates survive the Server Action
 * boundary, but this shape is also read straight off a Server Component into
 * a client card, and one type that is a `Date` on one path and a string on the
 * other is a component that renders differently depending on where its props
 * came from.
 */
export interface SerializedApiToken {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scope: TokenScope;
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/** The secret, handed over once, plus the row the list shows from now on. */
export interface MintedApiToken {
  readonly token: string;
  readonly record: SerializedApiToken;
}

export function serializeApiToken(record: ApiTokenRecord): SerializedApiToken {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
  };
}
