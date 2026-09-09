import "server-only";
import { getLocale, getTranslations } from "next-intl/server";
import { getEnv } from "@/lib/env";
import { linkPreviewResponse } from "@/lib/link-preview";
import type { GroupIcon, GroupIconColor } from "@/modules/groups/icons";
import { shareCardPath, SHARE_CARD_SIZE } from "@/modules/groups/share-card";

/**
 * What a chat app is told about a join link.
 *
 * Both join routes are redirects that spend a token, and neither can carry a
 * meta tag. So each recognises a link-preview crawler and answers it here
 * instead — with a document, a group name and a picture, and without spending
 * anything. `src/lib/link-preview.ts` holds the recognising and the writing;
 * this holds the words and where the picture comes from.
 *
 * Nothing is said that the crawler could not learn by following the link.
 * That is the whole safety argument, and it is why the *dead* link case says
 * nothing at all: a revoked, expired or invented token gets the app's own
 * card, which is exactly what the reader is entitled to know.
 */

export type JoinPreviewSubject =
  | {
      readonly kind: "group";
      readonly groupName: string;
      readonly groupIcon: GroupIcon | null;
      readonly groupIconColor: GroupIconColor | null;
      /** Who minted the link, when the account is still there. */
      readonly inviterName: string | null;
    }
  | {
      readonly kind: "personal";
      readonly groupName: string;
      readonly groupIcon: GroupIcon | null;
      readonly groupIconColor: GroupIconColor | null;
    }
  /** A link that resolves to nothing, and must therefore describe nothing. */
  | { readonly kind: "dead" };

/**
 * The bubble, as a response.
 *
 * `path` is the link's own address, token and all, so that `og:url` is what
 * tapping the bubble opens. It carries nothing the crawler is not already
 * holding — it fetched that URL to get here.
 */
export async function joinLinkPreviewResponse(
  path: string,
  subject: JoinPreviewSubject,
): Promise<Response> {
  const [t, meta, locale] = await Promise.all([
    getTranslations("linkPreview"),
    getTranslations("meta"),
    getLocale(),
  ]);
  const origin = getEnv().appOrigin;
  const absolute = (relative: string) => new URL(relative, origin).toString();

  if (subject.kind === "dead") {
    return linkPreviewResponse({
      url: absolute(path),
      title: "Balancia",
      description: meta("description"),
      image: absolute(shareCardPath(null, null)),
      imageAlt: "Balancia",
      imageSize: SHARE_CARD_SIZE,
      locale,
    });
  }

  const group = subject.groupName;
  return linkPreviewResponse({
    url: absolute(path),
    title:
      subject.kind === "personal"
        ? t("personalTitle", { group })
        : t("groupTitle", { group }),
    description:
      subject.kind === "personal"
        ? t("personal", { group })
        : subject.inviterName
          ? t("groupFrom", { group, inviter: subject.inviterName })
          : t("group", { group }),
    image: absolute(shareCardPath(subject.groupIcon, subject.groupIconColor)),
    imageAlt: t("imageAlt", { group }),
    imageSize: SHARE_CARD_SIZE,
    locale,
  });
}
