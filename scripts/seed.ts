/**
 * Development seed data.
 *
 * Creates one registered user and hands them the demo workspace: two groups
 * (one converted, one separate), several participants and currencies, one
 * expense per split method, a multi-payer expense, a settlement, a recurring
 * template and the activity history that comes with all of it.
 *
 * The dataset itself lives in `src/modules/demo/dataset.ts`, because the demo
 * instance builds the same one for every visitor. Changing what a developer
 * sees here changes what the public demo shows, deliberately.
 *
 * Refuses to run against NODE_ENV=production — seeding a live instance would
 * inject fake financial records into someone's real data.
 */
import { closeDb, getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { registerUser } from "@/modules/auth/service";
import { seedDemoWorkspace } from "@/modules/demo/dataset";
import { listParticipants } from "@/modules/groups/service";
import type { UserActor } from "@/lib/security/authorization";

const SEED_EMAIL = "ada@example.com";
const SEED_PASSWORD = "balancia-dev-password";

async function main(): Promise<void> {
  const env = getEnv();
  if (env.isProduction) {
    throw new Error(
      "Refusing to seed: NODE_ENV is production. Seed data must never be written to a live instance.",
    );
  }

  logger.info("Creating the seed user");
  const registered = await registerUser({
    name: "Ada Lovelace",
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
  });

  const actor: UserActor = {
    kind: "user",
    userId: registered.user.userId,
    email: registered.user.email,
    name: registered.user.name,
  };

  logger.info("Creating the demo workspace");
  const workspace = await seedDemoWorkspace(actor);

  const tripParticipants = await listParticipants(workspace.tripGroupId);

  logger.info(
    {
      user: SEED_EMAIL,
      groups: [workspace.tripGroupId, workspace.flatGroupId],
      participants: tripParticipants.length,
    },
    "Seed complete",
  );

  console.log(`
Seed data ready.

  Sign in with:
    Email:    ${SEED_EMAIL}
    Password: ${SEED_PASSWORD}

  Groups:
    Lisbon trip (converted to EUR):  /groups/${workspace.tripGroupId}
    Flat share  (separate currencies): /groups/${workspace.flatGroupId}

  Guest link for Grace (shown once, as in the real flow):
    ${env.appOrigin}/join/${workspace.guestInvitationToken}
`);
}

main()
  .catch((error: unknown) => {
    logger.error(
      {
        err:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      },
      "Seed failed",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void getDb();
    void closeDb();
  });
