import type { ProviderChoice } from "@/components/backup/provider-mark";
import {
  S3_PRESETS,
  WEBDAV_VENDORS,
  type BackupProvider,
  type S3Preset,
} from "@/modules/backup/providers";
import type { Frequency } from "@/modules/backup/schedule";
import type { SetupGroup, SetupReplaced } from "./types";

/**
 * Everything the person has decided so far, held in the page.
 *
 * A draft and nothing more: none of it reaches the server until a button says
 * so, and none of it goes in the address. A reload loses it, which is the
 * price of never putting a secret in a place that outlives the tab.
 */

export const KEEP_CHOICES = [5, 10, 20, 30] as const;
export const DEFAULT_KEEP = 10;

export interface S3Fields {
  service: S3Preset;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  pathStyle: boolean;
}

export interface WebdavFields {
  url: string;
  vendor: (typeof WEBDAV_VENDORS)[number];
  username: string;
  password: string;
  folder: string;
}

export interface ProtonFields {
  username: string;
  password: string;
  mailboxPassword: string;
  otpSecret: string;
}

/**
 * One form per way of typing a connection in. Infomaniak has two of its own
 * (`swiss`, `kdrive`) rather than borrowing S3's and WebDAV's, so that going
 * back to choose again does not leave a Swiss Backup key in a kDrive form.
 */
export type FormKey = "s3" | "swiss" | "webdav" | "kdrive" | "proton_drive";

export interface Forms {
  s3: S3Fields;
  swiss: S3Fields;
  webdav: WebdavFields;
  kdrive: WebdavFields;
  proton_drive: ProtonFields;
}

export type InfomaniakService = "kdrive" | "swiss";

export type TestState =
  | { readonly status: "idle" }
  | { readonly status: "testing" }
  | { readonly status: "passed" }
  | {
      readonly status: "failed";
      /** A `BackupErrorCode` or `BackupInputCode`, or null for a genuine fault. */
      readonly code: string | null;
      /** The provider's own words, as received. */
      readonly detail: string;
      /** The server's sentence for a fault that has no code. */
      readonly message: string | null;
    };

export interface Choices {
  frequency: Frequency;
  keepLast: number;
  /** Ids of the owned groups that are not ticked. */
  excludedGroupIds: string[];
  includeReceipts: boolean;
}

export interface Draft {
  provider: ProviderChoice | null;
  infomaniak: InfomaniakService | null;
  forms: Forms;
  test: TestState;
  choices: Choices;
}

const blankS3 = (service: S3Preset): S3Fields => ({
  service,
  endpoint: "",
  region: "",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  prefix: "",
  pathStyle: false,
});

const blankWebdav = (): WebdavFields => ({
  url: "",
  vendor: "other",
  username: "",
  password: "",
  folder: "",
});

export function blankForms(): Forms {
  return {
    s3: blankS3("aws"),
    swiss: blankS3("infomaniak"),
    webdav: blankWebdav(),
    kdrive: blankWebdav(),
    proton_drive: {
      username: "",
      password: "",
      mailboxPassword: "",
      otpSecret: "",
    },
  };
}

/** The choices to start from: the ones being replaced, or the defaults. */
export function choicesFrom(
  replace: SetupReplaced | null,
  ownedGroups: readonly SetupGroup[],
): Choices {
  if (!replace) {
    return {
      frequency: "daily",
      keepLast: DEFAULT_KEEP,
      excludedGroupIds: [],
      includeReceipts: false,
    };
  }
  const owned = new Set(ownedGroups.map((group) => group.id));
  return {
    frequency: replace.frequency,
    keepLast: replace.keepLast,
    // A group that is no longer theirs is not one they can untick.
    excludedGroupIds: replace.excludedGroupIds.filter((id) => owned.has(id)),
    includeReceipts: replace.includeReceipts,
  };
}

/** Which form the choice leads to, or null for a provider connected by a trip. */
export function formKeyFor(
  provider: ProviderChoice | null,
  infomaniak: InfomaniakService | null,
): FormKey | null {
  switch (provider) {
    case "s3":
      return "s3";
    case "webdav":
      return "webdav";
    case "proton_drive":
      return "proton_drive";
    case "infomaniak":
      return infomaniak === "swiss"
        ? "swiss"
        : infomaniak === "kdrive"
          ? "kdrive"
          : null;
    default:
      return null;
  }
}

/** The provider the server is told about, for a form. */
export function providerOfForm(key: FormKey): BackupProvider {
  switch (key) {
    case "s3":
    case "swiss":
      return "s3";
    case "webdav":
    case "kdrive":
      return "webdav";
    case "proton_drive":
      return "proton_drive";
  }
}

/**
 * What a person types for a server is an address, and an address without a
 * scheme is the usual way to type one — the hint under Backblaze's field does
 * it. The schema wants `https://`, so it is added where it is missing rather
 * than sending somebody back to find out why `s3.example.com` is not a URL.
 */
export function normaliseAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The details a form stands for, shaped as `credentialSchemas` wants them. */
export function credentialsFor(
  key: FormKey,
  forms: Forms,
): { provider: BackupProvider; credentials: Record<string, unknown> } {
  switch (key) {
    case "s3":
    case "swiss": {
      const f = forms[key];
      return {
        provider: "s3",
        credentials: {
          // Amazon's own address is no address at all.
          endpoint: f.service === "aws" ? "" : normaliseAddress(f.endpoint),
          region: f.region.trim(),
          flavour: S3_PRESETS[f.service].flavour,
          bucket: f.bucket.trim(),
          prefix: f.prefix.trim(),
          accessKeyId: f.accessKeyId.trim(),
          secretAccessKey: f.secretAccessKey,
          pathStyle: f.pathStyle,
        },
      };
    }
    case "webdav":
    case "kdrive": {
      const f = forms[key];
      return {
        provider: "webdav",
        credentials: {
          url: normaliseAddress(f.url),
          vendor: key === "kdrive" ? "other" : f.vendor,
          username: f.username.trim(),
          password: f.password,
          folder: f.folder.trim(),
        },
      };
    }
    case "proton_drive": {
      const f = forms.proton_drive;
      return {
        provider: "proton_drive",
        credentials: {
          username: f.username.trim(),
          password: f.password,
          ...(f.mailboxPassword !== ""
            ? { mailboxPassword: f.mailboxPassword }
            : {}),
          ...(f.otpSecret.trim() !== ""
            ? { otpSecret: f.otpSecret.trim() }
            : {}),
        },
      };
    }
  }
}

/** Whether every field a connection cannot do without has something in it. */
export function isFormComplete(key: FormKey, forms: Forms): boolean {
  switch (key) {
    case "s3":
    case "swiss": {
      const f = forms[key];
      return (
        (f.service === "aws" || f.endpoint.trim() !== "") &&
        f.bucket.trim() !== "" &&
        f.accessKeyId.trim() !== "" &&
        f.secretAccessKey !== ""
      );
    }
    case "webdav":
    case "kdrive": {
      const f = forms[key];
      return (
        f.url.trim() !== "" && f.username.trim() !== "" && f.password !== ""
      );
    }
    case "proton_drive": {
      const f = forms.proton_drive;
      return f.username.trim() !== "" && f.password !== "";
    }
  }
}

export function initialDraft(input: {
  provider: ProviderChoice | null;
  replace: SetupReplaced | null;
  ownedGroups: readonly SetupGroup[];
}): Draft {
  return {
    provider: input.provider,
    infomaniak: null,
    forms: blankForms(),
    test: { status: "idle" },
    choices: choicesFrom(input.replace, input.ownedGroups),
  };
}
