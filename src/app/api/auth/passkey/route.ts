import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { describeError } from "@/lib/server-errors";
import { AuthError } from "@/modules/auth/service";
import { deletePasskey, listPasskeys } from "@/modules/auth/webauthn";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Passkey management for the signed-in user.
 *
 * GET    → the user's registered passkeys
 * DELETE → remove one, scoped to the signed-in account
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
    await deletePasskey(user.userId, body.id);
    return NextResponse.json({ ok: true });
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
