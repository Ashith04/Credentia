import { describe, expect, it } from "vitest";
import {
  AccreditationStatus,
  type BlockchainAdapter,
  CredentiaBlockchainAdapter,
  MockBlockchainAdapter,
  institutionIdToBytes32,
} from "../src/index.js";
import { keccak256, stringToBytes } from "viem";

describe("Deterministic Institution ID Mapping", () => {
  it("deterministically maps DB business ID (e.g. INST-0001) to keccak256 bytes32", () => {
    const expected = keccak256(stringToBytes("INST-0001"));
    const actual = institutionIdToBytes32("INST-0001");

    expect(actual).toBe(expected);
    expect(actual).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("produces distinct deterministic hashes for different institution business IDs", () => {
    const hash1 = institutionIdToBytes32("INST-0001");
    const hash2 = institutionIdToBytes32("INST-0002");
    const hash3 = institutionIdToBytes32("INST-0003");

    expect(hash1).not.toBe(hash2);
    expect(hash2).not.toBe(hash3);
  });

  it("preserves already-formatted 32-byte hex hashes", () => {
    const hex32 = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;
    expect(institutionIdToBytes32(hex32)).toBe(hex32);
  });
});

describe("Blockchain Trust Layer & MockBlockchainAdapter", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  const createAdapter = () =>
    new MockBlockchainAdapter([
      {
        id: "INST-0001",
        did: "did:web:wvit.edu.in",
        issuerAddress: "0x1111111111111111111111111111111111111111",
        validFrom: new Date("2025-01-01T00:00:00Z"),
        validUntil: new Date("2029-12-31T23:59:59Z"),
        status: AccreditationStatus.Accredited,
        metadataUri: "ipfs://wvit-accreditation",
      },
      {
        id: "INST-0002",
        did: "did:web:suspended.edu.in",
        validFrom: new Date("2025-01-01T00:00:00Z"),
        validUntil: new Date("2028-12-31T23:59:59Z"),
        status: AccreditationStatus.Suspended,
        metadataUri: "ipfs://suspended",
      },
      {
        id: "INST-0003",
        did: "did:web:revoked.edu.in",
        validFrom: new Date("2025-01-01T00:00:00Z"),
        validUntil: new Date("2030-01-01T00:00:00Z"),
        status: AccreditationStatus.Revoked,
        metadataUri: "ipfs://revoked",
      },
      {
        id: "INST-0004",
        did: "did:web:expired.edu.in",
        validFrom: new Date("2020-01-01T00:00:00Z"),
        validUntil: new Date("2025-01-01T00:00:00Z"),
        status: AccreditationStatus.Accredited,
        metadataUri: "ipfs://expired",
      },
      {
        id: "INST-0005",
        did: "did:web:legacy-revoked.edu.in",
        validFrom: new Date("2025-01-01T00:00:00Z"),
        validUntil: new Date("2030-01-01T00:00:00Z"),
        revoked: true,
        metadataUri: "ipfs://legacy-revoked",
      },
    ]);

  it("PASS: returns true for accredited institution within valid period", async () => {
    const adapter: BlockchainAdapter = createAdapter();
    const isAccredited = await adapter.isAccredited("did:web:wvit.edu.in", now);
    expect(isAccredited).toBe(true);
  });

  it("FAIL: returns false for suspended institution", async () => {
    const adapter: BlockchainAdapter = createAdapter();
    const isAccredited = await adapter.isAccredited("did:web:suspended.edu.in", now);
    expect(isAccredited).toBe(false);
  });

  it("FAIL: returns false for revoked institution", async () => {
    const adapter: BlockchainAdapter = createAdapter();
    const isAccredited = await adapter.isAccredited("did:web:revoked.edu.in", now);
    expect(isAccredited).toBe(false);

    const isLegacyRevoked = await adapter.isAccredited("did:web:legacy-revoked.edu.in", now);
    expect(isLegacyRevoked).toBe(false);
  });

  it("FAIL: returns false for expired institution", async () => {
    const adapter: BlockchainAdapter = createAdapter();
    const isAccredited = await adapter.isAccredited("did:web:expired.edu.in", now);
    expect(isAccredited).toBe(false);
  });

  it("FAIL: returns false for unknown institution", async () => {
    const adapter: BlockchainAdapter = createAdapter();
    const isAccredited = await adapter.isAccredited("did:web:unknown.edu.in", now);
    expect(isAccredited).toBe(false);
  });

  it("resolves DID with issuer / key fragments (e.g. did:web:wvit.edu.in#iss-001)", async () => {
    const adapter: BlockchainAdapter = createAdapter();
    const isAccredited = await adapter.isAccredited("did:web:wvit.edu.in#iss-001", now);
    expect(isAccredited).toBe(true);
  });

  it("resolves queries by DB business ID INST-0001", async () => {
    const adapter: BlockchainAdapter = createAdapter();
    const inst = await adapter.getInstitution("INST-0001");
    expect(inst).toBeDefined();
    expect(inst?.status).toBe(AccreditationStatus.Accredited);

    const isAccredited = await adapter.isAccredited("INST-0001", now);
    expect(isAccredited).toBe(true);
  });

  it("supports dynamic registration and accreditation update lifecycle", async () => {
    const adapter = new MockBlockchainAdapter([]);

    // Unknown initially
    expect(await adapter.isAccredited("INST-9999", now)).toBe(false);

    // Register
    await adapter.registerInstitution(
      "INST-9999",
      "0x2222222222222222222222222222222222222222",
      new Date("2026-01-01T00:00:00Z"),
      new Date("2030-01-01T00:00:00Z"),
      "ipfs://inst-9999",
    );

    expect(await adapter.isAccredited("INST-9999", now)).toBe(true);

    // Suspend
    await adapter.updateAccreditation(
      "INST-9999",
      new Date("2030-01-01T00:00:00Z"),
      AccreditationStatus.Suspended,
      "ipfs://inst-9999-suspended",
    );

    expect(await adapter.isAccredited("INST-9999", now)).toBe(false);
  });

  it("simulates backend verification evidence flow with trust layer", async () => {
    const adapter: BlockchainAdapter = createAdapter();

    // Verification service logic simulation
    const verifyIssuerAccreditation = async (issuerDid: string, at: Date = now) => {
      const accredited = await adapter.isAccredited(issuerDid, at);
      return {
        check: "accreditation",
        valid: accredited,
        detail: accredited
          ? "Issuer authorization and validity period verified on trust layer"
          : "Issuer institution is suspended, revoked, expired, or unknown",
      };
    };

    // Case 1: Accredited -> valid: true
    const resultAccredited = await verifyIssuerAccreditation("did:web:wvit.edu.in");
    expect(resultAccredited.valid).toBe(true);

    // Case 2: Suspended -> valid: false
    const resultSuspended = await verifyIssuerAccreditation("did:web:suspended.edu.in");
    expect(resultSuspended.valid).toBe(false);

    // Case 3: Revoked -> valid: false
    const resultRevoked = await verifyIssuerAccreditation("did:web:revoked.edu.in");
    expect(resultRevoked.valid).toBe(false);

    // Case 4: Expired -> valid: false
    const resultExpired = await verifyIssuerAccreditation("did:web:expired.edu.in");
    expect(resultExpired.valid).toBe(false);

    // Case 5: Unknown -> valid: false
    const resultUnknown = await verifyIssuerAccreditation("did:web:nonexistent.edu.in");
    expect(resultUnknown.valid).toBe(false);
  });
});
