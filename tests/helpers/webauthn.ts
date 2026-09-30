import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { getEnv } from "@/lib/env";

/**
 * A software authenticator, for the ceremonies a fixture cannot fake.
 *
 * Everything the server checks is real here: the relying-party hash, the
 * origin and challenge in the client data, a P-256 key in COSE form, and an
 * ECDSA signature over the assertion. What the tests control is the one thing a
 * real authenticator decides for itself — whether it verified its holder — so
 * the flag the server is being asked to read can be set either way.
 *
 * Only the "none" attestation format, which is the one Balancia asks for.
 */

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

export interface SoftCredential {
  /** base64url, as the browser reports it. */
  readonly id: string;
  /** The `user.id` the registration was filed under, base64url. */
  readonly userHandle: string;
  readonly privateKey: KeyObject;
  counter: number;
}

function clientData(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      type,
      challenge,
      origin: getEnv().appOrigin,
      crossOrigin: false,
    }),
  );
}

function authenticatorData(
  flags: number,
  counter: number,
  attested: Buffer = Buffer.alloc(0),
): Buffer {
  const rpIdHash = createHash("sha256").update(getEnv().webAuthnRpId).digest();
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  return Buffer.concat([rpIdHash, Buffer.from([flags]), count, attested]);
}

/** Answers `navigator.credentials.create()` for the options given. */
export function register(
  options: PublicKeyCredentialCreationOptionsJSON,
  behaviour: { userVerified: boolean },
): { response: RegistrationResponseJSON; credential: SoftCredential } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const cosePublicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );

  const credentialId = randomBytes(16);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credentialId.length);
  const attested = Buffer.concat([
    Buffer.alloc(16), // AAGUID: all zeroes, "declines to say"
    idLength,
    credentialId,
    Buffer.from(cosePublicKey),
  ]);

  const flags =
    FLAG_USER_PRESENT |
    FLAG_ATTESTED_CREDENTIAL |
    (behaviour.userVerified ? FLAG_USER_VERIFIED : 0);
  const attestationObject = isoCBOR.encode(
    new Map<string, string | Uint8Array | Map<string, string>>([
      ["fmt", "none"],
      ["attStmt", new Map<string, string>()],
      ["authData", authenticatorData(flags, 0, attested)],
    ]),
  );

  const id = credentialId.toString("base64url");
  return {
    response: {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: clientData(
          "webauthn.create",
          options.challenge,
        ).toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    },
    credential: { id, userHandle: options.user.id, privateKey, counter: 0 },
  };
}

/** Answers `navigator.credentials.get()` for a challenge, with a signature. */
export function assert(
  credential: SoftCredential,
  challenge: string,
  behaviour: { userVerified: boolean },
): AuthenticationResponseJSON {
  credential.counter += 1;
  const flags =
    FLAG_USER_PRESENT | (behaviour.userVerified ? FLAG_USER_VERIFIED : 0);
  const authData = authenticatorData(flags, credential.counter);
  const data = clientData("webauthn.get", challenge);
  const signature = sign(
    "sha256",
    Buffer.concat([authData, createHash("sha256").update(data).digest()]),
    credential.privateKey,
  );

  return {
    id: credential.id,
    rawId: credential.id,
    type: "public-key",
    response: {
      clientDataJSON: data.toString("base64url"),
      authenticatorData: authData.toString("base64url"),
      signature: signature.toString("base64url"),
      userHandle: credential.userHandle,
    },
    clientExtensionResults: {},
  };
}
