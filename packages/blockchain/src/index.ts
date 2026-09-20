import {
  type Address,
  type PublicClient,
  type WalletClient,
  getContract,
  isAddress,
  isHex,
  keccak256,
  stringToBytes,
} from "viem";

export enum AccreditationStatus {
  Pending = 0,
  Accredited = 1,
  Suspended = 2,
  Revoked = 3,
  Rejected = 4,
}

export interface AccreditationRecord {
  admin: string;
  validFrom: Date;
  validUntil: Date;
  status: AccreditationStatus | number; // 0=Pending, 1=Accredited, 2=Suspended, 3=Revoked, 4=Rejected
  metadataUri: string;
}

export interface BlockchainAdapter {
  getInstitution(idOrDid: string): Promise<AccreditationRecord | undefined>;
  isIssuerAuthorized(issuer: string): Promise<boolean>;
  isAccredited(did: string, at?: Date): Promise<boolean>;
  registerInstitution?(
    id: string,
    admin: string,
    validFrom: Date,
    validUntil: Date,
    metadataUri: string,
    account?: string,
  ): Promise<`0x${string}`>;
  updateAccreditation?(
    id: string,
    validUntil: Date,
    status: number,
    metadataUri: string,
    account?: string,
  ): Promise<`0x${string}`>;
  authorizeIssuer?(
    institutionId: string,
    issuer: string,
    metadataUri: string,
    account?: string,
  ): Promise<`0x${string}`>;
  revokeIssuer?(
    issuer: string,
    account?: string,
  ): Promise<`0x${string}`>;
}

/**
 * Deterministically maps a DB institution ID (e.g., "INST-0001") or arbitrary string identifier
 * to the contract's bytes32 ID via keccak256(identifier).
 * If the input is already a 32-byte hex string (0x followed by 64 hex characters), it is preserved.
 */
export function institutionIdToBytes32(id: string): `0x${string}` {
  if (isHex(id) && id.length === 66) {
    return id as `0x${string}`;
  }
  return keccak256(stringToBytes(id));
}

