"use client";

import * as React from "react";
import { avatarHue } from "./avatar-hue";

/**
 * Which hue each participant of the open group wears, by participant id.
 *
 * A participant belongs to one group, so a hue keyed by participant id gives
 * the same person a different colour in every group they share with the
 * reader. The group layout reads who has an account, works the hue out from
 * that account where there is one (`listFaceHues`), and hands down only the
 * numbers: no account id reaches the browser. `AvatarFallback` reads this
 * before falling back to hashing the key it was given.
 */
export const FaceHuesContext = React.createContext<Readonly<
  Record<string, number>
> | null>(null);

export function FaceHuesProvider({
  hues,
  children,
}: {
  hues: Readonly<Record<string, number>>;
  children: React.ReactNode;
}) {
  return (
    <FaceHuesContext.Provider value={hues}>{children}</FaceHuesContext.Provider>
  );
}

/**
 * The hue for a face drawn by hand rather than through `AvatarFallback` — the
 * same lookup it makes: the group's own answer for a participant it knows,
 * the key's hash for one it does not. Spread the result on the element.
 */
export function useFaceHue(key: string | undefined): {
  "data-avatar-hue"?: number;
  style?: React.CSSProperties;
} {
  const known = React.useContext(FaceHuesContext);
  if (!key) return {};
  const hue = known?.[key] ?? avatarHue(key);
  return {
    "data-avatar-hue": hue,
    style: { "--avatar-hue": hue } as React.CSSProperties,
  };
}
