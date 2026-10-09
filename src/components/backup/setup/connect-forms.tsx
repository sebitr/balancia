"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { Disclosure } from "@/components/settings/disclosure";
import { Button } from "@/components/ui/button";
import {
  S3_PRESETS,
  WEBDAV_VENDORS,
  type S3Preset,
} from "@/modules/backup/providers";
import type {
  FormKey,
  Forms,
  ProtonFields,
  S3Fields,
  TestState,
  WebdavFields,
} from "./draft";
import { isFormComplete } from "./draft";
import { CheckField, SecretField, SelectField, TextField } from "./fields";
import { useOutcomeText } from "./outcome";

/**
 * The three connections that are typed rather than travelled to.
 *
 * Each is a card of fields, an optional fold of "More options", and under them
 * the one button that proves the details work. The proof is part of the form,
 * not a step after it: Continue is off until the test has passed, and changing
 * anything puts it off again, because what passed was the details as they were.
 */

/** The labels of S3's service list, in the order the form shows them. */
const S3_SERVICES: readonly S3Preset[] = [
  "aws",
  "backblaze",
  "wasabi",
  "cloudflare",
  "infomaniak",
  "minio",
  "other",
];

export function TypedForm({
  formKey,
  forms,
  provider,
  test,
  onChange,
  onTest,
}: {
  formKey: FormKey;
  forms: Forms;
  /** The provider's name, for the sentences a failure is worded with. */
  provider: string;
  test: TestState;
  onChange: (key: FormKey, patch: Record<string, unknown>) => void;
  onTest: () => void;
}) {
  const t = useTranslations("cloudBackup");
  const testing = test.status === "testing";
  const complete = isFormComplete(formKey, forms);

  let intro: string = t("connect.formIntro");
  let fields: ReactNode;
  let more: ReactNode = null;

  switch (formKey) {
    case "s3":
    case "swiss": {
      const values = forms[formKey];
      const patch = (changes: Partial<S3Fields>) => onChange(formKey, changes);
      fields = (
        <S3Main values={values} patch={patch} withService={formKey === "s3"} />
      );
      more = <S3More values={values} patch={patch} />;
      break;
    }
    case "webdav":
    case "kdrive": {
      const values = forms[formKey];
      const patch = (changes: Partial<WebdavFields>) =>
        onChange(formKey, changes);
      fields = <WebdavMain values={values} patch={patch} />;
      // kDrive is one kind of server, so there is nothing to say about the type.
      more =
        formKey === "webdav" ? (
          <WebdavMore values={values} patch={patch} />
        ) : null;
      break;
    }
    case "proton_drive": {
      const values = forms.proton_drive;
      intro = t("connect.expNote");
      fields = (
        <ProtonMain
          values={values}
          patch={(changes) => onChange("proton_drive", changes)}
        />
      );
      break;
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (complete && !testing) onTest();
      }}
    >
      <fieldset
        disabled={testing}
        className="m-0 min-w-0 border-0 p-0"
        aria-busy={testing || undefined}
      >
        <SettingsCard contentClassName="p-0">
          <div className="space-y-3.5 p-4">
            <p className="text-xs text-pretty text-muted-foreground">{intro}</p>
            {fields}
          </div>
          {more && (
            <Disclosure label={t("connect.moreOptions")}>{more}</Disclosure>
          )}
          <div className="space-y-3 border-t border-border p-4">
            <Button
              type="submit"
              variant="outline"
              disabled={!complete}
              className="w-full lg:w-auto"
            >
              {testing && (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              )}
              {t("connect.test")}
            </Button>
            <TestResult test={test} provider={provider} />
          </div>
        </SettingsCard>
      </fieldset>
    </form>
  );
}

function S3Main({
  values,
  patch,
  withService,
}: {
  values: S3Fields;
  patch: (changes: Partial<S3Fields>) => void;
  /** Infomaniak's form has already been told which service it is. */
  withService: boolean;
}) {
  const t = useTranslations("cloudBackup");
  const preset = S3_PRESETS[values.service];

  const serviceName = (service: S3Preset): string => {
    switch (service) {
      case "aws":
        return t("connect.serviceAws");
      case "backblaze":
        return t("connect.serviceBackblaze");
      case "wasabi":
        return t("connect.serviceWasabi");
      case "cloudflare":
        return t("connect.serviceCloudflare");
      case "infomaniak":
        return t("connect.serviceInfomaniak");
      case "minio":
        return t("connect.serviceMinio");
      case "other":
        return t("connect.serviceOther");
    }
  };

  return (
    <>
      {withService && (
        <SelectField
          label={t("connect.service")}
          value={values.service}
          onChange={(service) => patch({ service: service as S3Preset })}
          options={S3_SERVICES.map((service) => ({
            value: service,
            label: serviceName(service),
          }))}
        />
      )}
      {/* Amazon's own address is no address at all, so there is none to ask. */}
      {values.service !== "aws" && (
        <TextField
          label={t("connect.address")}
          value={values.endpoint}
          onChange={(endpoint) => patch({ endpoint })}
          placeholder={preset.endpointHint || "https://s3.example.com"}
          inputMode="url"
          required
        />
      )}
      <TextField
        label={t("connect.region")}
        value={values.region}
        onChange={(region) => patch({ region })}
        placeholder={preset.regionHint}
      />
      <TextField
        label={t("connect.bucket")}
        value={values.bucket}
        onChange={(bucket) => patch({ bucket })}
        required
      />
      <TextField
        label={t("connect.accessKey")}
        value={values.accessKeyId}
        onChange={(accessKeyId) => patch({ accessKeyId })}
        required
      />
      <SecretField
        label={t("connect.secretKey")}
        value={values.secretAccessKey}
        onChange={(secretAccessKey) => patch({ secretAccessKey })}
        required
      />
    </>
  );
}