export const AccreditationRegistryABI = [
  {
    "inputs": [
      { "internalType": "bytes32", "name": "id", "type": "bytes32" },
      { "internalType": "address", "name": "admin", "type": "address" },
      { "internalType": "uint64", "name": "validFrom", "type": "uint64" },
      { "internalType": "uint64", "name": "validUntil", "type": "uint64" },
      { "internalType": "string", "name": "metadataUri", "type": "string" }
    ],
    "name": "registerInstitution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "id", "type": "bytes32" },
      { "internalType": "uint64", "name": "validUntil", "type": "uint64" },
      { "internalType": "uint8", "name": "status", "type": "uint8" },
      { "internalType": "string", "name": "metadataUri", "type": "string" }
    ],
    "name": "updateAccreditation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "institutionId", "type": "bytes32" },
      { "internalType": "address", "name": "issuer", "type": "address" },
      { "internalType": "string", "name": "metadataUri", "type": "string" }
    ],
    "name": "authorizeIssuer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "issuer", "type": "address" }
    ],
    "name": "revokeIssuer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "issuer", "type": "address" }
    ],
    "name": "isIssuerAuthorized",
    "outputs": [
      { "internalType": "bool", "name": "", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "id", "type": "bytes32" }
    ],
    "name": "isAccredited",
    "outputs": [
      { "internalType": "bool", "name": "", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "id", "type": "bytes32" }
    ],
    "name": "getInstitution",
    "outputs": [
      {
        "components": [
          { "internalType": "address", "name": "admin", "type": "address" },
          { "internalType": "uint64", "name": "validFrom", "type": "uint64" },
          { "internalType": "uint64", "name": "validUntil", "type": "uint64" },
          { "internalType": "enum AccreditationRegistry.AccreditationStatus", "name": "status", "type": "uint8" },
          { "internalType": "string", "name": "metadataUri", "type": "string" }
        ],
        "internalType": "struct AccreditationRegistry.Institution",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export class CredentiaBlockchainAdapter implements BlockchainAdapter {
  private contract: ReturnType<typeof getContract>;

  constructor(
    public readonly publicClient: PublicClient,
    public readonly contractAddress: Address,
    public readonly walletClient?: WalletClient
  ) {
    this.contract = getContract({
      address: contractAddress,
      abi: AccreditationRegistryABI,
      client: {
        public: publicClient,
        wallet: walletClient,
      },
    });
  }

  async getInstitution(idOrDid: string): Promise<AccreditationRecord | undefined> {
    try {
      const bytes32Id = institutionIdToBytes32(idOrDid);
      const data = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: AccreditationRegistryABI,
        functionName: "getInstitution",
        args: [bytes32Id],
      })) as unknown as {
        admin: Address;
        validFrom: bigint;
        validUntil: bigint;
        status: number;
        metadataUri: string;
      };

      if (data.admin === "0x0000000000000000000000000000000000000000") {
        return undefined;
      }

      return {
        admin: data.admin,
        validFrom: new Date(Number(data.validFrom) * 1000),
        validUntil: new Date(Number(data.validUntil) * 1000),
        status: data.status,
        metadataUri: data.metadataUri,
      };
    } catch {
      return undefined;
    }
  }

  async isIssuerAuthorized(issuer: string): Promise<boolean> {
    try {
      if (!isAddress(issuer)) {
        return false;
      }
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: AccreditationRegistryABI,
        functionName: "isIssuerAuthorized",
        args: [issuer as Address],
      })) as boolean;
    } catch {
      return false;
    }
  }

  async isAccredited(did: string, at: Date = new Date()): Promise<boolean> {
    try {
      // If the identifier is a direct Ethereum address, query issuer authorization directly
      if (isAddress(did)) {
        return await this.isIssuerAuthorized(did);
      }

      // Query institution accreditation record
      let inst = await this.getInstitution(did);
      if (!inst && did.includes("#")) {
        inst = await this.getInstitution(did.split("#")[0]);
      }

      if (!inst) {
        return false;
      }

      const timestamp = at.getTime();
      return (
        inst.status === AccreditationStatus.Accredited &&
        timestamp >= inst.validFrom.getTime() &&
        timestamp <= inst.validUntil.getTime()
      );
    } catch {
      return false;
    }
  }

  async registerInstitution(
    id: string,
    admin: string,
    validFrom: Date,
    validUntil: Date,
    metadataUri: string,
    account?: string,
  ): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const bytes32Id = institutionIdToBytes32(id);
    const adminAddress = admin as Address;
    const writeAccount = (account ?? this.walletClient.account?.address) as Address;
    const { request } = await this.publicClient.simulateContract({
      account: writeAccount,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: "registerInstitution",
      args: [
        bytes32Id,
        adminAddress,
        BigInt(Math.floor(validFrom.getTime() / 1000)),
        BigInt(Math.floor(validUntil.getTime() / 1000)),
        metadataUri,
      ],
    });
    return this.walletClient.writeContract(request as any);
  }

  async updateAccreditation(
    id: string,
    validUntil: Date,
    status: number,
    metadataUri: string,
    account?: string,
  ): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const bytes32Id = institutionIdToBytes32(id);
    const writeAccount = (account ?? this.walletClient.account?.address) as Address;
    const { request } = await this.publicClient.simulateContract({
      account: writeAccount,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: "updateAccreditation",
      args: [
        bytes32Id,
        BigInt(Math.floor(validUntil.getTime() / 1000)),
        status,
        metadataUri,
      ],
    });
    return this.walletClient.writeContract(request as any);
  }

  async authorizeIssuer(
    institutionId: string,
    issuer: string,
    metadataUri: string,
    account?: string,
  ): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const bytes32Id = institutionIdToBytes32(institutionId);
    const issuerAddress = issuer as Address;
    const writeAccount = (account ?? this.walletClient.account?.address) as Address;
    const { request } = await this.publicClient.simulateContract({
      account: writeAccount,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: "authorizeIssuer",
      args: [bytes32Id, issuerAddress, metadataUri],
    });
    return this.walletClient.writeContract(request as any);
  }

  async revokeIssuer(
    issuer: string,
    account?: string,
  ): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const issuerAddress = issuer as Address;
    const writeAccount = (account ?? this.walletClient.account?.address) as Address;
    const { request } = await this.publicClient.simulateContract({
      account: writeAccount,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: "revokeIssuer",
      args: [issuerAddress],
    });
    return this.walletClient.writeContract(request as any);
  }
}

export interface RegistryArtifact {
  abi: readonly unknown[];
  address: `0x${string}`;
  chainId: number;
}

export const MOCK_REGISTRY_ARTIFACT: RegistryArtifact = {
  abi: AccreditationRegistryABI,
  address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  chainId: 31337,
};

export function registryArtifactFromDeployment(
  input: RegistryArtifact,
): RegistryArtifact {
  if (!input.address || !input.chainId)
    throw new Error("Deployment artifact requires address and chain ID");
  return input;
}

