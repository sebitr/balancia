# Cloud backup: design spec

Design: https://claude.ai/artifact/A5JMYtHhvcwGNnWUs3Ycpq (private; ask the owner to share it). Eleven boards, A to K. Every frame has a code in its caption (A1, B3 …) and this document uses the same codes.

Status: built, on `feat/encrypted-cloud-backup`. The boards and this spec are what was drawn first; where the build differs, it is listed here, and everything below is otherwise as drawn.

**Where the build departs from the drawing, and why.**

- **iCloud Drive is not offered** (boards C2, D10, D11, G3). Signing in takes an interactive two-factor handshake nothing in the repository can complete or test without an Apple account. See `docs/cloud-backup.md`, "Not offered: iCloud Drive".
- **No "Import into a new group" button** (H8, H10). Restore offers _Download as JSON_ and a line saying to create a group and use Import in its settings (question 1; `todo/next/cloud-backup-import-into-new-group.md`).
- **No notification row** (G4, G6, §5.9). Notifications are group-scoped and a failed backup belongs to the account (question 2; `todo/next/cloud-backup-failure-notification.md`). The banner and the settings-row pill carry it.
- **Administration is variant J3** (question 3): the local-network setting is read-only and names its environment variable (`todo/next/cloud-backup-local-network-switch.md`).
- **The public key is saved when step 1's Continue is pressed**, not at the end of setup (question 6), because connecting Google, Dropbox or OneDrive leaves the page and the draft goes with it. A connection made that way waits in a `setup` state until step 4 finishes it.
- **"Use my own key"** (question 5) is drawn as a text link under the key block in step 1, and Infomaniak asks "kDrive or Swiss Backup" at the top of step 3 (question 7).
- **Receipts "88 uploaded · 140 to go" reads "{n} still to go"** (F6): the backend stores how many are pending, not how many are done, and a number nothing stores should not be on a screen.
- **The progress bar of a running backup is indeterminate** (F2): a run records no done/total, so "6 of 14 groups" has nothing to say.
- **The connection test's copy no longer says the test file is encrypted** (D5, D6): it is a plain file, written, found again and deleted.
- Provider monograms, the recovery key block, the status marks and the rules in §4 are as drawn.

Written while the backend was being built beside it: `docs/cloud-backup.md` and `src/modules/backup` were found in the working tree and read. Where they decide something, the boards follow them (§9); where they differ from the brief, that is flagged (§10).

## 1. What it is

An owner of one or more groups backs those groups up, encrypted, to a cloud service they choose, on a schedule. Each backup is encrypted in Balancia's server to a public key. The private half, the **recovery key**, is made in the person's browser, shown once and never sent. Balancia and the cloud provider see only ciphertext. Lose the key and the backups cannot be read by anyone; the UI says that once, on the screen where the key is made.

## 2. Decisions made (and why)

