/**
 * Generates a VAPID key pair for Web Push.
 *
 * Run with `pnpm push:keys` and copy the three lines into `.env`. The pair
 * identifies this instance to the push services (Google's, Mozilla's,
 * Apple's) that relay notifications to browsers — it is not an encryption
 * key, and it is not shared with anyone else's instance.
 *
 * Generating a new pair invalidates every existing subscription: browsers bind
 * their subscription to the public key that created it, so everyone has to
 * switch notifications back on. Generate once, then keep it with the rest of
 * your secrets.
 */
import { generateKeyPair } from "../src/lib/push/keys";

const SUBJECT_PLACEHOLDER = "mailto:admin@example.com";

function main(): void {
  const { publicKey, privateKey } = generateKeyPair();

  process.stdout.write(
    [
      "# Web Push (VAPID). Add these to .env — the private key is a secret.",
      `PUSH_VAPID_PUBLIC_KEY=${publicKey}`,
      `PUSH_VAPID_PRIVATE_KEY=${privateKey}`,
      `# A contact address for the push service operators. Change this.`,
      `PUSH_VAPID_SUBJECT=${SUBJECT_PLACEHOLDER}`,
      "",
    ].join("\n"),
  );
}

main();
