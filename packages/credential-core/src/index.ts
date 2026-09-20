import {
  type KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import {
  type CredentialLifecycle,
  type StatusListService,
  transitionCredential,
} from "@credentia/domain";

export type CredentialStatus = CredentialLifecycle;
export function deterministicIssuerKeyPair(issuer: string) {
  const seed = createHash("sha256").update(`credentia-demo:${issuer}`).digest();
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const privateKey = createPrivateKey({
    key: der,
    format: "der",
    type: "pkcs8",
  });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}
export interface AcademicSubject {
  id: string;
  givenName?: string;
  degree: string;
  graduationDate: string;
}
export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: AcademicSubject;
  credentialStatus: {
    id: string;
    type: "BitstringStatusListEntry";
    statusPurpose: "revocation";
    statusListIndex: string;
    statusListCredential: string;
  };
  credentialVersion?: number;
  supersedesCredentialId?: string;
  supersededByCredentialId?: string;
  proof?: {
    type: "DataIntegrityProof";
    cryptosuite: "eddsa-jcs-2022";
    created: string;
    verificationMethod: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
}
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};
const unsigned = (credential: VerifiableCredential) => {
  const { proof: _proof, ...data } = credential;
  return data;
};
export function issueCredential(input: {
  id: string;
  issuer: string;
  subject: AcademicSubject;
  statusIndex: number;
  statusListId: string;
  validFrom?: string;
  credentialVersion?: number;
  supersedesCredentialId?: string;
}): VerifiableCredential {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: input.id,
    type: ["VerifiableCredential", "AcademicCredential"],
    issuer: input.issuer,
    validFrom: input.validFrom ?? new Date().toISOString(),
    credentialSubject: input.subject,
    credentialVersion: input.credentialVersion ?? 1,
    ...(input.supersedesCredentialId
      ? { supersedesCredentialId: input.supersedesCredentialId }
      : {}),
    credentialStatus: {
      id: `${input.statusListId}#${input.statusIndex}`,
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: String(input.statusIndex),
      statusListCredential: input.statusListId,
    },
  };
}
export function signCredential(
  credential: VerifiableCredential,
  privateKey: string | Buffer | KeyObject,
  verificationMethod: string,
): VerifiableCredential {
  const proofValue = sign(
    null,
    Buffer.from(canonical(unsigned(credential))),
    privateKey,
  ).toString("base64url");
  return {
    ...credential,
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-jcs-2022",
      created: new Date().toISOString(),
      verificationMethod,
      proofPurpose: "assertionMethod",
      proofValue,
    },
  };
}
export function verifyCredential(
  credential: VerifiableCredential,
  publicKey: string | Buffer | KeyObject,
): boolean {
  if (!isVerifiableCredential(credential) || !credential.proof) return false;
  try {
    return verify(
      null,
      Buffer.from(canonical(unsigned(credential))),
      publicKey,
      Buffer.from(credential.proof.proofValue, "base64url"),
    );
  } catch {
    return false;
  }
}
export function isVerifiableCredential(
  value: unknown,
): value is VerifiableCredential {
  if (!value || typeof value !== "object") return false;
  const credential = value as Partial<VerifiableCredential>;
  const proof = credential.proof;
  return (
    Array.isArray(credential["@context"]) &&
    Array.isArray(credential.type) &&
    typeof credential.id === "string" &&
    typeof credential.issuer === "string" &&
    typeof credential.validFrom === "string" &&
    Boolean(
      credential.credentialSubject?.id &&
        credential.credentialSubject.degree &&
        credential.credentialSubject.graduationDate,
    ) &&
    Boolean(
      credential.credentialStatus?.statusListIndex &&
        credential.credentialStatus.statusListCredential,
    ) &&
    (!proof ||
      (proof.type === "DataIntegrityProof" &&
        proof.cryptosuite === "eddsa-jcs-2022" &&
        proof.proofPurpose === "assertionMethod" &&
        typeof proof.created === "string" &&
        typeof proof.verificationMethod === "string" &&
        typeof proof.proofValue === "string" &&
        proof.proofValue.length > 0))
  );
}
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const nextMerkleLevel = (level: string[]): string[] => {
  const padded =
    level.length % 2 === 0
      ? level
      : [...level, level[level.length - 1] ?? hash("")];
  const next: string[] = [];
  for (let index = 0; index < padded.length; index += 2) {
    next.push(hash(`${padded[index]}${padded[index + 1]}`));
  }
  return next;
};
export interface MerkleProof {
  leaf: string;
  siblings: { hash: string; left: boolean }[];
}
export function createMerkleRoot(values: string[]): string {
  if (!values.length) return hash("");
  let level = values.map(hash);
  while (level.length > 1) {
    level = nextMerkleLevel(level);
  }
  return level[0];
}
export function createMerkleProof(
  values: string[],
  value: string,
): MerkleProof {
  let index = values.indexOf(value);
  if (index < 0) throw new Error("Value is not in batch");
  let level = values.map(hash);
  const siblings: MerkleProof["siblings"] = [];
  while (level.length > 1) {
    if (level.length % 2)
      level = [...level, level[level.length - 1] ?? hash("")];
    const siblingIndex = index ^ 1;
    siblings.push({ hash: level[siblingIndex], left: siblingIndex < index });
    level = nextMerkleLevel(level);
    index = Math.floor(index / 2);
  }
  return { leaf: hash(value), siblings };
}
export function verifyMerkleProof(proof: MerkleProof, root: string): boolean {
  return (
    proof.siblings.reduce(
      (current, sibling) =>
        hash(sibling.left ? sibling.hash + current : current + sibling.hash),
      proof.leaf,
    ) === root
  );
}
export function createStatusList(size = 16384): CredentialStatus[] {
  return Array.from({ length: size }, () => "active");
}
export function checkCredentialStatus(
  list: CredentialStatus[],
  index: number,
): CredentialStatus {
  return list[index] ?? "revoked";
}
export class InMemoryStatusListService implements StatusListService {
  constructor(
    private readonly list: CredentialLifecycle[] = createStatusList(),
  ) {}
  async getStatus(index: number) {
    return checkCredentialStatus(this.list, index);
  }
  async setStatus(index: number, status: CredentialLifecycle) {
    const current = await this.getStatus(index);
    this.list[index] = transitionCredential(current, status);
  }
}
export function supersedeCredential(
  previous: VerifiableCredential,
  replacementId: string,
): VerifiableCredential {
  return { ...previous, supersededByCredentialId: replacementId };
}
export interface SelectiveDisclosureProvider {
  proveSelectedClaims(
    credential: VerifiableCredential,
    claims: string[],
  ): Promise<unknown>;
  verifyDerivedProof(proof: unknown): Promise<boolean>;
}
