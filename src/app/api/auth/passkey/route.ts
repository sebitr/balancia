import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/security/actor";
import { AuthError } from "@/modules/auth/service";
import { deletePasskey, listPasskeys } from "@/modules/auth/webauthn";

/**
 * Passkey management for the signed-in user.
 *
 * GET    → the user's registered passkeys
 * DELETE → remove one, scoped to the signed-in account
 */

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401 },
    );
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
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401 },
    );
  }

  let body: { id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    await deletePasskey(user.userId, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
