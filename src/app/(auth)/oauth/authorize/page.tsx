import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ConsentProblem,
  ConsentRefused,
  ConsentScreen,
} from "@/components/agent-access/consent-screen";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";
import {
  parseAuthorizationRequest,
  refusalRedirect,
} from "@/modules/agent-access/authorization";
import { OAUTH_AUTHORIZE_PATH } from "@/modules/agent-access/constants";
import { sealConsent } from "@/modules/agent-access/consent-token";
import { listGroupsForUser } from "@/modules/groups/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("agentConsent");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/** The faults the decision route sends a person back here with. */
const PROBLEMS = ["tooMany", "notYourGroup", "expired"] as const;
type Problem = (typeof PROBLEMS)[number];

function isProblem(value: unknown): value is Problem {
  return PROBLEMS.includes(value as Problem);
}

/**
 * The authorization endpoint (RFC 6749 §3.1): where an AI agent sends a person
 * to say yes or no.
 *
 * The order is the specification's, and it is the order that keeps this from
 * being an open redirect:
 *
 *  1. **Is the client one we know, and is the address it wants the answer sent
 *     to one it registered?** If not, nothing is redirected anywhere — the
 *     person is told, here, that the connection cannot go ahead. Sending an
 *     error "back to the client" at an address nobody vouched for would be
 *     the vulnerability itself.
 *  2. **Is the rest of the request well formed?** If not, the person is told
 *     so here, with a link back to the application that they choose to follow.
 *     RFC 6749 would send the error to the registered address by itself, and
 *     with open registration that makes this an open redirector: the address is
 *     whatever its registrant typed, until somebody has allowed it once.
 *  3. **Is anybody signed in?** If not, to sign-in with this exact request
 *     carried along, so that signing in lands back here and not on the
 *     dashboard.
 *  4. Only then the screen.
 *
 * Nothing is written on a GET. The code is made when the person presses Allow,
 * in `decision/route.ts`.
 */
export default async function AuthorizePage({
  searchParams,
}: PageProps<"/oauth/authorize">) {
  const env = getEnv();
  if (!env.agentAccessEnabled) notFound();

  const raw = await searchParams;
  if (isProblem(raw.problem)) return <ConsentProblem reason={raw.problem} />;

  // Rebuilt with repeated parameters intact: the parser refuses a repeated one,
  // and a record would have silently kept only the last.
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) search.append(name, item);
    }
  }

  const parsed = await parseAuthorizationRequest(search, env.appOrigin);
  if (parsed.kind === "untrusted")
    return (
      <ConsentProblem
        reason={
          parsed.reason === "unknownClient" ? "unknownClient" : "badRedirect"
        }
      />
    );
  if (parsed.kind === "refused") {
    return (
      <ConsentRefused
        redirectUri={parsed.redirectUri}
        returnTo={refusalRedirect(parsed, env.appOrigin)}
        detail={`${parsed.error} — ${parsed.description}`}
      />
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `/sign-in?next=${encodeURIComponent(`${OAUTH_AUTHORIZE_PATH}?${search.toString()}`)}`,
    );
  }

  const { request } = parsed;
  const groups = await listGroupsForUser(user.userId);

  return (
    <ConsentScreen
      clientName={request.clientName}
      redirectUri={request.redirectUri}
      account={{ name: user.name }}
      groups={groups
        .filter((group) => group.archivedAt === null)
        .map((group) => ({ id: group.id, name: group.name }))}
      maxScope={request.maxScope}
      sealed={sealConsent({
        u: user.userId,
        c: request.clientId,
        r: request.redirectUri,
        h: request.codeChallenge,
        ...(request.state === undefined ? {} : { s: request.state }),
        m: request.maxScope,
        ...(request.resource === undefined ? {} : { d: request.resource }),
      })}
    />
  );
}