export interface MockInstitutionRecord {
  id?: string;
  did?: string;
  issuerAddress?: string;
  admin?: string;
  validFrom: Date;
  validUntil: Date;
  status?: AccreditationStatus | number;
  revoked?: boolean;
  metadataUri?: string;
}

export class MockBlockchainAdapter implements BlockchainAdapter {
  private records: MockInstitutionRecord[];

  constructor(initialRecords: MockInstitutionRecord[] = []) {
    this.records = [...initialRecords];
  }

  private findRecord(query: string): MockInstitutionRecord | undefined {
    if (query === "0x0" || !query) return undefined;

    const queryBytes32 = institutionIdToBytes32(query);
    const queryBaseDid = query.includes("#") ? query.split("#")[0] : undefined;

    return this.records.find((r) => {
      // 1. Direct DID match
      if (r.did && r.did === query) return true;
      // 2. Base DID match if query contains fragment (e.g. #iss-001 or #key-1)
      if (r.did && queryBaseDid && r.did === queryBaseDid) return true;
      // 3. Direct ID match
      if (r.id && r.id === query) return true;
      // 4. Deterministic bytes32 ID match (e.g. INST-0001 -> keccak256("INST-0001"))
      if (r.id && institutionIdToBytes32(r.id) === queryBytes32) return true;
      // 5. Issuer address match
      if (r.issuerAddress && r.issuerAddress.toLowerCase() === query.toLowerCase()) return true;
      // 6. Admin address match
      if (r.admin && r.admin.toLowerCase() === query.toLowerCase()) return true;

      return false;
    });
  }

  async getInstitution(idOrDid: string): Promise<AccreditationRecord | undefined> {
    const record = this.findRecord(idOrDid);
    if (!record) return undefined;

    const status =
      record.status !== undefined
        ? record.status
        : record.revoked
          ? AccreditationStatus.Revoked
          : AccreditationStatus.Accredited;

    return {
      admin: record.admin ?? record.issuerAddress ?? "0x1234567890123456789012345678901234567890",
      validFrom: record.validFrom,
      validUntil: record.validUntil,
      status,
      metadataUri: record.metadataUri ?? "ipfs://mock",
    };
  }

  async isIssuerAuthorized(issuer: string): Promise<boolean> {
    const record = this.findRecord(issuer);
    if (!record) return false;
    return this.isAccredited(issuer);
  }

  async isAccredited(did: string, at: Date = new Date()): Promise<boolean> {
    const record = this.findRecord(did);
    if (!record) {
      // unknown institution -> FAIL
      return false;
    }

    // Check revocation
    if (record.revoked) {
      return false;
    }

    // Check status
    const status =
      record.status !== undefined
        ? record.status
        : AccreditationStatus.Accredited;

    if (status !== AccreditationStatus.Accredited) {
      // suspended/revoked/rejected/pending -> FAIL
      return false;
    }

    // Check validity period
    const timestamp = at.getTime();
    if (
      timestamp < record.validFrom.getTime() ||
      timestamp > record.validUntil.getTime()
    ) {
      // expired or not yet valid -> FAIL
      return false;
    }

    // institution accredited -> PASS
    return true;
  }

  async registerInstitution(
    id: string,
    admin: string,
    validFrom: Date,
    validUntil: Date,
    metadataUri: string,
  ): Promise<`0x${string}`> {
    this.records.push({
      id,
      admin,
      validFrom,
      validUntil,
      status: AccreditationStatus.Accredited,
      metadataUri,
    });
    return "0xmocktx00000000000000000000000000000000000000000000000000000000000001";
  }

  async updateAccreditation(
    id: string,
    validUntil: Date,
    status: number,
    metadataUri: string,
  ): Promise<`0x${string}`> {
    const record = this.findRecord(id);
    if (record) {
      record.validUntil = validUntil;
      record.status = status;
      record.metadataUri = metadataUri;
    }
    return "0xmocktx00000000000000000000000000000000000000000000000000000000000002";
  }

  async authorizeIssuer(
    institutionId: string,
    issuer: string,
    metadataUri: string,
  ): Promise<`0x${string}`> {
    const record = this.findRecord(institutionId);
    if (record) {
      record.issuerAddress = issuer;
      record.metadataUri = metadataUri;
    }
    return "0xmocktx00000000000000000000000000000000000000000000000000000000000003";
  }

  async revokeIssuer(issuer: string): Promise<`0x${string}`> {
    const record = this.findRecord(issuer);
    if (record) {
      record.revoked = true;
      record.status = AccreditationStatus.Revoked;
    }
    return "0xmocktx00000000000000000000000000000000000000000000000000000000000004";
  }
}

