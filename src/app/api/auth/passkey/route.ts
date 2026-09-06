import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { describeError } from "@/lib/server-errors";
import { AuthError } from "@/modules/auth/service";
import {
  deletePasskey,
  listPasskeys,
  passkeySignalState,
} from "@/modules/auth/webauthn";
import { getEnv } from "@/lib/env";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Passkey management for the signed-in user.
 *
 * GET    → the user's registered passkeys
 * DELETE → remove one, scoped to the signed-in account
 *
 * The delete answers with more than an acknowledgement, because deleting the
 * row is only half of it: until the browser tells the reader's password
 * manager, the credential goes on being offered at every sign-in and fails
 * when it is chosen. `signal` is what the browser needs to say so, and the
 * relying-party ID travels with it so the caller has nothing to look up.
 */

export async function GET() {
  return trackRoute("/api/auth/passkey", "GET", () => handleGet());
}

async function handleGet() {
  const user = await getCurrentUser();
  if (!user) {
    const t = await getTranslations("serverErrors");
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  const credentials = await listPasskeys(user.userId);
  return NextResponse.json(
    {
      passkeys: credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        deviceType: credential.deviceType,
        backedUp: credential.backedUp,
        aaguid: credential.aaguid,
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request) {
  return trackRoute("/api/auth/passkey", "DELETE", () => handleDelete(request));
}

async function handleDelete(request: Request) {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  let body: { id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: t("malformedRequest") }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: t("malformedRequest") }, { status: 400 });
  }

  try {
    const { userHandle } = await deletePasskey(user.userId, body.id);
    // Computed after the row is gone, and told about the handle that went with
    // it: an account whose last passkey this was has nothing left to name it.
    const signal = await passkeySignalState(user.userId, {
      alsoClear: [userHandle],
    });
    return NextResponse.json({
      ok: true,
      rpId: getEnv().webAuthnRpId,
      signal,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: await describeError(error) },
        { status: 404 },
      );
    }
    throw error;
  }
}
