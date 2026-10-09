"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ProviderChoice } from "@/components/backup/provider-mark";
import { Progress } from "@/components/ui/progress";
import {
  createDestinationAction,
  finishSetupAction,
  removeDestinationAction,
  testDestinationAction,
} from "@/modules/backup/actions";
import { ConnectStep } from "./connect-step";
import {
  credentialsFor,
  formKeyFor,
  initialDraft,
  type Choices,
  type Draft,
  type FormKey,
  type InfomaniakService,
  type TestState,
} from "./draft";
import { KeyStep } from "./key-step";
import { providerName, useOutcomeText } from "./outcome";
import { kindOfChoice } from "./resolve";
import { OVERVIEW_PATH, setupUrl } from "./setup-url";
import type { SetupStep, SetupWizardProps } from "./types";
import { WhatStep, type FinishError } from "./what-step";
import { WhereStep } from "./where-step";

/**
 * The setup wizard: four steps, one draft.
 *
 * The step lives in the address, so the browser's Back button walks the steps
 * and a reload lands where it was. The draft — which provider, the typed
 * details, whether the test passed, the ticks — lives here, in the one
 * component that every step renders under. Navigating between steps changes
 * the page's props and not this component's place in the tree, so none of it is
 * lost on the way; and none of it is written to the address, because a bucket's
 * secret has no business in a URL.
 *
 * What a reload does lose is the typed details, and a step that needs them
 * (step 4 after a typed connection) says so by going back to step 3 rather than
 * drawing something it cannot finish.
 */
