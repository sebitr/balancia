# Settling up

Balancia never moves money. It works out who owes whom, and then tries to make
handing the money over as close to one tap as the payee's own payment scheme
allows.

This document is about that last part: what the settle-up screen can offer for
each way of being paid, why the list is shorter than the method catalogue, and
which standards are implemented.

## Three ways to hand somebody a payment

A payment scheme will accept an instruction in one of three shapes, and which
ones it accepts is entirely the scheme's business.

| Transport         | What it is                                       | Who can build one                                                            |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| **A link**        | A URL that opens the payment app on the payment  | Only where the provider publishes a format a third party can construct       |
| **A code**        | A QR payload the payer's app scans               | Wherever the scheme's own standard can be assembled from a stored detail     |
| **A copied text** | The same payload, pasted instead of photographed | Wherever the payload is a single readable line — Pix, SPAYD, the Polish code |

The screen offers whichever of the three a method can honestly support, and
copying the raw detail — an IBAN, a handle — wherever it can support none.

The rule everything here follows: **an instruction that cannot be built
correctly is not built at all.** A button that resolves to nothing, or a code
carrying a figure in the wrong currency, is worse than the absence of either.

## Payment codes

Six standards, chosen by what is being paid into rather than by preference. A
Swiss banking app reads the QR-bill and not the Girocode; a Czech one reads
SPAYD; a Brazilian one reads a BR Code.

| Standard              | Built for                     | Carries      | Source                                          |
| --------------------- | ----------------------------- | ------------ | ----------------------------------------------- |
| **Swiss QR-bill**     | A `CH`/`LI` account           | CHF, EUR     | Swiss Implementation Guidelines QR-bill         |
| **EPC QR (Girocode)** | Any other SEPA account        | **EUR only** | EPC069-12 v3.1                                  |
| **SPAYD**             | A `CZ` account paid in koruny | CZK          | Short Payment Descriptor v1.0                   |
| **ZBP 2D code**       | A `PL` account paid in złoty  | PLN          | Związek Banków Polskich recommendation          |
| **Pix BR Code**       | A Pix key                     | BRL          | BCB _Manual de Padrões para Iniciação do Pix_   |
| **Swish**             | A Swedish mobile number       | SEK          | Guide Swish QR code design specification v1.7.2 |

### Why there are four besides the two SEPA ones

EPC069-12 defines its amount element as euros. That single line left every
non-euro country inside SEPA with a bank transfer and no code — Poland,
Czechia, Sweden, Denmark, Hungary, Romania — however ordinary the payment. The
national standards are not completeness for its own sake; they are the only way
those payments get a code at all.

Pix and Swish close a second gap. Both were already offered as ways to be paid
and produced nothing but a string to retype, because the feature had been built
around links and neither scheme publishes one a payer can construct. Both
publish something better: Pix a BR Code, Swish four semicolon-separated fields.

The EMV® QRCPS-MPM container that Pix is built on lives in `qr/emvco.ts`
separately from Pix itself, because PayNow, PromptPay, DuitNow, QRIS and QR Ph
are the same encoding with a different domestic template. Adding one of those
is a template, not an encoder.

### The currency rule

Several of these standards settle in exactly one currency and carry no rate:
Pix is reais, Swish is kronor, the Girocode is euros, the Polish code is grosz
by definition. A code carrying `84.20` for a debt in another currency would be
correct to two decimal places and wrong by a third — the single worst thing
this feature could do. **A debt the standard cannot express gets no code**, and
the screen says which currency was the problem.

A valueless code is deliberately not offered as a consolation. The detail is
already on screen and copyable, so a code without the amount adds nothing the
row did not already have.

## Payment links

Only providers that publish a link a third party can construct, from a detail
this application already stores, checked against the provider's own
documentation.

| Provider     | Link                               | Amount                    |
| ------------ | ---------------------------------- | ------------------------- |
| **PayPal**   | `paypal.me/<user>/<amount><CUR>`   | Yes, in any currency      |
| **Venmo**    | `venmo.com/<user>?txn=pay&amount=` | Only when the debt is USD |
| **Cash App** | `cash.app/$<tag>/<amount>`         | Only when the debt is USD |
| **UPI**      | `upi://pay?pa=&pn=&am=&cu=&tn=`    | Only when the debt is INR |
| **Revolut**  | `revolut.me/<revtag>`              | No                        |
| **Monzo**    | `monzo.me/<user>`                  | No                        |
| **Wise**     | `wise.com/pay/me/<wisetag>`        | No — see below            |

Wise documents `?amount=`, `?currency=` and `?description=` on the **business**
open link and says nothing about the personal one. None is written, because an
unverified parameter that silently did nothing would make the screen's "the
amount is already filled in" a lie. Anyone who confirms the personal link
honours them should add them and flip `carriesAmount`.

The Wise field asks for a **Wisetag**, not the email on the account. Details
saved before that change are left alone — an email is still a true answer to
"how do I pay you on Wise" — and the link builder declines to construct
anything from one rather than producing a `wise.com/pay/me/lea@example.com`
that 404s.

### A link a desktop cannot follow

`upi://` resolves to nothing in a desktop browser, so that button waits for a
browser that could plausibly have the app. But the payer is very often at a
laptop with their phone in their hand, so the same string is offered as a QR
code instead: point the camera at the screen and the payment app opens on the
device that has it.

Only where the method has no scheme code of its own. Where it does, that code
is the better artefact — it is what the payer's bank designed its scanner
around — and two codes on one row is a choice nobody should have to make.

## What is deliberately absent

Not oversights. Each of these is a scheme whose payment instruction cannot be
constructed by anybody except the payee or a registered merchant.

- **Merchant-only.** TWINT paylinks resolve a registered acquirer code, and a
  Swish _Handel_ deep link carries a token minted by a server-side Merchant API
  call. Neither can be built from what a person has. (Swish's person-to-person
  code, which is a different artefact entirely, is supported.)
- **Payee-generated.** Lydia money pots, Vipps and MobilePay payment links,
  Satispay and Payconiq all mint a link or a code at the receiving end.
- **Bank-mediated or code-based.** Zelle, Bizum, BLIK, PayID and Interac happen
  inside the payer's own banking app or through a typed code.

## Privacy

A payout detail is reachable only by someone the group's own balances say owes
that person money. There is no endpoint that answers "show me their IBAN" — the
permission is structural rather than checked, and adding such an endpoint would
be the mistake. Codes are built on the server because only the server holds the
creditor's address; the payload never contains anything the payer was not
already entitled to see.

## Verification status

Every payload in `src/modules/payouts/qr` is asserted against its
specification, and the ones with a parseable structure are read back by a
parser written from the specification rather than from the builder — the BR
Code walk in `pix.test.ts` is the clearest example. The CRC is anchored to the
published CRC-16/CCITT-FALSE check value, not to our own output.

**No code produced by this directory has been scanned by a real banking app.**
A passing test is not a bank accepting a payment. Two specific values are worth
a real-device check before anybody relies on them:

- the **Swish** amount, written as a plain decimal with a dot; the
  specification's examples show that form, but the field's tolerance for öre
  has not been confirmed against the app;
- the **Polish** code's six-digit grosz field, which stops at 9 999,99 zł — a
  larger debt is refused rather than truncated, and that ceiling has not been
  checked against a bank that reads more digits.
