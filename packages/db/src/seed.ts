/* biome-ignore-all lint/suspicious/noExplicitAny: synthetic fixture fields are intentionally schema-flexible at the import boundary. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDatabase, type DatabaseClient } from "./client.js";
import {
  accreditations,
  auditEvents,
  credentialStatusHistory,
  credentialVersions,
  credentials,
  institutions,
  issuers,
  students,
  verificationRecords,
} from "./schema.js";

type Dataset = {
  institutions: Array<Record<string, any>>;
  accreditation_records: Array<Record<string, any>>;
  issuers: Array<Record<string, any>>;
  students: Array<Record<string, any>>;
  credentials: Array<Record<string, any>>;
  credential_versions: Array<Record<string, any>>;
  credential_status_history: Array<Record<string, any>>;
  verification_records: Array<Record<string, any>>;
  audit_logs: Array<Record<string, any>>;
};
const dataPath = fileURLToPath(
  new URL("../seed/data/synthetic_academic_data.json", import.meta.url),
);
const status = (value: string) =>
  (({
    ACTIVE: "active",
    REVOKED: "revoked",
    SUSPENDED: "suspended",
    EXPIRED: "expired",
    SUPERSEDED: "superseded",
  })[value] ?? "active") as any;
export async function seedSyntheticData(db: DatabaseClient, dataset: Dataset) {
  await db.transaction(async (tx) => {
    const institutionIds = new Map<string, string>();
    for (const row of dataset.institutions) {
      const [item] = await tx
        .insert(institutions)
        .values({
          businessId: row.institution_id,
          externalId: row.institution_id,
          legalName: row.name,
          country: row.country,
          did: `did:web:${String(row.code).toLowerCase()}.edu.in`,
          issuerAddress: "0x0000000000000000000000000000000000000000",
          accreditationStatus:
            row.accreditation_status === "ACCREDITED" ? "approved" : "pending",
          accreditationValidUntil: row.accreditation_valid_until
            ? new Date(row.accreditation_valid_until)
            : null,
        })
        .onConflictDoUpdate({
          target: institutions.businessId,
          set: { legalName: row.name },
        })
        .returning();
      institutionIds.set(row.institution_id, item.id);
    }
    for (const row of dataset.students)
      await tx
        .insert(students)
        .values({
          externalId: row.student_id,
          institutionId: institutionIds.get(row.institution_id)!,
          fullName: row.name,
          email: row.email,
        })
        .onConflictDoUpdate({
          target: students.externalId,
          set: { fullName: row.name, email: row.email },
        });
    const issuerIds = new Map<string, string>();
    for (const row of dataset.issuers) {
      const [item] = await tx
        .insert(issuers)
        .values({
          businessId: row.issuer_id,
          externalId: row.issuer_id,
          institutionId: institutionIds.get(row.institution_id)!,
          did: row.did,
          authorizedCredentialTypes: ["AcademicCredential"],
          active: row.key_status !== "REVOKED",
        })
        .onConflictDoUpdate({
          target: issuers.businessId,
          set: { active: row.key_status !== "REVOKED" },
        })
        .returning();
      issuerIds.set(row.issuer_id, item.id);
    }
    for (const row of dataset.accreditation_records)
      await tx.insert(accreditations).values({
        businessId: row.accreditation_id,
        institutionId: institutionIds.get(row.institution_id)!,
        status:
          row.status === "ACTIVE"
            ? "approved"
            : row.status === "EXPIRED"
              ? "revoked"
              : "pending",
        validFrom: row.valid_from ? new Date(row.valid_from) : null,
        validUntil: row.valid_until ? new Date(row.valid_until) : null,
        sourceReference: row.reference_id,
      }).onConflictDoNothing();
    for (const row of dataset.credentials) {
      const lifecycle = status(row.current_status);
      const student = dataset.students.find(
        (s) => s.student_id === row.student_id,
      );
      const doc = {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        id: row.credential_id,
        type: ["VerifiableCredential", "AcademicCredential"],
        issuer:
          dataset.issuers.find((i) => i.issuer_id === row.issuer_id)?.did ??
          "unknown",
        validFrom: new Date(row.issue_date).toISOString(),
        credentialSubject: {
          id: row.student_id,
          givenName: student?.name,
          degree: row.degree,
          graduationDate: `${row.graduation_year}-06-30`,
        },
        credentialVersion: row.current_version,
        credentialStatus: {
          id: `urn:status:${row.credential_id}`,
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: "0",
          statusListCredential: `urn:status:${row.credential_id}`,
        },
      };
      await tx
        .insert(credentials)
        .values({
          credentialId: row.credential_id,
          institutionId: institutionIds.get(row.institution_id)!,
          issuerId: issuerIds.get(row.issuer_id)!,
          credentialDocument: doc,
          subjectReference: row.student_id,
          credentialType: "AcademicCredential",
          issuedAt: new Date(row.issue_date),
          statusIndex: 0,
          statusListId: `urn:status:${row.credential_id}`,
          lifecycle,
        })
        .onConflictDoUpdate({
          target: credentials.credentialId,
          set: { credentialDocument: doc, lifecycle },
        });
    }
    for (const row of dataset.credential_versions)
      await tx
        .insert(credentialVersions)
        .values({
          credentialId: row.credential_id,
          version: row.version,
          supersedesCredentialId: row.supersedes_version
            ? row.credential_id
            : undefined,
        })
        .onConflictDoNothing();
    for (const row of dataset.credential_status_history)
      await tx.insert(credentialStatusHistory).values({
        businessId: row.history_id,
        credentialId: row.credential_id,
        status: status(row.status),
        reason: row.reason,
        changedAt: new Date(row.changed_at),
      }).onConflictDoNothing();
    for (const row of dataset.verification_records)
      await tx.insert(verificationRecords).values({
        businessId: row.verification_id,
        credentialId: row.credential_id,
        trusted: row.result === "VERIFIED",
        evidence: row,
      }).onConflictDoNothing();
    for (const row of dataset.audit_logs)
      await tx.insert(auditEvents).values({
        businessId: row.audit_id,
        eventType: row.action,
        entityId: row.entity_id,
        metadata: row.metadata ?? {},
        createdAt: new Date(row.timestamp),
      }).onConflictDoNothing();
  });
}
export async function runSyntheticSeed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  try {
    const dataset = JSON.parse(await readFile(dataPath, "utf8")) as Dataset;
    await seedSyntheticData(database.db, dataset);
  } finally {
    await database.close();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await runSyntheticSeed();
