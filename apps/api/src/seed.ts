import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgresCredentialStore,
  accreditations,
  auditEvents,
  createDatabase,
  credentialStatusHistory,
  credentialVersions,
  credentials,
  institutions,
  issuerKeys,
  issuers,
  verificationRecords,
} from "../../../packages/db/dist/index.js";
import { buildApp } from "./app.js";
import { credentialFixtureInputs } from "./modules/credentials/fixtures.js";

const database = process.env.DATABASE_URL
  ? createDatabase(process.env.DATABASE_URL)
  : undefined;

async function seedSyntheticAcademicData(db: NonNullable<typeof database>["db"]) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dataFilePath = resolve(
    __dirname,
    "../../../packages/db/seed/data/synthetic_academic_data.json",
  );
  const raw = readFileSync(dataFilePath, "utf8");
  const data = JSON.parse(raw);

  const mapAccreditationStatus = (status: string): "approved" | "pending" | "revoked" => {
    switch (status.toUpperCase()) {
      case "ACCREDITED":
      case "ACTIVE":
        return "approved";
      case "PENDING":
        return "pending";
      case "SUSPENDED":
      case "EXPIRED":
      case "REVOKED":
      default:
        return "revoked";
    }
  };

  const mapIssuerKeyStatus = (status: string): "active" | "retired" | "revoked" | "compromised" => {
    switch (status.toUpperCase()) {
      case "ACTIVE":
        return "active";
      case "ROTATED":
        return "retired";
      case "REVOKED":
        return "revoked";
      case "COMPROMISED":
        return "compromised";
      default:
        return "active";
    }
  };

  const mapCredentialLifecycle = (status: string): "active" | "suspended" | "revoked" | "expired" | "superseded" => {
    const s = status.toLowerCase();
    if (s === "active" || s === "suspended" || s === "revoked" || s === "expired" || s === "superseded") {
      return s;
    }
    return "active";
  };

  const accValidFromMap = new Map<string, Date>();
  for (const acc of data.accreditation_records) {
    if (acc.valid_from && !accValidFromMap.has(acc.institution_id)) {
      accValidFromMap.set(acc.institution_id, new Date(acc.valid_from + "T00:00:00Z"));
    }
  }

  const studentMap = new Map<string, { student_id: string; name: string; email: string; institution_id: string }>();
  for (const stu of data.students) {
    studentMap.set(stu.student_id, stu);
  }

  const instIdMap = new Map<string, string>();
  const issuerIdMap = new Map<string, string>();
  const issuerDidMap = new Map<string, string>();

  // 1. Seed Institutions
  const existingInsts = await db
    .select({ id: institutions.id, businessId: institutions.businessId })
    .from(institutions);
  for (const inst of existingInsts) {
    if (inst.businessId) instIdMap.set(inst.businessId, inst.id);
  }

  const instValues = data.institutions.map((inst: any, idx: number) => ({
    businessId: inst.institution_id,
    legalName: inst.name,
    code: inst.code,
    type: inst.type,
    country: inst.country,
    state: inst.state,
    did: `did:web:${inst.code.toLowerCase()}.edu.in`,
    issuerAddress: `0x${(idx + 1).toString(16).padStart(40, "0")}`,
    accreditationStatus: mapAccreditationStatus(inst.accreditation_status),
    accreditationValidFrom: accValidFromMap.get(inst.institution_id) ?? new Date("2020-01-01T00:00:00Z"),
    accreditationValidUntil: inst.accreditation_valid_until ? new Date(inst.accreditation_valid_until + "T00:00:00Z") : null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-01T00:00:00Z"),
  }));

  const insertedInsts = await db
    .insert(institutions)
    .values(instValues)
    .onConflictDoNothing()
    .returning({ id: institutions.id, businessId: institutions.businessId });
  for (const inst of insertedInsts) {
    if (inst.businessId) instIdMap.set(inst.businessId, inst.id);
  }

  // 2. Seed Accreditations
  const accValues = data.accreditation_records.map((acc: any) => {
    const instId = instIdMap.get(acc.institution_id);
    if (!instId) throw new Error(`Missing institution UUID for accreditation: ${acc.institution_id}`);
    return {
      businessId: acc.accreditation_id,
      institutionId: instId,
      authorityName: acc.authority_name,
      accreditationType: acc.accreditation_type,
      status: mapAccreditationStatus(acc.status),
      validFrom: acc.valid_from ? new Date(acc.valid_from + "T00:00:00Z") : null,
      validUntil: acc.valid_until ? new Date(acc.valid_until + "T00:00:00Z") : null,
      sourceReference: JSON.stringify({ originalStatus: acc.status }),
      referenceId: acc.reference_id,
      createdAt: new Date("2020-01-01T00:00:00Z"),
    };
  });
  if (accValues.length > 0) {
    await db.insert(accreditations).values(accValues).onConflictDoNothing();
  }

  // 3. Seed Issuers
  const existingIssuers = await db
    .select({ id: issuers.id, businessId: issuers.businessId, did: issuers.did })
    .from(issuers);
  for (const iss of existingIssuers) {
    if (iss.businessId) {
      issuerIdMap.set(iss.businessId, iss.id);
      issuerDidMap.set(iss.businessId, iss.did);
    }
  }

  const issuerValues = data.issuers.map((iss: any) => {
    const instId = instIdMap.get(iss.institution_id);
    if (!instId) throw new Error(`Missing institution UUID for issuer: ${iss.institution_id}`);
    issuerDidMap.set(iss.issuer_id, iss.did);
    return {
      businessId: iss.issuer_id,
      institutionId: instId,
      name: iss.name,
      role: iss.role,
      did: iss.did,
      authorizedCredentialTypes: ["AcademicCredential"],
      active: true,
      createdAt: new Date("2020-01-01T00:00:00Z"),
    };
  });

  const insertedIssuers = await db
    .insert(issuers)
    .values(issuerValues)
    .onConflictDoNothing()
    .returning({ id: issuers.id, businessId: issuers.businessId, did: issuers.did });
  for (const iss of insertedIssuers) {
    if (iss.businessId) {
      issuerIdMap.set(iss.businessId, iss.id);
      issuerDidMap.set(iss.businessId, iss.did);
    }
  }

  // 4. Seed Issuer Keys
  const keyValues = data.issuers.map((iss: any) => {
    const issuerUuid = issuerIdMap.get(iss.issuer_id);
    if (!issuerUuid) throw new Error(`Missing issuer UUID for key: ${iss.issuer_id}`);
    const keyStatus = mapIssuerKeyStatus(iss.key_status);
    return {
      issuerId: issuerUuid,
      verificationMethod: `${iss.did}#${iss.key_version}`,
      publicKey: `synthetic:ed25519:${iss.issuer_id}:${iss.key_version}`,
      keyVersion: iss.key_version,
      status: keyStatus,
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validUntil: new Date("2030-01-01T00:00:00Z"),
      revokedAt: keyStatus === "revoked" ? new Date("2023-01-01T00:00:00Z") : null,
    };
  });
  if (keyValues.length > 0) {
    await db.insert(issuerKeys).values(keyValues).onConflictDoNothing();
  }

  // 5. Seed Credentials (with students embedded)
  const credentialValues = data.credentials.map((cred: any) => {
    const instId = instIdMap.get(cred.institution_id);
    const issId = issuerIdMap.get(cred.issuer_id);
    if (!instId) throw new Error(`Missing institution UUID for credential: ${cred.institution_id}`);
    if (!issId) throw new Error(`Missing issuer UUID for credential: ${cred.issuer_id}`);
    const student = studentMap.get(cred.student_id);
    const numericIndex = parseInt(cred.credential_id.replace(/\D/g, ""), 10) || 1;

    const credentialDoc = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://credentia.local/contexts/academic-v1.json",
      ],
      id: cred.credential_id,
      type: ["VerifiableCredential", "AcademicCredential"],
      issuer: issuerDidMap.get(cred.issuer_id) ?? cred.issuer_id,
      issuanceDate: cred.issue_date,
      credentialSubject: {
        id: student ? student.student_id : cred.student_id,
        name: student ? student.name : "Unknown Student",
        email: student ? student.email : "",
        degree: cred.degree,
        fieldOfStudy: cred.field_of_study,
        graduationYear: cred.graduation_year,
      },
    };

    return {
      credentialId: cred.credential_id,
      institutionId: instId,
      issuerId: issId,
      credentialDocument: credentialDoc,
      subjectReference: cred.student_id,
      credentialType: "AcademicCredential",
      issuedAt: new Date(cred.issue_date + "T00:00:00Z"),
      statusIndex: numericIndex,
      statusListId: "https://credentia.local/status/academic-2024",
      lifecycle: mapCredentialLifecycle(cred.current_status),
      verificationUrl: `https://verify.credentia.local/credentials/${cred.credential_id}`,
      createdAt: new Date(cred.issue_date + "T00:00:00Z"),
    };
  });
  if (credentialValues.length > 0) {
    await db.insert(credentials).values(credentialValues).onConflictDoNothing();
  }

  // 6. Seed Credential Versions
  const versionValues = data.credential_versions.map((ver: any) => ({
    businessId: ver.version_id,
    credentialId: ver.credential_id,
    version: ver.version,
    vcId: ver.vc_id,
    vcHash: ver.vc_hash,
    status: mapCredentialLifecycle(ver.status),
    issuedAt: new Date(ver.issued_at),
    supersedesVersion: ver.supersedes_version ?? null,
    supersededByVersion: ver.superseded_by_version ?? null,
    createdAt: new Date(ver.issued_at),
  }));
  if (versionValues.length > 0) {
    await db.insert(credentialVersions).values(versionValues).onConflictDoNothing();
  }

  // 7. Seed Credential Status History
  const historyValues = data.credential_status_history.map((hist: any) => ({
    businessId: hist.history_id,
    credentialId: hist.credential_id,
    version: hist.version,
    status: mapCredentialLifecycle(hist.status),
    reason: hist.reason,
    changedBy: hist.changed_by,
    changedAt: new Date(hist.changed_at),
  }));
  if (historyValues.length > 0) {
    await db.insert(credentialStatusHistory).values(historyValues).onConflictDoNothing();
  }

  // 8. Seed Verification Records
  const verRecordValues = data.verification_records.map((vr: any) => ({
    businessId: vr.verification_id,
    credentialId: vr.credential_id,
    trusted: vr.result === "VERIFIED",
    evidence: {
      verifierType: vr.verifier_type,
      result: vr.result,
      integrityValid: vr.integrity_valid,
      issuerValid: vr.issuer_valid,
      accreditationValid: vr.accreditation_valid,
      statusValid: vr.status_valid,
      provenanceValid: vr.provenance_valid,
    },
    verifiedAt: new Date(vr.verified_at),
  }));
  if (verRecordValues.length > 0) {
    await db.insert(verificationRecords).values(verRecordValues).onConflictDoNothing();
  }

  // 9. Seed Audit Logs -> audit_events
  const auditValues = data.audit_logs.map((al: any) => ({
    businessId: al.audit_id,
    eventType: al.action,
    entityId: al.entity_id,
    metadata: {
      ...al.metadata,
      actorId: al.actor_id,
      actorType: al.actor_type,
      entityType: al.entity_type,
    },
    createdAt: new Date(al.timestamp),
  }));
  if (auditValues.length > 0) {
    await db.insert(auditEvents).values(auditValues).onConflictDoNothing();
  }

  console.log(
    `Seeded synthetic data: ${data.institutions.length} institutions, ${data.accreditation_records.length} accreditations, ${data.issuers.length} issuers, ${data.issuers.length} issuer keys, ${data.credentials.length} credentials, ${data.credential_versions.length} versions, ${data.credential_status_history.length} status history records, ${data.verification_records.length} verification records, ${data.audit_logs.length} audit events.`
  );
}

