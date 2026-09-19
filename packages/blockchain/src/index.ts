import {
  PublicClient,
  WalletClient,
  Address,
  getContract,
} from "viem";

export interface AccreditationRecord {
  admin: Address;
  validFrom: Date;
  validUntil: Date;
  status: number; // 0=Pending, 1=Accredited, 2=Suspended, 3=Revoked, 4=Rejected
  metadataUri: string;
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

export class CredentiaBlockchainAdapter {
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

  async getInstitution(id: `0x${string}`): Promise<AccreditationRecord | undefined> {
    try {
      const data = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: AccreditationRegistryABI,
        functionName: 'getInstitution',
        args: [id]
      }) as unknown as { admin: Address, validFrom: bigint, validUntil: bigint, status: number, metadataUri: string };
      
      if (data.admin === '0x0000000000000000000000000000000000000000') {
        return undefined;
      }

      return {
        admin: data.admin,
        validFrom: new Date(Number(data.validFrom) * 1000),
        validUntil: new Date(Number(data.validUntil) * 1000),
        status: data.status,
        metadataUri: data.metadataUri,
      };
    } catch (e) {
      return undefined;
    }
  }

  async isIssuerAuthorized(issuer: Address): Promise<boolean> {
    try {
      return await this.publicClient.readContract({
        address: this.contractAddress,
        abi: AccreditationRegistryABI,
        functionName: 'isIssuerAuthorized',
        args: [issuer]
      }) as boolean;
    } catch {
      return false;
    }
  }

  async registerInstitution(
    id: `0x${string}`,
    admin: Address,
    validFrom: Date,
    validUntil: Date,
    metadataUri: string,
    account: Address
  ) {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: 'registerInstitution',
      args: [id, admin, BigInt(Math.floor(validFrom.getTime() / 1000)), BigInt(Math.floor(validUntil.getTime() / 1000)), metadataUri]
    });
    return this.walletClient.writeContract(request as any);
  }

  async updateAccreditation(
    id: `0x${string}`,
    validUntil: Date,
    status: number,
    metadataUri: string,
    account: Address
  ) {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: 'updateAccreditation',
      args: [id, BigInt(Math.floor(validUntil.getTime() / 1000)), status, metadataUri]
    });
    return this.walletClient.writeContract(request as any);
  }

  async authorizeIssuer(
    institutionId: `0x${string}`,
    issuer: Address,
    metadataUri: string,
    account: Address
  ) {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: 'authorizeIssuer',
      args: [institutionId, issuer, metadataUri]
    });
    return this.walletClient.writeContract(request as any);
  }

  async revokeIssuer(
    issuer: Address,
    account: Address
  ) {
    if (!this.walletClient) throw new Error("WalletClient required for writing");
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.contractAddress,
      abi: AccreditationRegistryABI,
      functionName: 'revokeIssuer',
      args: [issuer]
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
  address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Default local anvil deployment address usually
  chainId: 31337
};

export function registryArtifactFromDeployment(
  input: RegistryArtifact,
): RegistryArtifact {
  if (!input.address || !input.chainId)
    throw new Error("Deployment artifact requires address and chain ID");
  return input;
}


export class MockBlockchainAdapter {
  constructor(public records: any[]) {}
  async getInstitution(id: any) {
    if (id === '0x0') return undefined;
    return { admin: '0x1234567890123456789012345678901234567890', validFrom: new Date(), validUntil: new Date(Date.now() + 10000000000), status: 1, metadataUri: 'ipfs://mock' };
  }
  async isIssuerAuthorized(issuer: any) { return true; }
  async registerInstitution() { return '0xmocktx'; }
  async updateAccreditation() { return '0xmocktx'; }
  async authorizeIssuer() { return '0xmocktx'; }
  async revokeIssuer() { return '0xmocktx'; }
}