export function SetupWizard(props: SetupWizardProps) {
  const { rotate, replace, pending, ownedGroups, providers } = props;
  const t = useTranslations("cloudBackup");
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);

  const [navigating, startNavigation] = useTransition();
  // The key is made on the first step and saved at the end of it, so by the
  // second step the page is told a key exists. The count of steps a person was
  // promised does not change under them for that.
  const [startedWithoutKey] = useState(!props.hasKey);
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft({ provider: props.provider, replace, ownedGroups }),
  );
  const [finishing, setFinishing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [finishError, setFinishError] = useState<FinishError | null>(null);

  const provider = draft.provider;
  const formKey = formKeyFor(provider, draft.infomaniak);
  const oauth = provider !== null && kindOfChoice(provider) === "oauth";
  const accountTile = oauth
    ? providers.find((tile) => tile.id === provider)
    : undefined;
  // The connection the trip made counts for the provider it was made with.
  const connection =
    props.connected && pending !== null && provider === pending.provider
      ? pending
      : null;
  const connectionReady = oauth
    ? connection !== null
    : formKey !== null && draft.test.status === "passed";

  // Where the draft says this request can be. The address is a request, and
  // some requests — a reload after typing, a step typed by hand — cannot be
  // honoured, because the details they depend on are gone.
  let step: SetupStep = props.step;
  if (!rotate) {
    if ((step === "connect" || step === "what") && provider === null) {
      step = "where";
    }
    if (step === "what" && !connectionReady) step = "connect";
  }

  const addressFor = (to: SetupStep) =>
    setupUrl({
      step: to,
      provider,
      connected: connection?.id,
      replace: replace?.id,
    });

  const wanted = addressFor(step);
  useEffect(() => {
    if (step !== props.step) router.replace(wanted);
  }, [step, props.step, wanted, router]);

  // A step that has just appeared takes focus on its heading, so a keyboard or
  // a screen reader lands on the new page and not on a button that has gone.
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    const heading = container.current?.querySelector<HTMLElement>("h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [step]);

  const order: readonly SetupStep[] = rotate
    ? ["key"]
    : props.hasKey
      ? ["where", "connect", "what"]
      : ["key", "where", "connect", "what"];
  const stepsShown: readonly SetupStep[] = rotate
    ? ["key"]
    : startedWithoutKey
      ? ["key", "where", "connect", "what"]
      : ["where", "connect", "what"];
  const number = Math.max(stepsShown.indexOf(step), 0) + 1;

  const go = (to: SetupStep) =>
    startNavigation(() => router.push(addressFor(to)));

  const cancel = async () => {
    setLeaving(true);
    // A connection the trip made and nobody finished is not worth keeping.
    if (pending) await removeDestinationAction(pending.id).catch(() => null);
    router.push(OVERVIEW_PATH);
  };

  const previous = order[order.indexOf(step) - 1];
  const secondary =
    previous === undefined
      ? { label: t("setup.cancel"), onClick: cancel, disabled: leaving }
      : {
          label: t("setup.back"),
          onClick: () => go(previous),
          disabled: navigating || finishing,
        };

  const edit = (changes: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const choose = (choice: ProviderChoice) =>
    setDraft((current) =>
      current.provider === choice
        ? current
        : {
            ...current,
            provider: choice,
            infomaniak: null,
            test: { status: "idle" },
          },
    );

  const chooseInfomaniak = (service: InfomaniakService) =>
    edit({ infomaniak: service, test: { status: "idle" } });

  // Editing anything puts the pass away: what passed was the details as they
  // were, and Continue must not outlive them.
  const editForm = (key: FormKey, patch: Record<string, unknown>) =>
    setDraft((current) => ({
      ...current,
      forms: { ...current.forms, [key]: { ...current.forms[key], ...patch } },
      test: { status: "idle" },
    }));

  const editChoices = (patch: Partial<Choices>) =>
    setDraft((current) => ({
      ...current,
      choices: { ...current.choices, ...patch },
    }));

  const runTest = async () => {
    if (!formKey) return;
    const { provider: kind, credentials } = credentialsFor(
      formKey,
      draft.forms,
    );
    edit({ test: { status: "testing" } });

    let next: TestState;
    try {
      const result = await testDestinationAction({
        provider: kind,
        credentials,
      });
      if (!result.ok) {
        next = {
          status: "failed",
          code: null,
          detail: "",
          message: result.error ?? null,
        };
      } else if (result.data?.ok) {
        next = { status: "passed" };
      } else {
        next = {
          status: "failed",
          code: result.data?.code ?? null,
          detail: result.data?.detail ?? "",
          message: null,
        };
      }
    } catch {
      next = { status: "failed", code: null, detail: "", message: null };
    }
    edit({ test: next });
  };

  const words = useOutcomeText(provider ? providerName(provider) : "");

  const finish = async () => {
    const { frequency, keepLast, excludedGroupIds, includeReceipts } =
      draft.choices;
    const choices = {
      frequency,
      keepLast,
      excludedGroupIds,
      includeReceipts,
      ...(replace ? { replaces: replace.id } : {}),
    };

    setFinishing(true);
    setFinishError(null);
    try {
      const result =
        oauth && connection
          ? await finishSetupAction({ id: connection.id, ...choices })
          : formKey
            ? await createDestinationAction({
                ...credentialsFor(formKey, draft.forms),
                ...choices,
              })
            : null;
      if (result?.ok && result.data?.ok) {
        // Left standing, busy, until the overview replaces it: there is
        // nothing left on this screen to press.
        router.push(OVERVIEW_PATH);
        router.refresh();
        return;
      }
      if (result?.ok && result.data && !result.data.ok) {
        setFinishError(words(result.data.code));
      } else {
        setFinishError({
          sentence: result?.error ?? words(null).sentence,
          hint: null,
        });
      }
    } catch {
      setFinishError({ sentence: words(null).sentence, hint: null });
    }
    setFinishing(false);
  };

  const names: Record<SetupStep, string> = {
    key: t("setup.stepKey"),
    where: t("setup.stepWhere"),
    connect: t("setup.stepConnect"),
    what: t("setup.stepWhat"),
  };

  const progressLabel = t("setup.step", {
    step: number,
    total: stepsShown.length,
  });
  const percent = (number / stepsShown.length) * 100;

  return (
    <div ref={container} className="contents">
      {!rotate && (
        <div className="space-y-2 px-1.5">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <p className="font-semibold">{progressLabel}</p>
            <p className="text-right text-muted-foreground">{names[step]}</p>
          </div>
          {/* `Progress` draws the bar from `value` but does not hand it on to
              the progressbar, so the reading is stated here as well. */}
          <Progress
            value={percent}
            aria-valuenow={percent}
            aria-label={progressLabel}
          />
        </div>
      )}

      {step === "key" && (
        <KeyStep
          rotate={rotate}
          onCancel={cancel}
          onSaved={() => {
            if (rotate) {
              router.push(OVERVIEW_PATH);
              router.refresh();
            } else {
              go("where");
            }
          }}
        />
      )}

      {step === "where" && (
        <WhereStep
          providers={providers}
          selected={provider}
          onSelect={choose}
          replacedName={replace ? providerName(replace.provider) : null}
          secondary={secondary}
          onContinue={() => go("connect")}
          busy={navigating}
        />
      )}

      {step === "connect" && provider && (
        <ConnectStep
          provider={provider}
          draft={draft}
          connection={connection}
          outcome={props.connectOutcome}
          account={{
            instanceApp: accountTile?.instanceApp ?? false,
            redirectUri: accountTile?.redirectUri ?? null,
          }}
          otherAccountHref={setupUrl({
            step: "connect",
            provider,
            replace: replace?.id,
          })}
          onInfomaniak={chooseInfomaniak}
          onForm={editForm}
          onTest={runTest}
          secondary={secondary}
          onContinue={() => go("what")}
          busy={navigating}
        />
      )}

      {step === "what" && (
        <WhatStep
          ownedGroups={ownedGroups}
          choices={draft.choices}
          onChoices={editChoices}
          error={finishError}
          finishing={finishing}
          onFinish={finish}
          secondary={secondary}
        />
      )}
    </div>
  );
}