if (database) {
  await seedSyntheticAcademicData(database.db);
}

const app = buildApp({
  credentials: database ? new PostgresCredentialStore(database.db) : undefined,
});
const issue = async (name: keyof typeof credentialFixtureInputs) => {
  const response = await app.inject({
    method: "POST",
    url: "/credentials",
    payload: credentialFixtureInputs[name],
  });
  if (response.statusCode !== 201)
    throw new Error(`Could not create ${name} fixture: ${response.body}`);
  return response.json().credential;
};
const valid = await issue("valid");
const revoked = await issue("revoked");
const suspended = await issue("suspended");
const expired = await issue("expired");
const superseded = await issue("superseded");
const untrustedIssuer = await issue("untrustedIssuer");
await Promise.all(
  ["revoked", "suspended", "expired"].map((status) =>
    app.inject({
      method: "POST",
      url: `/credentials/${encodeURIComponent(`urn:credentia:demo:${status}`)}/status`,
      payload: { status },
    }),
  ),
);
const replacement = await app.inject({
  method: "POST",
  url: `/credentials/${encodeURIComponent(superseded.id)}/supersede`,
  payload: { id: "urn:credentia:demo:superseded-v2" },
});
console.log(
  JSON.stringify(
    {
      valid,
      tampered: { ...valid, issuer: "did:web:attacker.example" },
      revoked,
      suspended,
      expired,
      superseded,
      supersededReplacement: replacement.json().credential,
      untrustedIssuer,
    },
    null,
    2,
  ),
);
await app.close();
await database?.close();
