import type { VerifiableCredential } from "@credentia/credential-core";
import type { CredentialLifecycle } from "@credentia/domain";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "./client.js";
import {
  credentialStatusHistory,
  credentialVersions,
  credentials,
  institutions,
  issuers,
  verificationRecords,
} from "./schema.js";

export interface PersistedCredential {
  credential: VerifiableCredential;
  lifecycle: CredentialLifecycle;
  reason?: string;
  supersededByCredentialId?: string;
  verificationUrl?: string;
  qrCodeDataUrl?: string;
}
const toStored = (
  row: typeof credentials.$inferSelect,
): PersistedCredential => ({
  credential: row.credentialDocument as VerifiableCredential,
  lifecycle: row.lifecycle,
  reason: row.reason ?? undefined,
  supersededByCredentialId: row.supersededByCredentialId ?? undefined,
  verificationUrl: row.verificationUrl ?? undefined,
  qrCodeDataUrl: row.qrCodeDataUrl ?? undefined,
});
export class PostgresCredentialStore {
  constructor(private readonly db: DatabaseClient) {}
  async save(record: PersistedCredential) {
    const credential = record.credential as {
      id: string;
      issuer: string;
      credentialSubject: { id: string };
      type: string[];
      validFrom: string;
      credentialStatus: {
        statusListIndex: string;
        statusListCredential: string;
      };
      credentialVersion?: number;
      supersedesCredentialId?: string;
    };
    const issuer = await this.ensureIssuer(credential.issuer);
    await this.db.transaction(async (tx) => {
      await tx
        .insert(credentials)
        .values({
          credentialId: credential.id,
          institutionId: issuer.institutionId,
          issuerId: issuer.id,
          credentialDocument: credential,
          subjectReference: credential.credentialSubject.id,
          credentialType: credential.type.at(-1) ?? "AcademicCredential",
          issuedAt: new Date(credential.validFrom),
          statusIndex: Number(credential.credentialStatus.statusListIndex),
          statusListId: credential.credentialStatus.statusListCredential,
          lifecycle: record.lifecycle,
          reason: record.reason,
          supersededByCredentialId: record.supersededByCredentialId,
          verificationUrl: record.verificationUrl,
          qrCodeDataUrl: record.qrCodeDataUrl,
        })
        .onConflictDoUpdate({
          target: credentials.credentialId,
          set: {
            credentialDocument: credential,
            lifecycle: record.lifecycle,
            reason: record.reason,
            supersededByCredentialId: record.supersededByCredentialId,
            verificationUrl: record.verificationUrl,
            qrCodeDataUrl: record.qrCodeDataUrl,
          },
        });
      await tx
        .insert(credentialVersions)
        .values({
          credentialId: credential.id,
          version: credential.credentialVersion ?? 1,
          supersedesCredentialId: credential.supersedesCredentialId,
          supersededByCredentialId: record.supersededByCredentialId,
        })
        .onConflictDoNothing();
      await tx.insert(credentialStatusHistory).values({
        credentialId: credential.id,
        status: record.lifecycle,
        reason: record.reason,
      });
    });
    return record;
  }
  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, id))
      .limit(1);
    return row ? toStored(row) : undefined;
  }
  async update(id: string, changes: Partial<PersistedCredential>) {
    const current = await this.findById(id);
    if (!current) throw new Error("Credential not found");
    return this.save({
      ...current,
      ...changes,
      credential: changes.credential ?? current.credential,
    });
  }
  async count() {
    return (await this.db.select({ id: credentials.id }).from(credentials))
      .length;
  }
  async listVersions(id: string) {
    const current = await this.findById(id);
    if (!current) return [];
    const document = current.credential as {
      id: string;
      supersedesCredentialId?: string;
    };
    const root = document.supersedesCredentialId ?? document.id;
    const rows = await this.db.select().from(credentials);
    return rows.map(toStored).filter((row) => {
      const candidate = row.credential as {
        id: string;
        supersedesCredentialId?: string;
      };
      return (
        candidate.id === root ||
        candidate.id === id ||
        candidate.supersedesCredentialId === root ||
        candidate.supersedesCredentialId === id
      );
    });
  }
  async recordVerification(
    credentialId: string,
    trusted: boolean,
    evidence: unknown,
  ) {
    await this.db
      .insert(verificationRecords)
      .values({ credentialId, trusted, evidence });
  }
  private async ensureIssuer(did: string) {
    const [existing] = await this.db
      .select()
      .from(issuers)
      .where(eq(issuers.did, did))
      .limit(1);
    if (existing) return existing;
    const [institution] = await this.db
      .insert(institutions)
      .values({
        externalId: did,
        legalName: did,
        country: "XX",
        did,
        issuerAddress: "0x0000000000000000000000000000000000000000",
      })
      .onConflictDoUpdate({
        target: institutions.did,
        set: { updatedAt: new Date() },
      })
      .returning();
    const [issuer] = await this.db
      .insert(issuers)
      .values({
        externalId: did,
        institutionId: institution.id,
        did,
        authorizedCredentialTypes: ["AcademicCredential"],
      })
      .returning();
    return issuer;
  }
}
