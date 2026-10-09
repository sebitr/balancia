import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { trackRoute } from "@/lib/metrics/http";
import { getCurrentUser } from "@/lib/security/actor";
import {
  approveAuthorization,
  AuthorizationChoiceError,
  denialRedirect,
  type AuthorizationRequest,
} from "@/modules/agent-access/authorization";
import { getClient } from "@/modules/agent-access/clients";
import { OAUTH_AUTHORIZE_PATH } from "@/modules/agent-access/constants";
import { openConsent } from "@/modules/agent-access/consent-token";
import { handoffPage } from "@/modules/agent-access/handoff";
import {
  describeRedirect,
  redirectUriMatches,
} from "@/modules/agent-access/redirect-uri";

/**
 * The consent screen's answer: `POST /oauth/authorize/decision`.
 *
 * The form on the screen posts here, and the person is sent on to the address
 * the application registered — with a code and the client's `state` if they said
 * yes, with `error=access_denied` if they said no.
 *
 * **Not by redirect.** A `303` is the obvious answer and Chromium refuses to
 * follow it: the site's `form-action 'self'` applies to the redirect a form
 * post gets, so the form is processed, the code issued, and then nothing
 * happens on screen. The answer is a small page that navigates on by itself —
 * see `handoff.ts`. Only the faults that send the person back to Balancia's own
 * screen are redirects, because those stay on this origin.
 *
 * ## What is trusted
 *
 * The sealed `request` field and nothing else about the request. It was made by
 * the screen, for this account, ten minutes ago at most, and it says which
 * client, which address and which challenge; a form edited in the browser
 * cannot change any of them. The two choices the person actually makes — how
 * much, and which group — are read from the form and checked again here: the
 * scope cannot exceed what the application asked for, and the group has to be
 * one this account is in.
 *
 * This is also the CSRF defence. A forged form cannot carry a seal that opens
 * for the victim's account, the session cookie is `SameSite=Lax` so a
 * cross-site POST does not send it, and `proxy.ts` refuses a cross-origin POST
 * that names an `Origin` of its own.
 */

const groupSchema = z.uuid();

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

/** On to the application, by a page rather than a redirect: see the note above. */
async function handoff(location: string): Promise<Response> {
  const t = await getTranslations("agentConsent");
  const where = describeRedirect(location);
  const label =
    where.kind === "web"
      ? t("whereWeb", { host: where.label })
      : where.kind === "local"
        ? t("whereLocal", { host: where.label })
        : t("whereApp", { scheme: where.label });

  return new Response(
    handoffPage({
      location,
      language: await getLocale(),
      title: t("handoffTitle", { where: label }),
      hint: t("handoffHint"),
      continueLabel: t("handoffContinue"),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

/** Back to the screen, which explains what went wrong in the person's words. */
function problem(reason: "tooMany" | "notYourGroup" | "expired"): Response {
  return seeOther(`${OAUTH_AUTHORIZE_PATH}?problem=${reason}`);
}

export async function POST(request: Request) {
  return trackRoute("/oauth/authorize/decision", "POST", () => handle(request));
}

async function handle(request: Request): Promise<Response> {
  const env = getEnv();
  if (!env.agentAccessEnabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  let form: FormData;
  try {
    // Four short fields and a seal of a few hundred bytes: anything announcing
    // itself as more than this is not the screen's form.
    if (Number(request.headers.get("Content-Length") ?? 0) > 64 * 1024) {
      return problem("expired");
    }
    form = await request.formData();
  } catch {
    return problem("expired");
  }

  const claims = openConsent(form.get("request"));
  const user = await getCurrentUser();
  if (!claims || !user || user.userId !== claims.u) return problem("expired");

  // The client and its address are re-read rather than believed: the seal says
  // what was true ten minutes ago, and a client can have been removed since.
  const client = await getClient(claims.c);
  if (!client || !redirectUriMatches(client.redirectUris, claims.r)) {
    return problem("expired");
  }

  const authorization: AuthorizationRequest = {
    clientId: client.id,
    clientName: client.name,
    redirectUri: claims.r,
    state: claims.s,
    codeChallenge: claims.h,
    maxScope: claims.m,
    resource: claims.d,
  };

  if (form.get("decision") !== "allow") {
    return handoff(denialRedirect(authorization, env.appOrigin));
  }

  const requestedGroup = form.get("group");
  const groupId =
    typeof requestedGroup === "string" && requestedGroup !== "all"
      ? groupSchema.safeParse(requestedGroup).success
        ? requestedGroup
        : null
      : null;
  // A group id that is not a UUID was not chosen from the list.
  if (
    typeof requestedGroup === "string" &&
    requestedGroup !== "all" &&
    groupId === null
  ) {
    return problem("notYourGroup");
  }

  try {
    const location = await approveAuthorization(
      authorization,
      user.userId,
      // Anything but an explicit "write" is read: a form that lost the field,
      // or was posted by hand, gets the least it could.
      { scope: form.get("scope") === "write" ? "write" : "read", groupId },
      env.appOrigin,
    );
    return handoff(location);
  } catch (error) {
    if (error instanceof AuthorizationChoiceError) {
      return problem(error.reason);
    }
    throw error;
  }
}
