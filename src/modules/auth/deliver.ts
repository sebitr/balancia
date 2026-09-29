import "server-only";
import { after } from "next/server";
import { logger } from "@/lib/logger";

/**
 * When the half of a mail request that only a real account has gets done.
 *
 * "Email me a reset link" and "email me a code" answer the same whether or
 * not the address has an account — they have to, or they would list a
 * deployment's users to anybody who asked. The words were always identical;
 * the time was not. An unknown address was answered straight after its
 * lookup, a known one only once a token had been written and an SMTP server
 * had answered, and a round trip to a mail server is not a difference anybody
 * needs a stopwatch to see.
 *
 * So those requests take one of these. Everything that happens only for an
 * account — the token, the mail — goes through it, and what is left in front
 * of the answer is the same few steps for every address typed. Left out, the
 * work is done inline and awaited, which is what a test that wants to read
 * the mail on its next line needs.
 *
 * Imported by the services as a type only, so the worker and the seed script,
 * which load those services outside any request, never load `next/server`.
 */
export type Deliver = (work: () => Promise<void>) => void | Promise<void>;

/**
 * Done once the response has gone, through Next's `after()`. What the request
 * paths pass.
 *
 * Nobody is left waiting on the outcome, so nothing can report a failure to
 * the person who asked — they already have their answer. It is logged here
 * instead, as the error and never the message, which may carry a link.
 */
export const afterResponse: Deliver = (work) => {
  after(async () => {
    try {
      await work();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "Mail sent after the response could not be delivered",
      );
    }
  });
};
