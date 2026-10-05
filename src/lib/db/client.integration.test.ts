import { describe, expect, it } from "vitest";
import { getPool } from "./client";

/**
 * The limits the application pool asks PostgreSQL to enforce.
 *
 * Asked of the server rather than read off the pool's options, because the
 * options are only a request: they travel as startup parameters, and what
 * matters is whether a connection the pool hands out actually carries them.
 */
describe("the application pool", () => {
  it("cancels a statement that runs for more than thirty seconds", async () => {
    const { rows } = await getPool().query<{ statement_timeout: string }>(
      "SHOW statement_timeout",
    );

    expect(rows[0]?.statement_timeout).toBe("30s");
  });

  it("ends a transaction left idle for more than a minute", async () => {
    const { rows } = await getPool().query<{
      idle_in_transaction_session_timeout: string;
    }>("SHOW idle_in_transaction_session_timeout");

    expect(rows[0]?.idle_in_transaction_session_timeout).toBe("1min");
  });

  it("holds every connection to it, not only the first", async () => {
    // Two clients checked out at once are two connections, each of which had
    // to be opened with the parameters.
    const pool = getPool();
    const [first, second] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const answers = await Promise.all(
        [first, second].map((client) =>
          client.query<{ statement_timeout: string }>("SHOW statement_timeout"),
        ),
      );
      expect(answers.map(({ rows }) => rows[0]?.statement_timeout)).toEqual([
        "30s",
        "30s",
      ]);
    } finally {
      first.release();
      second.release();
    }
  });
});