function S3More({
  values,
  patch,
}: {
  values: S3Fields;
  patch: (changes: Partial<S3Fields>) => void;
}) {
  const t = useTranslations("cloudBackup");
  return (
    <div className="space-y-3.5">
      <TextField
        label={t("connect.prefix")}
        value={values.prefix}
        onChange={(prefix) => patch({ prefix })}
      />
      <CheckField
        label={t("connect.pathStyle")}
        help={t("connect.pathStyleHelp")}
        checked={values.pathStyle}
        onChange={(pathStyle) => patch({ pathStyle })}
      />
    </div>
  );
}

function WebdavMain({
  values,
  patch,
}: {
  values: WebdavFields;
  patch: (changes: Partial<WebdavFields>) => void;
}) {
  const t = useTranslations("cloudBackup");
  return (
    <>
      <TextField
        label={t("connect.address")}
        value={values.url}
        onChange={(url) => patch({ url })}
        placeholder="https://cloud.example.com/remote.php/dav/files/you"
        inputMode="url"
        required
      />
      <TextField
        label={t("connect.folderLabel")}
        value={values.folder}
        onChange={(folder) => patch({ folder })}
      />
      <TextField
        label={t("connect.username")}
        value={values.username}
        onChange={(username) => patch({ username })}
        required
      />
      <SecretField
        label={t("connect.password")}
        value={values.password}
        onChange={(password) => patch({ password })}
        required
      />
    </>
  );
}

function WebdavMore({
  values,
  patch,
}: {
  values: WebdavFields;
  patch: (changes: Partial<WebdavFields>) => void;
}) {
  const t = useTranslations("cloudBackup");
  const names: Record<(typeof WEBDAV_VENDORS)[number], string> = {
    nextcloud: t("connect.vendorNextcloud"),
    owncloud: t("connect.vendorOwncloud"),
    other: t("connect.vendorOther"),
  };
  return (
    <SelectField
      label={t("connect.vendor")}
      value={values.vendor}
      onChange={(vendor) => patch({ vendor: vendor as WebdavFields["vendor"] })}
      options={WEBDAV_VENDORS.map((vendor) => ({
        value: vendor,
        label: names[vendor],
      }))}
    />
  );
}

function ProtonMain({
  values,
  patch,
}: {
  values: ProtonFields;
  patch: (changes: Partial<ProtonFields>) => void;
}) {
  const t = useTranslations("cloudBackup");
  return (
    <>
      <TextField
        label={t("connect.username")}
        value={values.username}
        onChange={(username) => patch({ username })}
        autoComplete="off"
        required
      />
      <SecretField
        label={t("connect.password")}
        value={values.password}
        onChange={(password) => patch({ password })}
        required
      />
      <SecretField
        label={t("connect.mailboxPassword")}
        help={t("connect.mailboxHelp")}
        value={values.mailboxPassword}
        onChange={(mailboxPassword) => patch({ mailboxPassword })}
      />
      <SecretField
        label={t("connect.otpSecret")}
        help={t("connect.otpHelp")}
        value={values.otpSecret}
        onChange={(otpSecret) => patch({ otpSecret })}
      />
    </>
  );
}

/**
 * What the test said, in place under its button and spoken as it changes.
 *
 * A pass is neutral ink with a check; a failure is the destructive token with
 * a circle-alert, Balancia's sentence for the code, what to do about it where
 * there is a line for that, and the provider's own words in monospace — never
 * translated, because they are what somebody would search for.
 */
function TestResult({ test, provider }: { test: TestState; provider: string }) {
  const t = useTranslations("cloudBackup");
  const words = useOutcomeText(provider);

  let body: ReactNode = null;
  if (test.status === "testing") {
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin"
          />
          {t("connect.testing")}
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("connect.testingHelp")}
        </p>
      </>
    );
  } else if (test.status === "passed") {
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          {t("connect.testOk")}
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("connect.testOkHelp")}
        </p>
      </>
    );
  } else if (test.status === "failed") {
    const { sentence, hint } = test.code
      ? words(test.code)
      : { sentence: test.message ?? words(null).sentence, hint: null };
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium text-destructive-ink">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          {t("connect.testFail")}
        </p>
        <p className="text-sm text-pretty">{sentence}</p>
        {hint && (
          <p className="text-xs text-pretty text-muted-foreground">{hint}</p>
        )}
        {test.detail && (
          <code className="block rounded-lg bg-wash-2 px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap">
            {test.detail}
          </code>
        )}
      </>
    );
  }

  return (
    <div role="status" className="space-y-1.5 empty:hidden">
      {body}
    </div>
  );
}