1. **One destination per account**, one overview, one filled button on each screen ("Back up now", or the banner's action when that cannot work).
2. **The key comes first.** Step 1 makes it, because the server needs the public half before anything can be uploaded and because the loss warning belongs where the person is holding the key. Continue stays off until the box is ticked and the last 6 characters are typed back. The last group of the key is 6 characters wide and outlined, so "the last 6" is something you can see.
3. **Providers are rows on a phone and tiles from lg.** Account providers (Google Drive, Dropbox, Microsoft OneDrive, the last for personal accounts only), own server or storage (Infomaniak, Nextcloud/WebDAV, S3-compatible), and a separate Experimental group. A provider this server does not offer stays visible and says so in words.
4. **Status is an icon and a word, never colour alone**: check "Backed up", circle-minus "No changes", circle-alert "Failed". Success is neutral ink, failure is the destructive token. Green, red and amber from the money palette are not used (see question 4).
5. **Everything that can be pressed back saves in silence.** The pause switch, the Daily/Weekly chips, the "Backups to keep" chips, the group tick list and the receipts switch. A refusal flicks the control back and speaks (F8). Only two things ask first: stopping, and creating a new key.
6. **Receipts are a separate, quieter card**, off by default, with the cost spelled out beside the switch and a live estimate once it is on (E2, E3, E5).
7. **Failure is never silent**: a banner above the card (G1 to G3), "Needs attention" on the hub row (G5), one row in notifications (G4, G6) and every run kept in History.
8. **Restore opens in the browser.** Choose a backup (from the connected cloud, or an `.age` file), give the key, and the groups inside can be downloaded as JSON or taken into the import screen. The standalone `age` command is one line away.
9. **Provider marks are monograms.** No logos are drawn.
10. **French fits.** FR1 and FR2 on board K are the same screens with copy about 40% longer: labels stack over values, rows wrap, buttons are full width on a phone.

## 3. Where it lives

- **Hub row.** Settings, Data group, after "Data & imports": `SettingsLinkRow` with the lucide `Cloud` icon, label `cloudBackup.hub.label`, summary "Not set up" or "Daily · Google Drive" or "Weekly · Dropbox" or "Paused · Google Drive". When something needs attention the row shows a destructive pill with an icon and the words "Needs attention" instead of a summary (G5), through the row's `trailing`. Facts come from `loadSettingsHub` in `src/components/settings/settings-hub.tsx`.
- **Routes.** `/settings/backup` (empty state or overview), `/settings/backup/setup` (one screen per step: `?step=key|where|connect|what`), `/settings/backup/restore`. The OAuth return lands on `/settings/backup/setup?step=connect`.
- **Below `lg`** each is its own page: `SettingsScreen` with a back arrow (to `/settings`; on a wizard step, to the previous step). **From `lg`** the screen is the right pane of `src/app/settings/layout.tsx`: hub column 20rem, 2rem gap, content capped at 70rem including `xl:px-10`, so the pane is **688px wide at 1440**. The arrow is hidden there (the hub is beside it), so the wizard's own footer carries Cancel on step 1 and Back after it.
- **Administration.** Two new cards on `src/app/settings/admin/page.tsx`.

## 4. Rules every screen follows

- **Saves the moment it is pressed, with no Save button and no toast**: the automatic-backups switch, the Daily/Weekly chips, the "Backups to keep" chips, every tick in the group list and the receipts switch inside Manage, and every switch on the Administration card. Use `useAutosave` (`src/components/ui/use-autosave.ts`) with timing `"chosen"` and no `announce`. Pressing the control again is the way back.
- **A refusal speaks and the control goes back** to what is stored: `toast.error` with "That change could not be saved." (F8).
- **A result in place, not a toast**: Back up now shows progress, then "Backed up just now" in the card (F2, F3); Copy changes to "Copied"; Test connection answers under its button. A failed _manual_ run is an error toast plus a History row.
- **Asks first** (`ConfirmSheet`, the way out named in the reader's words): "Stop backing up" and "Create a new key". Nothing else on these screens asks.
- **Setup is a draft.** Every choice is held in the page until "Start backing up". The recovery key exists only in memory: leaving the wizard throws it away and a reload makes a new one. The page says so under Continue.
- **Typography and fields**: the seven sizes only; the phone is one point larger, set once. Every text field is `text-base md:text-sm` (the Input default). The key confirmation field is monospace and uppercase with letter-spacing, and still 16px on a phone. Every control has a 44px target (`tap-target`).
- **Accent**: buttons, ring, selected chips, switch, progress bar. Never a status.

## 5. Screens

Components named here are the ones expected to be reused; "new" ones are listed in §6.

### 5.1 Settings hub row

Frames: the pane in A4, F9, G5, H9, I4 and J2. Reuses `SettingsLinkRow` (`summary`, or `trailing` for the attention pill), `SettingsGroup`, `SettingsRows`. States: not set up, active (schedule and provider), paused, needs attention.

### 5.2 Empty state, board A

Route `/settings/backup` when no destination exists. Reuses `SettingsScreen`, `EmptyState` (icon `Cloud`), `SettingsCard` with `SettingsRows` for the three reasons, `Button` (default for the action, `link` for the restore link). Two sentences on what it does, three short reasons, one button. A small "Have a backup file? Restore from a backup" link under the button (question 12).

| Frame | Width · theme   | What it shows                                                            |
| ----- | --------------- | ------------------------------------------------------------------------ |
| A1    | phone · light   | Empty state                                                              |
| A2    | phone · dark    | Empty state                                                              |
| A3    | phone · light   | Owns no group yet: nothing to back up, so the button is off and says why |
| A4    | desktop · light | Right pane at 1440. The hub row beside it reads “Not set up”             |

### 5.3 Step 1 of 4: create your recovery key, board B

Reuses `SettingsScreen` (back to `/settings/backup`), `SettingsCard`, `Button`, `Input`, `Checkbox`, `Progress` (value 25 of 100). New: `RecoveryKeyBlock`.

- The key is an age identity, `AGE-SECRET-KEY-1` plus 58 characters (74 in all), made in the browser (the `age-encryption` package on WebCrypto is the expected way). It is drawn in Geist Mono as the prefix on its own line, then groups of 4 and a final group of 6 that carries a `ring-2 ring-foreground` outline. The outline and the words under the field both say which characters to type, so it does not rely on colour.
- Copy puts the whole key on the clipboard; the button reads "Copied" for two seconds. Download as a file saves `balancia-recovery-key.txt` in `age-keygen`'s own layout (`# created:`, `# public key: age1…`, then the key), so `age -d -i` works on it directly.
- Continue is enabled only when the box is ticked and the six characters typed equal the last six of the key (case-insensitive, whitespace ignored). Pasting is allowed. On six characters that do not match, the field is `aria-invalid` and the error is spoken beside it.
- The loss note ("If you lose it") appears here and nowhere else in the flow.

| Frame | Width · theme   | What it shows                                                                  |
| ----- | --------------- | ------------------------------------------------------------------------------ |
| B1    | phone · light   | Key made, nothing done yet. Continue is off and says what is missing           |
| B2    | phone · light   | Ticked, but the last 6 characters do not match. Inline error, button stays off |
| B3    | phone · light   | Ready: box ticked, characters match, Copy shows it was pressed                 |
| B4    | phone · dark    | Ready                                                                          |
| B5    | desktop · light | Ready. From lg the arrow is gone, so Cancel sits beside Continue               |

### 5.4 Step 2 of 4: choose where to back up, board C

Reuses the `SettingsGroup` label over a card, `Disclosure` for the caution, radio rows (`role="radio"` with `rovingChoice` from `src/components/ui/roving-choice.ts`), `Button`. New: `ProviderMark`, `ProviderRow` (phone) and `ProviderTile` (from `lg`).

- Three groups: "Sign in with your account", "Use your own server or storage", "Experimental".
- A provider the administrator has switched off is drawn dashed and muted, cannot be picked, and reads "Not enabled on this server" over "Ask your administrator." The words carry it; the dimming does not.
- The Experimental group opens with a disclosure ("Read this before you choose"): one sentence, then three bullets. It is a plain remark with no red and no warning triangle.

| Frame | Width · theme   | What it shows                                                                      |
| ----- | --------------- | ---------------------------------------------------------------------------------- |
| C1    | phone · light   | Google Drive picked; OneDrive switched off by the administrator; caution collapsed |
| C2    | phone · light   | iCloud Drive picked; Proton switched off; the caution opened                       |
| C3    | phone · dark    | Nothing picked yet: Continue is off                                                |
| C4    | desktop · light | Grid at 1440, caution open                                                         |

### 5.5 Step 3 of 4: connect, board D

Reuses `Input`, `PasswordInput` (the eye toggle), `Alert`, `Button`. Four shapes, following `credentialSchemas` in `src/modules/backup/providers.ts`:

- **Account providers** (D1 to D3, D12). Before: the explanation and "Connect to {provider}" (primary, with an external-link icon). Back from the provider: "Connected to {provider} as {account}", what Balancia can see, where backups go ("Balancia Backups"), and "Use a different account". Denied: a destructive `Alert` above the same card.
- **S3-compatible** (D4 to D8). A Service list first (Amazon S3, Backblaze B2, Wasabi, Cloudflare R2, Infomaniak Swiss Backup, MinIO, Other: it sets the address hint), then server address, region, bucket, access key, secret key. "More options" folds away the folder inside the bucket and path-style addressing (D8).
- **WebDAV** (D13). Server address, folder, username, password; "More options" holds the server type (Nextcloud, ownCloud, other).
- **Experimental** (D9, D10, D11). Proton Drive: username, password, an optional mailbox password and an optional authenticator secret. iCloud Drive: Apple ID, password and the verification code Apple sent. Both start with one plain sentence that Balancia keeps the password on this server. D11 is the same form, in dark and without the step strip, for "Sign in again": it is where the iCloud banner's action (G3) leads.
- **Test connection** writes a small encrypted file and answers under its button: a pass (D6), or Balancia's sentence for the failure code, the provider's own words in monospace, and what to do (D7, D13). Continue unlocks only after a pass.

| Frame | Width · theme   | What it shows                                                                                   |
| ----- | --------------- | ----------------------------------------------------------------------------------------------- |
| D1    | phone · light   | Account provider, before connecting                                                             |
| D2    | phone · light   | Back from the provider                                                                          |
| D3    | phone · light   | Back from the provider without allowing access                                                  |
| D4    | phone · light   | S3-compatible, idle: service first, the details, then More options folded away                  |
| D5    | phone · light   | Testing: fields and button are off while it runs                                                |
| D6    | phone · light   | Test passed: Continue unlocks                                                                   |
| D7    | phone · light   | Test failed: Balancia's sentence, the provider's own words, what to do                          |
| D8    | phone · light   | S3-compatible with More options open                                                            |
| D9    | phone · light   | Proton Drive (experimental): password, optional mailbox password, optional authenticator secret |
| D10   | phone · light   | iCloud Drive (experimental): Apple ID, password, the code Apple sent                            |
| D11   | phone · dark    | iCloud again, every 30 days or so. This is where “Sign in” on the banner leads                  |
| D12   | desktop · light | Account provider, connected (Dropbox)                                                           |
| D13   | desktop · light | WebDAV on a local address the administrator has not allowed                                     |

### 5.6 Step 4 of 4: what to back up, board E

Reuses `SettingsCard`, `Checkbox` rows (hairline inset to the label, as `SettingsRows` does), the `Chip` from `export-panel.tsx` (private to that file today, so it has to be extracted to `src/components/ui/chip.tsx`), `SettingsControlRow` with `Switch size="lg"`, `Button`.

- Groups: only groups the person owns, all ticked. The first five are shown, then "Show all {count} groups" (`userSettings.showAllGroups` already exists). A note under the list says why member-only groups are missing. Zero owned groups: an empty state and a disabled finish (E4).
- Schedule: Daily or Weekly, and "Backups to keep" as four chips (5, 10, 20, 30; default 10). Question 8.
- Receipts: a separate untitled card, off by default. The disclaimer is always visible beside the switch (bigger than your data and may use storage and bandwidth; encrypted the same way, sent once and never deleted by Balancia; the import screen restores expenses but not receipt files, so a receipt backup is for keeping and restoring one is manual). Turning it on adds a live estimate, "About 38 MB of receipts across 3 groups", which updates as groups are ticked; a very large figure adds one quiet line.
- "Start backing up" commits the draft and runs the first backup.

| Frame | Width · theme   | What it shows                                  |
| ----- | --------------- | ---------------------------------------------- |
| E1    | phone · light   | Default: all owned groups ticked, receipts off |
| E2    | phone · light   | Scrolled: receipts on, with the live estimate  |
| E3    | phone · light   | Scrolled: a large estimate says so             |
| E4    | phone · light   | Owns no group: nothing to choose               |
| E5    | desktop · light | Receipts on                                    |

### 5.7 Overview, healthy, board F

Route `/settings/backup`. Reuses `SettingsScreen`, `SettingsControlRow` with `Switch size="lg"`, `Disclosure` (Manage), `Button`, `Progress`, `ConfirmSheet` (from Manage). New: `DestinationCard`, `BackupHistory`, `StatusMark`.

- **Destination card**: provider mark and account; Last backup, Next backup, Schedule (stacked label over value on a phone so a long value wraps; three columns from lg); the pause switch; the one filled button.
- **Back up now**: running shows the progress bar and "6 of 14 groups" and the button goes busy; done shows a check and "Backed up just now · 14 groups · 212 KB" in place, with no toast.
- **Paused**: the switch off, a "Paused" pill by the name, Next backup reads "Paused".
- **Receipts**: with receipts on, a fourth fact says how many are up and how many to go ("88 uploaded · 140 to go"), with one line that they go up a few at a time; "All uploaded" when done (F6, F10). The backend uploads a budget per run, so a big first backup takes several.
- **Manage** (closed by default): Daily/Weekly, Backups to keep, the group tick list (four shown), the receipts switch, the key line ("Locked with key 9f3a 07c2", the eight-digit fingerprint), then three rows: Where to back up (Change), Create a new recovery key, and "Stop backing up…" in the destructive ink. Every control inside saves as it is pressed.
- **History**: the last ten runs. Each row is a time, a one-line detail and a status (icon plus word). A failed row ends in a chevron and opens to Balancia's sentence for the failure code, what to do, and the provider's own words in monospace. On a phone six rows show and "Show 4 more" opens the rest.
- **Restore from a backup** is a row below History.

| Frame | Width · theme   | What it shows                                                              |
| ----- | --------------- | -------------------------------------------------------------------------- |
| F1    | phone · light   | Healthy, idle                                                              |
| F2    | phone · light   | “Back up now” pressed: progress, button busy                               |
| F3    | phone · light   | Finished: the result stays in place, no toast                              |
| F4    | phone · light   | Paused with the switch                                                     |
| F5    | phone · dark    | Healthy, idle                                                              |
| F6    | phone · light   | Manage open, receipts still going up: every control saves as it is pressed |
| F7    | phone · light   | A failed run opened to its reason                                          |
| F8    | phone · light   | The server refused the switch: it went back to on, and the error is spoken |
| F9    | desktop · light | Healthy, idle. Hub row reads “Daily · Google Drive”                        |
| F10   | desktop · dark  | Manage open, receipts on and all uploaded                                  |

### 5.8 Overview, needs attention, board G

Reuses `Alert` (destructive when backups have stopped; default for the routine iCloud sign-in), `Button`. The banner's action sits under the text, because `AlertAction` (absolute, `pr-18`) would pinch a 362px column. The action is the screen's one filled button; "Back up now" is disabled when it cannot work (G1, G3) and stays the filled button when the connection is fine (G2). The hub row says "Needs attention" (G5).

| Frame | Width · theme              | What it shows                                                             |
| ----- | -------------------------- | ------------------------------------------------------------------------- |
| G1    | phone · light              | Access revoked                                                            |
| G2    | phone · light              | Three failures in a row (Dropbox, no space)                               |
| G3    | phone · dark               | iCloud needs a new sign-in                                                |
| G4    | phone · light              | The same failure in the notifications list                                |
| G5    | desktop · light            | Hub row says “Needs attention”; banner above the card                     |
| G6    | desktop, list only · light | The same row in the notifications list from lg up. It opens Cloud backup. |

### 5.9 The notification row

Frames G4 and G6. The same row as an activity row in `src/components/notifications/inbox-rows.tsx`: a cloud mark with a circle-alert glyph, "Your backup to Google Drive failed", the reason and "Cloud backup" under it, the age on the right. It opens `/settings/backup`. **This needs a new notification type and a way to have no group** (question 2). Strings for it belong in the existing `notifications` namespace (`notifications.backupFailed`), which is where the renderer reads them.

### 5.10 Restore, board H

Route `/settings/backup/restore`, reachable from the overview. Reuses `Chip`, `Input` (mono), `Button`, `Disclosure`. Decryption runs **in the browser** and the key is not sent anywhere; the screen says so next to the key field. "Download as JSON" saves the group's JSON; "Import into a new group" hands that group to the existing import screen (`/groups/[groupId]/import`). See question 1: today the import never creates a group.

- Source: "From my cloud" lists backups with date and size (only when a destination is connected; H2 is the connected-but-empty case), or "From a file" takes the `.age` file (`balancia-backup-20261009T033012Z.json.gz.age`).
- Key: pasted (masked, with the eye) or from a key file.
- Failures, one slot each: a wrong key sits under the key field (H6); an unreadable file, "not a Balancia backup" and "made by a newer Balancia" sit in an `Alert` above the source (H7). These are the four kinds `openBackup` raises.
- Result: "{count} groups in this backup", made when and on which instance, each group with people and entries and the two actions; "Show {count} more groups" past five.
- "Or decrypt it yourself": the one-line command (`age -d -i recovery-key.txt <file> | gunzip > backup.json`) in a copyable block, and a line saying receipt files are separate objects in the same folder and are put back by hand.

| Frame | Width · theme   | What it shows                                                                                        |
| ----- | --------------- | ---------------------------------------------------------------------------------------------------- |
| H1    | phone · light   | Pick from the connected cloud; key still empty                                                       |
| H2    | phone · light   | Connected, but nothing in the cloud yet                                                              |
| H3    | phone · light   | From a file: nothing chosen yet                                                                      |
| H4    | phone · light   | File and key given: ready to open                                                                    |
| H5    | phone · light   | Opening, in this browser                                                                             |
| H6    | phone · light   | Wrong key                                                                                            |
| H7    | phone · light   | A file that cannot be read. “Not a Balancia backup” and “made by a newer Balancia” use the same slot |
| H8    | phone · dark    | Opened: the groups inside, and the way out                                                           |
| H9    | desktop · light | Ready to open                                                                                        |
| H10   | desktop · light | Opened                                                                                               |

### 5.11 Confirm sheets, board I

`ConfirmSheet` (src/components/settings/confirm-sheet.tsx): a bottom sheet at `max-w-md` at every width, the destructive confirm drawn first and the named way out under the thumb.

- **Stop backing up** (`destructive`): says what is removed from this server (the connection and the stored access, the schedule) and what stays (every backup already in the cloud, which Balancia does not delete, and the key). Confirm "Stop backing up", cancel "Keep backing up". Use the sheet's `children` for the two lists.
- **Create a new recovery key** (default variant): New backups use the new key; backups already made need the one they were made with. Confirm "Create a new key", cancel "Keep my current key". It leads to step 1 again with the rotation wording and no step strip (I3).

| Frame | Width · theme   | What it shows                                                                       |
| ----- | --------------- | ----------------------------------------------------------------------------------- |
| I1    | phone · light   | Stop backing up                                                                     |
| I2    | phone · light   | Create a new recovery key                                                           |
| I3    | phone · light   | After “Create a new key”: step 1 again, with the rotation wording and no step strip |
| I4    | desktop · light | The same sheet from lg up stays a bottom sheet                                      |

### 5.12 Administration, board J

Two cards on the existing screen, below the telemetry cards, which are unchanged. Reuses `SettingsCard`, `SettingsControlRow`, `Switch size="lg"`, `Button variant="link"`.

- **Providers** (J1, J2). One row per provider with its state in words, read from the server's configuration: "Ready", or "Needs a client ID and secret" with a setup-guide link (an OAuth provider is offered only when both halves of its pair are set). The experimental pair says "Off" and names the variable that turns both on. There is no per-provider switch: the brief's "switch-like status" is read as a status.
- **Local network** (J1, J2). One switch, off by default, the plain sentence about what it allows and the plain warning about what turning it on means, as briefed.
- **The alternative** (J3). The backend reads `BACKUP_ALLOW_PRIVATE_ENDPOINTS` from the environment, which a screen cannot write. J3 draws the same card as a statement with the variable named. Choose between J1 and J3 (question 3).

| Frame | Width · theme   | What it shows                                                                                   |
| ----- | --------------- | ----------------------------------------------------------------------------------------------- |
| J1    | phone · light   | As briefed: provider states, then the local-network switch (off by default)                     |
| J2    | desktop · light | As briefed, right pane at 1440                                                                  |
| J3    | phone · light   | Alternative: the choice is set in the environment, so the card states it and names the variable |

### 5.13 Notes board and the French frames

Board K holds the interaction rules, the list of what was not drawn, the open questions and the places where the brief and the repository disagree. FR1 and FR2 are French stress frames (hand-written, about 40% longer; not a translation deliverable).

| Frame | Width · theme | What it shows                                                                                    |
| ----- | ------------- | ------------------------------------------------------------------------------------------------ |
| FR1   | phone · light | Step 1 in French, about 40% longer. Nothing clips; the key wraps; Continue says what is missing. |
| FR2   | phone · light | The overview in French. Labels stack over values, so a long value just wraps.                    |

## 6. New components expected

| Component                        | Used by                          | Notes                                                                                                              |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ProviderMark`                   | pickers, destination card, admin | A 36px (44px large) tile with a two-letter monogram on `wash-3`. No logos.                                         |
| `ProviderRow` and `ProviderTile` | step 2                           | Radio rows below `lg`, a three-column grid from `lg`. States: selected, unselected, disabled by the administrator. |
| `RecoveryKeyBlock`               | step 1, new key                  | Prefix line, groups of 4, outlined last group of 6, Copy, Download.                                                |
| `DestinationCard`                | overview                         | Mark, three facts, switch, run area, button, Manage disclosure.                                                    |
| `BackupHistory` and `StatusMark` | overview                         | A list of runs; the mark is icon plus word, and a failed row opens.                                                |
| `Chip`                           | step 4, Manage, Restore          | Extract from `export-panel.tsx` to `src/components/ui/chip.tsx`.                                                   |
| `BackupBanner`                   | overview                         | A thin wrapper over `Alert` with the action under the text.                                                        |

## 7. Frames, by board

Every frame is listed with its screen above. The two-pane desktop frames are 1440 wide; those whose pane is short are cropped to a 1440 by 900 window, the rest run to their natural height.

## 8. English copy deck

Namespace `cloudBackup`. ICU message syntax, as the rest of `messages/en.json`. Existing keys are reused where one already says the same thing: `userSettings.backToSettings` for the back arrow's label, `userSettings.showAllGroups`, `common.showPassword`. Provider names are product names and stay as they are in every language. The provider's own reason on a failed test (for example "403 — the key cannot write to this bucket") is shown as received and is not a message key.

#### Settings hub row

| Key                         | English                 |
| --------------------------- | ----------------------- |
| `cloudBackup.hub.label`     | Cloud backup            |
| `cloudBackup.hub.none`      | Not set up              |
| `cloudBackup.hub.summary`   | {schedule} · {provider} |
| `cloudBackup.hub.paused`    | Paused · {provider}     |
| `cloudBackup.hub.attention` | Needs attention         |

#### Screen title

| Key                 | English      |
| ------------------- | ------------ |
| `cloudBackup.title` | Cloud backup |

#### Schedule names (shared)

| Key                           | English |
| ----------------------------- | ------- |
| `cloudBackup.schedule.daily`  | Daily   |
| `cloudBackup.schedule.weekly` | Weekly  |

#### Empty state (A)

| Key                             | English                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudBackup.empty.title`       | Back up your groups to the cloud                                                                                                                                 |
| `cloudBackup.empty.body`        | Balancia saves a copy of the groups you own to a cloud service you choose, on a schedule. It is encrypted before it leaves this server, so only you can read it. |
| `cloudBackup.empty.start`       | Set up cloud backup                                                                                                                                              |
| `cloudBackup.empty.restoreLink` | Have a backup file? Restore from a backup                                                                                                                        |
| `cloudBackup.empty.noOwned`     | You don't own a group yet. Only a group's owner can back it up.                                                                                                  |
| `cloudBackup.empty.howTitle`    | How it stays private                                                                                                                                             |
| `cloudBackup.empty.lockedTitle` | Locked on this server                                                                                                                                            |
| `cloudBackup.empty.locked`      | Every backup is encrypted here before it goes anywhere.                                                                                                          |
| `cloudBackup.empty.keyTitle`    | Opened only with your recovery key                                                                                                                               |
| `cloudBackup.empty.key`         | You keep the key. This server and your cloud service never see it.                                                                                               |
| `cloudBackup.empty.storedTitle` | Stored as unreadable files                                                                                                                                       |
| `cloudBackup.empty.stored`      | Your cloud holds files that nobody can open without your key.                                                                                                    |

#### Setup chrome (B to E)

| Key                             | English                |
| ------------------------------- | ---------------------- |
| `cloudBackup.setup.title`       | Set up cloud backup    |
| `cloudBackup.setup.step`        | Step {step} of {total} |
| `cloudBackup.setup.stepKey`     | Recovery key           |
| `cloudBackup.setup.stepWhere`   | Where to back up       |
| `cloudBackup.setup.stepConnect` | Connect                |
| `cloudBackup.setup.stepWhat`    | What to back up        |
| `cloudBackup.setup.back`        | Back                   |
| `cloudBackup.setup.cancel`      | Cancel                 |
| `cloudBackup.setup.continue`    | Continue               |

#### Step 1: recovery key (B)

| Key                               | English                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudBackup.key.title`           | Create your recovery key                                                                                                                     |
| `cloudBackup.key.intro`           | This key opens your backups. It was made in this browser just now and is shown only once. Balancia does not keep it.                         |
| `cloudBackup.key.label`           | Your recovery key                                                                                                                            |
| `cloudBackup.key.copy`            | Copy                                                                                                                                         |
| `cloudBackup.key.copied`          | Copied                                                                                                                                       |
| `cloudBackup.key.download`        | Download as a file                                                                                                                           |
| `cloudBackup.key.lostTitle`       | If you lose it                                                                                                                               |
| `cloudBackup.key.lost`            | Nobody can open your backups without this key: not you, not us, not your cloud service. There is no reset, so keep it in a password manager. |
| `cloudBackup.key.checkTitle`      | Check that you have it                                                                                                                       |
| `cloudBackup.key.confirmLabel`    | Type the last 6 characters                                                                                                                   |
| `cloudBackup.key.confirmHelp`     | They are outlined in the key above.                                                                                                          |
| `cloudBackup.key.confirmMatch`    | Matches                                                                                                                                      |
| `cloudBackup.key.confirmMismatch` | That doesn't match the end of your key.                                                                                                      |
| `cloudBackup.key.saved`           | I have saved my recovery key somewhere safe                                                                                                  |
| `cloudBackup.key.todo`            | Tick the box and type the last 6 characters to continue.                                                                                     |
| `cloudBackup.key.leave`           | If you leave now, this key is thrown away and a new one is made next time.                                                                   |

#### Step 2: where to back up (C)

| Key                                | English                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `cloudBackup.where.title`          | Choose where to back up                                                               |
| `cloudBackup.where.account`        | Sign in with your account                                                             |
| `cloudBackup.where.own`            | Use your own server or storage                                                        |
| `cloudBackup.where.experimental`   | Experimental                                                                          |
| `cloudBackup.where.googleDrive`    | Google Drive                                                                          |
| `cloudBackup.where.dropbox`        | Dropbox                                                                               |
| `cloudBackup.where.oneDrive`       | Microsoft OneDrive                                                                    |
| `cloudBackup.where.oneDriveHint`   | Personal Microsoft accounts only                                                      |
| `cloudBackup.where.infomaniak`     | Infomaniak                                                                            |
| `cloudBackup.where.infomaniakHint` | kDrive or Swiss Backup                                                                |
| `cloudBackup.where.webdav`         | Nextcloud or other WebDAV                                                             |
| `cloudBackup.where.s3`             | S3-compatible                                                                         |
| `cloudBackup.where.s3Hint`         | AWS, Backblaze B2, Wasabi, Cloudflare R2, MinIO                                       |
| `cloudBackup.where.proton`         | Proton Drive                                                                          |
| `cloudBackup.where.icloud`         | iCloud Drive                                                                          |
| `cloudBackup.where.disabled`       | Not enabled on this server                                                            |
| `cloudBackup.where.disabledHelp`   | Ask your administrator.                                                               |
| `cloudBackup.where.expTitle`       | Read this before you choose                                                           |
| `cloudBackup.where.expIntro`       | These services offer no official way for an app like Balancia to back up to them.     |
| `cloudBackup.where.expUnofficial`  | They can stop working whenever the service changes something.                         |
| `cloudBackup.where.expPassword`    | Balancia has to store your account password on this server.                           |
| `cloudBackup.where.expIcloud`      | iCloud asks for a new code about every 30 days, so you will sign in again each month. |

#### Step 3: connect (D)

| Key                                                        | English                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `cloudBackup.connect.title`                                | Connect {provider}                                                                                       |
| `cloudBackup.connect.oauthIntro`                           | You will go to {provider} to allow access, then come straight back. There is nothing to type here.       |
| `cloudBackup.connect.oauthButton`                          | Connect to {provider}                                                                                    |
| `cloudBackup.connect.notYet`                               | Not connected yet                                                                                        |
| `cloudBackup.connect.connectedAs`                          | Connected to {provider} as {account}                                                                     |
| `cloudBackup.connect.scope`                                | Balancia can only see the files it creates.                                                              |
| `cloudBackup.connect.folder`                               | Backups go in a folder called Balancia Backups.                                                          |
| `cloudBackup.connect.otherAccount`                         | Use a different account                                                                                  |
| `cloudBackup.connect.deniedTitle`                          | Access wasn't allowed                                                                                    |
| `cloudBackup.connect.denied`                               | {provider} did not give Balancia access, so nothing is connected. You can try again.                     |
| `cloudBackup.connect.formIntro`                            | Balancia keeps these on this server so it can sign in for you.                                           |
| `cloudBackup.connect.address`                              | Server address                                                                                           |
| `cloudBackup.connect.folderLabel`                          | Folder                                                                                                   |
| `cloudBackup.connect.bucket`                               | Bucket                                                                                                   |
| `cloudBackup.connect.username`                             | Username                                                                                                 |
| `cloudBackup.connect.accessKey`                            | Access key                                                                                               |
| `cloudBackup.connect.password`                             | Password                                                                                                 |
| `cloudBackup.connect.secretKey`                            | Secret key                                                                                               |
| `cloudBackup.connect.show` (exists: `common.showPassword`) | Show password                                                                                            |
| `cloudBackup.connect.test`                                 | Test connection                                                                                          |
| `cloudBackup.connect.testing`                              | Testing…                                                                                                 |
| `cloudBackup.connect.testingHelp`                          | Writing a small test file.                                                                               |
| `cloudBackup.connect.testOk`                               | Connected                                                                                                |
| `cloudBackup.connect.testOkHelp`                           | Balancia wrote a small test file, found it again and deleted it.                                         |
| `cloudBackup.connect.testFail`                             | Could not connect                                                                                        |
| `cloudBackup.connect.testNeeded`                           | Test the connection to continue.                                                                         |
| `cloudBackup.connect.moreOptions`                          | More options                                                                                             |
| `cloudBackup.connect.service`                              | Service                                                                                                  |
| `cloudBackup.connect.serviceAws`                           | Amazon S3                                                                                                |
| `cloudBackup.connect.serviceBackblaze`                     | Backblaze B2                                                                                             |
| `cloudBackup.connect.serviceWasabi`                        | Wasabi                                                                                                   |
| `cloudBackup.connect.serviceCloudflare`                    | Cloudflare R2                                                                                            |
| `cloudBackup.connect.serviceInfomaniak`                    | Infomaniak Swiss Backup                                                                                  |
| `cloudBackup.connect.serviceMinio`                         | MinIO                                                                                                    |
| `cloudBackup.connect.serviceOther`                         | Other                                                                                                    |
| `cloudBackup.connect.region`                               | Region                                                                                                   |
| `cloudBackup.connect.prefix`                               | Folder in the bucket                                                                                     |
| `cloudBackup.connect.pathStyle`                            | Use path-style addresses                                                                                 |
| `cloudBackup.connect.pathStyleHelp`                        | Some self-hosted services need this.                                                                     |
| `cloudBackup.connect.vendor`                               | Server type                                                                                              |
| `cloudBackup.connect.vendorNextcloud`                      | Nextcloud                                                                                                |
| `cloudBackup.connect.vendorOwncloud`                       | ownCloud                                                                                                 |
| `cloudBackup.connect.vendorOther`                          | Other WebDAV server                                                                                      |
| `cloudBackup.connect.expNote`                              | Experimental. Balancia keeps this account's password on this server so it can sign in.                   |
| `cloudBackup.connect.appleId`                              | Apple ID                                                                                                 |
| `cloudBackup.connect.mailboxPassword`                      | Mailbox password                                                                                         |
| `cloudBackup.connect.mailboxHelp`                          | Only if your account has a separate one.                                                                 |
| `cloudBackup.connect.otpSecret`                            | Two-factor secret                                                                                        |
| `cloudBackup.connect.otpHelp`                              | The secret key behind your authenticator app, not a six-digit code. Leave it empty if two-factor is off. |
| `cloudBackup.connect.code`                                 | Verification code                                                                                        |
| `cloudBackup.connect.codeHelp`                             | Apple sent a code to your devices.                                                                       |
| `cloudBackup.connect.signinTitle`                          | Sign in to {provider} again                                                                              |
| `cloudBackup.connect.signinIntro`                          | Apple asked for a new code. Enter it and backups carry on.                                               |

#### Step 4: what to back up (E)

| Key                                                               | English                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `cloudBackup.what.title`                                          | Choose what to back up                                                                                                       |
| `cloudBackup.what.groupsTitle`                                    | Groups                                                                                                                       |
| `cloudBackup.what.groupsHelp`                                     | The groups you own. All of them are ticked.                                                                                  |
| `cloudBackup.what.members`                                        | {count, plural, one {# member} other {# members}}                                                                            |
| `cloudBackup.what.changed`                                        | changed {date}                                                                                                               |
| `cloudBackup.what.count`                                          | {count} of {total} groups                                                                                                    |
| `cloudBackup.what.ownersOnly`                                     | Groups where you are only a member are not listed. Only a group's owner can back it up.                                      |
| `cloudBackup.what.scheduleTitle`                                  | How often                                                                                                                    |
| `cloudBackup.what.keepLabel`                                      | Backups to keep                                                                                                              |
| `cloudBackup.what.keepHelp`                                       | Older backups are removed from your cloud. Receipts are never removed.                                                       |
| `cloudBackup.what.receiptsTitle`                                  | Also back up receipts                                                                                                        |
| `cloudBackup.what.receiptsOff`                                    | Off by default.                                                                                                              |
| `cloudBackup.what.receiptsBig`                                    | Receipts are bigger than your data. They can use up your cloud storage and bandwidth.                                        |
| `cloudBackup.what.receiptsEncrypted`                              | They are encrypted the same way, sent once, and never deleted by Balancia.                                                   |
| `cloudBackup.what.receiptsRestore`                                | Balancia's import restores expenses, not receipt files. A receipt backup is for keeping, and restoring one is a manual step. |
| `cloudBackup.what.estimate`                                       | About {size} of receipts across {count, plural, one {# group} other {# groups}}                                              |
| `cloudBackup.what.estimateBig`                                    | That is a lot for a free cloud plan.                                                                                         |
| `cloudBackup.what.finish`                                         | Start backing up                                                                                                             |
| `cloudBackup.what.finishHelp`                                     | The first backup runs right away.                                                                                            |
| `cloudBackup.what.showAll` (exists: `userSettings.showAllGroups`) | Show all {count} groups                                                                                                      |
| `cloudBackup.what.none`                                           | Tick at least one group to continue.                                                                                         |
| `cloudBackup.what.noOwnedTitle`                                   | No group to back up                                                                                                          |

#### Overview and history (F)

| Key                                   | English                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `cloudBackup.overview.last`           | Last backup                                                           |
| `cloudBackup.overview.next`           | Next backup                                                           |
| `cloudBackup.overview.scheduleLabel`  | Schedule                                                              |
| `cloudBackup.overview.lastValue`      | {when} · {groups} · {size}                                            |
| `cloudBackup.overview.today`          | Today, {time}                                                         |
| `cloudBackup.overview.yesterday`      | Yesterday, {time}                                                     |
| `cloudBackup.overview.justNow`        | Just now                                                              |
| `cloudBackup.overview.nextValue`      | Tomorrow, around {time}                                               |
| `cloudBackup.overview.nextPaused`     | Paused                                                                |
| `cloudBackup.overview.nextRetry`      | Trying again in about {hours} hours                                   |
| `cloudBackup.overview.receipts`       | Receipts                                                              |
| `cloudBackup.overview.receiptsValue`  | {done} uploaded · {pending} to go                                     |
| `cloudBackup.overview.receiptsHelp`   | They go up a few at a time, so a big first backup takes several runs. |
| `cloudBackup.overview.receiptsDone`   | All uploaded                                                          |
| `cloudBackup.overview.nextBlocked`    | Waiting until you reconnect                                           |
| `cloudBackup.overview.nextSignin`     | Waiting until you sign in                                             |
| `cloudBackup.overview.scheduleValue`  | {schedule} · keeps the last {count}                                   |
| `cloudBackup.overview.groups`         | {count, plural, one {# group} other {# groups}}                       |
| `cloudBackup.overview.auto`           | Automatic backups                                                     |
| `cloudBackup.overview.autoDaily`      | Runs by itself every day.                                             |
| `cloudBackup.overview.autoWeekly`     | Runs by itself every week.                                            |
| `cloudBackup.overview.autoOff`        | Paused. Nothing is backed up until you turn this on.                  |
| `cloudBackup.overview.pausedPill`     | Paused                                                                |
| `cloudBackup.overview.now`            | Back up now                                                           |
| `cloudBackup.overview.running`        | Backing up…                                                           |
| `cloudBackup.overview.runningLabel`   | Encrypting and uploading                                              |
| `cloudBackup.overview.progress`       | {done} of {total} groups                                              |
| `cloudBackup.overview.done`           | Backed up just now                                                    |
| `cloudBackup.overview.manage`         | Manage                                                                |
| `cloudBackup.overview.groupsInManage` | Groups                                                                |
| `cloudBackup.overview.keyId`          | Locked with key {id}                                                  |
| `cloudBackup.overview.changeWhere`    | Where to back up                                                      |
| `cloudBackup.overview.change`         | Change                                                                |
| `cloudBackup.overview.rotate`         | Create a new recovery key                                             |
| `cloudBackup.overview.rotateHelp`     | For backups made from now on.                                         |
| `cloudBackup.overview.remove`         | Stop backing up…                                                      |
| `cloudBackup.overview.history`        | History                                                               |
| `cloudBackup.overview.historyMore`    | Show {count} more                                                     |
| `cloudBackup.overview.statusOk`       | Backed up                                                             |
| `cloudBackup.overview.statusSkipped`  | No changes                                                            |
| `cloudBackup.overview.statusFailed`   | Failed                                                                |
| `cloudBackup.overview.skippedReason`  | Nothing changed since the last backup.                                |
| `cloudBackup.overview.restore`        | Restore from a backup                                                 |
| `cloudBackup.overview.restoreHelp`    | Open a backup file with your recovery key.                            |
| `cloudBackup.overview.refused`        | That change could not be saved.                                       |

#### Needs attention, notification (G)

| Key                                  | English                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `cloudBackup.attention.revokedTitle` | Reconnect {provider}                                                         |
| `cloudBackup.attention.revoked`      | Access was revoked, so backups have stopped.                                 |
| `cloudBackup.attention.reconnect`    | Reconnect                                                                    |
| `cloudBackup.attention.failedTitle`  | The last {count} backups failed                                              |
| `cloudBackup.attention.details`      | See details                                                                  |
| `cloudBackup.attention.signinTitle`  | Sign in to {provider} again                                                  |
| `cloudBackup.attention.signin`       | Apple asks for a new code about every 30 days. Backups carry on once you do. |
| `cloudBackup.attention.signinAction` | Sign in                                                                      |
| `cloudBackup.attention.notification` | Your backup to {provider} failed                                             |

#### Failure sentences, one per code the worker records (D, F, G)

| Key                                     | English                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `cloudBackup.error.reconnect`           | Access was revoked or has expired.                                          |
| `cloudBackup.error.reconnectHint`       | Reconnect to carry on.                                                      |
| `cloudBackup.error.signin`              | {provider} asked for a new sign-in.                                         |
| `cloudBackup.error.forbidden`           | The account is not allowed to write there.                                  |
| `cloudBackup.error.forbiddenHint`       | Check that this key may write to the bucket, then test again.               |
| `cloudBackup.error.quota`               | Not enough space in your {provider}.                                        |
| `cloudBackup.error.quotaHint`           | Free some space or choose a bigger plan, then back up again.                |
| `cloudBackup.error.notFound`            | The folder or bucket could not be found.                                    |
| `cloudBackup.error.notFoundHint`        | Check the name, then test again.                                            |
| `cloudBackup.error.unreachable`         | {provider} could not be reached.                                            |
| `cloudBackup.error.unreachableHint`     | Balancia will try again.                                                    |
| `cloudBackup.error.rateLimited`         | {provider} asked Balancia to slow down.                                     |
| `cloudBackup.error.rateLimitedHint`     | Balancia will try again.                                                    |
| `cloudBackup.error.endpointBlocked`     | This server does not allow addresses on the local network.                  |
| `cloudBackup.error.endpointBlockedHint` | Use a public address, or ask your administrator to allow the local network. |
| `cloudBackup.error.unavailable`         | Cloud backup is not installed on this server. Ask your administrator.       |
| `cloudBackup.error.noKey`               | There is no recovery key, so nothing can be encrypted.                      |
| `cloudBackup.error.unknown`             | Something went wrong.                                                       |

#### Restore (H)

| Key                                  | English                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `cloudBackup.restore.title`          | Restore from a backup                                                                                              |
| `cloudBackup.restore.intro`          | Open a backup and take out the groups you need. Nothing is imported until you choose to.                           |
| `cloudBackup.restore.sourceTitle`    | Backup                                                                                                             |
| `cloudBackup.restore.fromCloud`      | From my cloud                                                                                                      |
| `cloudBackup.restore.fromFile`       | From a file                                                                                                        |
| `cloudBackup.restore.chooseFile`     | Choose the .age file                                                                                               |
| `cloudBackup.restore.dropHint`       | or drop it here                                                                                                    |
| `cloudBackup.restore.chooseOther`    | Choose another                                                                                                     |
| `cloudBackup.restore.keyTitle`       | Recovery key                                                                                                       |
| `cloudBackup.restore.keyLabel`       | Your recovery key                                                                                                  |
| `cloudBackup.restore.keyPlaceholder` | AGE-SECRET-KEY-1…                                                                                                  |
| `cloudBackup.restore.keyFile`        | Choose a key file                                                                                                  |
| `cloudBackup.restore.privacy`        | The backup is opened in this browser. Your key stays here and is not sent anywhere.                                |
| `cloudBackup.restore.open`           | Open backup                                                                                                        |
| `cloudBackup.restore.opening`        | Opening…                                                                                                           |
| `cloudBackup.restore.wrongKey`       | That key does not open this backup.                                                                                |
| `cloudBackup.restore.foundTitle`     | {count, plural, one {# group} other {# groups}} in this backup                                                     |
| `cloudBackup.restore.foundHelp`      | Made {when} on {instance}. Nothing has been imported yet.                                                          |
| `cloudBackup.restore.unreadable`     | That file could not be read. It may not be a Balancia backup, or it was damaged on the way. Download it again.     |
| `cloudBackup.restore.notABackup`     | That file opens, but it is not a Balancia backup.                                                                  |
| `cloudBackup.restore.tooNew`         | This backup was made by a newer Balancia. Update this server to open it.                                           |
| `cloudBackup.restore.cloudEmpty`     | No backups found in {provider} yet.                                                                                |
| `cloudBackup.restore.people`         | {count, plural, one {# person} other {# people}}                                                                   |
| `cloudBackup.restore.entries`        | {count, plural, one {# entry} other {# entries}}                                                                   |
| `cloudBackup.restore.downloadJson`   | Download as JSON                                                                                                   |
| `cloudBackup.restore.importNew`      | Import into a new group                                                                                            |
| `cloudBackup.restore.showMore`       | Show {count} more groups                                                                                           |
| `cloudBackup.restore.selfTitle`      | Or decrypt it yourself                                                                                             |
| `cloudBackup.restore.selfBody`       | This works without Balancia, with the free age tool.                                                               |
| `cloudBackup.restore.selfCommand`    | age -d -i recovery-key.txt balancia-backup-20261009T033012Z.json.gz.age \| gunzip > backup.json                    |
| `cloudBackup.restore.receiptsNote`   | Receipts are separate files in the same folder. Decrypt each one the same way; putting them back is a manual step. |

#### Stop backing up sheet (I)

| Key                                 | English                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `cloudBackup.remove.title`          | Stop backing up to {provider}?                                           |
| `cloudBackup.remove.body`           | Balancia will stop backing up. Nothing already in {provider} is touched. |
| `cloudBackup.remove.goneTitle`      | Removed from this server                                                 |
| `cloudBackup.remove.goneConnection` | The connection and the access Balancia stored for it.                    |
| `cloudBackup.remove.goneSchedule`   | The schedule.                                                            |
| `cloudBackup.remove.staysTitle`     | Stays where it is                                                        |
| `cloudBackup.remove.staysFiles`     | Every backup already in {provider}. Balancia does not delete them.       |
| `cloudBackup.remove.staysKey`       | Your recovery key. It still opens them.                                  |
| `cloudBackup.remove.confirm`        | Stop backing up                                                          |
| `cloudBackup.remove.cancel`         | Keep backing up                                                          |

#### New recovery key (I)

| Key                            | English                                                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudBackup.rotate.title`     | Create a new recovery key?                                                                                                                                                        |
| `cloudBackup.rotate.body`      | New backups will be locked with the new key. Backups already made can only be opened with the key they were made with, so keep your old key for as long as you want to read them. |
| `cloudBackup.rotate.confirm`   | Create a new key                                                                                                                                                                  |
| `cloudBackup.rotate.cancel`    | Keep my current key                                                                                                                                                               |
| `cloudBackup.rotate.newTitle`  | Create a new recovery key                                                                                                                                                         |
| `cloudBackup.rotate.cardTitle` | Your new recovery key                                                                                                                                                             |
| `cloudBackup.rotate.newIntro`  | Backups from now on are locked with this key. Older backups still need your old one.                                                                                              |

#### Administration card (J)

| Key                              | English                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `cloudBackup.admin.title`        | Cloud backup providers                                                        |
| `cloudBackup.admin.help`         | Which services people on this server can back up to.                          |
| `cloudBackup.admin.accounts`     | Sign in with an account                                                       |
| `cloudBackup.admin.own`          | Own server or storage                                                         |
| `cloudBackup.admin.experimental` | Experimental                                                                  |
| `cloudBackup.admin.ready`        | Ready                                                                         |
| `cloudBackup.admin.off`          | Off                                                                           |
| `cloudBackup.admin.needsClient`  | Needs a client ID and secret                                                  |
| `cloudBackup.admin.guide`        | Setup guide                                                                   |
| `cloudBackup.admin.envHint`      | Turn on with {name}.                                                          |
| `cloudBackup.admin.lanTitle`     | Local network                                                                 |
| `cloudBackup.admin.lanLabel`     | Allow backups to servers on the local network                                 |
| `cloudBackup.admin.lanHelp`      | Lets people back up to a NAS or a Nextcloud on your own network.              |
| `cloudBackup.admin.lanWarn`      | When this is on, any user can make this server connect to internal addresses. |
| `cloudBackup.admin.lanOff`       | Off                                                                           |
| `cloudBackup.admin.lanOn`        | On                                                                            |
| `cloudBackup.admin.lanEnv`       | Set with {name}.                                                              |

## 9. What the backend already decides

Read from `docs/cloud-backup.md` and `src/modules/backup` in the working tree. The boards follow it.

- **Files.** `balancia-backup-20261009T033012Z.json.gz.age`: gzip, then age. One per run, with a `groups` array. Receipts are separate objects, `receipt-<id>.age`, each sent once. Drawn on H (file name, the one-line command).
- **Folder.** Backups go in “Balancia Backups” (D2).
- **Retention.** The newest N data backups are kept, 1 to 100, default 10, and only files with Balancia's own name are ever deleted. Receipts are never deleted. Drawn in the “Backups to keep” help text.
- **Unchanged nights.** A scheduled run that finds nothing new writes nothing and is recorded “No changes”; Back up now always writes; a fresh copy is still written at least weekly. Drawn in History.
- **Failure.** A revoked connection stops retrying until reconnected; other failures back off 1h, 2h, 4h up to a day (“Trying again in about 4 hours”, G2). Ten error codes become the ten sentences in the deck under `cloudBackup.error`, with the provider's own words in monospace beneath.
- **Receipts.** A run uploads up to a budget and the next one carries on, so the card says how many remain (F6) and when they are all up (F10).
- **Providers.** OneDrive is personal Microsoft accounts only (C2). Proton Drive and iCloud Drive are switched on together by one environment variable. The credential forms follow `credentialSchemas`: S3 has a service, region and optional folder and path-style; WebDAV a server type; Proton an optional mailbox password and authenticator secret; iCloud a code (D4 to D11).
- **Restore.** Four failure kinds: wrong key, unreadable file, not a backup, made by a newer Balancia (H6, H7). A group shows people, expenses and repayments; the backup says when it was made and on which instance (H8).
- **Not in the brief, found in the backend, not drawn.** “Use my own key” (question 5), and more than one destination per account (question 16).

## 10. Open questions, and where the brief and the repository disagree

Questions 1 to 4 are places where the brief and the repository (or the backend being built beside it) disagree, or where the brief contradicts itself. I drew a default for each and flagged it; none was chosen silently.

1. **Import into a new group.** docs/data-migration.md says the import “does not create” a group: it writes into the group you run it from. The backend doc (docs/cloud-backup.md) offers only Download as JSON, then “create a group and use Import a backup”. H8 and H10 draw “Import into a new group” as briefed. Building it needs a create-group step and a way to pass the decrypted JSON to the import screen without a second upload. Alternative: drop the button and keep the manual path.
2. **Notifications are group-scoped.** Every notification carries a group (`groupId`, `groupName`, a category switch). A backup failure belongs to the account, and the backend does not write notifications yet. Drawn as one always-on row with no switch; it needs a nullable group or an account-level kind. Cadence assumed: first failure, then the third in a row, then silence until it recovers.
3. **A switch, or an environment variable?** The brief asks for a switch for the local network. The backend reads `BACKUP_ALLOW_PRIVATE_ENDPOINTS` from the environment, with `BACKUP_EXPERIMENTAL_PROVIDERS` and the client IDs. A switch needs a stored setting, as the telemetry switches have, locked when the environment forces it. J1 and J2 draw the brief; J3 draws what exists today. Either way the provider rows are statuses read from the server's configuration.
4. **Colour of success.** Drawn neutral (check + “Backed up”); failure uses `destructive`. Data & imports already shows a finished import in `positive-ink`. AGENTS.md keeps green for “someone owes you”, so I kept it out. Say if you want the import precedent.
5. **“Use my own key”.** The backend doc lets a person paste an `age1…` public key made with `age-keygen`, so they need not trust a key generated by JavaScript this server serves. It is not in the brief and not drawn. If wanted, it is a text link under the key block on step 1.
6. **Where the public key lives, and when.** Drawn: the secret key exists only in page memory, a reload makes a new one, and the public key is saved when “Start backing up” is pressed. The backend keeps one key per account and an eight-digit fingerprint; Manage shows it (“Locked with key 9f3a 07c2”) so a person can tell keys apart after a rotation.
7. **Infomaniak needs a sub-choice.** kDrive is reached over WebDAV and Swiss Backup over S3, but the tile is one: “kDrive or Swiss Backup”. Step 3 must ask which. Swiss Backup is already a choice in the S3 form's Service list; kDrive would open the WebDAV form. Not drawn.
8. **How many backups can be kept.** The backend allows 1 to 100 (default 10). Drawn as four chips (5, 10, 20, 30) so a change is one tap and one tap back. A number field is possible.
9. **The local-network switch asks no confirmation.** Repo doctrine: a switch that can be pressed back saves in silence. Drawn with the warning in plain text under it. A confirm sheet when turning it on is the alternative.
10. **Provider marks.** Monograms only. Real logos need a look at each provider's brand rules first.
11. **First run and time of day.** “Start backing up” runs the first backup at once; later ones run a day or a week after the last good one (the backend has no time-of-day or weekday). “Around 3:30” is drawn as an example.
12. **Restore from the empty state.** A1 adds a small link so someone who only has a file can restore. The brief lists the overview only.
13. **Confirm sheets on a desk.** ConfirmSheet is bottom-anchored at `max-w-md` at every width (I4). Keep, or centre it from lg?
14. **What Proton and iCloud ask for.** Both keep the account password on this server (sealed with `AUTH_SECRET`, per the backend doc). Proton also takes the authenticator's secret rather than a code, which is a bigger ask than a password; D9 says so in one sentence. iCloud's trust lasts about 30 days (D11).
15. **An owner who stops owning a group.** The backend checks ownership again at every run, so the group simply drops out. Surface it in that night's history row?
16. **One destination per account.** Assumed from “one destination card”. The backend's table does not forbid several; more would be more cards, not a new screen.

Also: `todo/now/settings-two-panes.md`, named in the brief, does not exist. The item is `todo/done/settings-two-panes.md` (merged in #444). The two-pane frames follow `src/app/settings/layout.tsx`, which wins over the older board: the hub column is 20rem, not 300px, and the pane is 688px at 1440. And the Balancia Design System's `tokens.css` and README still draw the coral accent and the older money inks while the app paints plum by default (#437); the boards restate the app's values in their own stylesheet, as the "18 · Settings" board does.
