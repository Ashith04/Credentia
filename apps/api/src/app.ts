import type { KeyObject } from "node:crypto";
import { MockBlockchainAdapter } from "@credentia/blockchain";
import Fastify from "fastify";
import { ZodError } from "zod";
import { loadSigningKeyPair } from "./config/signing-key.js";
import { deterministicIssuerKeyPair } from "@credentia/credential-core";
import { CredentialQrService } from "./modules/credentials/qr.js";
import { CredentialRepository } from "./modules/credentials/repository.js";
import type { CredentialRepositoryPort } from "./modules/credentials/repository.js";
import { credentialRoutes } from "./modules/credentials/routes.js";
import { CredentialService } from "./modules/credentials/service.js";
import { InstitutionRepository } from "./modules/institutions/repository.js";
import { institutionRoutes } from "./modules/institutions/routes.js";
import { InstitutionService } from "./modules/institutions/service.js";
import { VerificationRepository } from "./modules/verification/repository.js";
import { verificationRoutes } from "./modules/verification/routes.js";
import { VerificationService } from "./modules/verification/service.js";
import { HttpError } from "./shared/errors.js";
export function buildApp(
  options: {
    credentials?: CredentialRepositoryPort;
    keyPair?: { privateKey: KeyObject; publicKey: KeyObject };
  } = {},
) {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });
  const institutions = new InstitutionService(new InstitutionRepository());
  const keyPair = options.keyPair ?? loadSigningKeyPair();
  const credentials = options.credentials ?? new CredentialRepository();
  const verificationMethod = "did:web:demo.university.edu#key-1";
  const chain = new MockBlockchainAdapter([
    {
      did: "did:web:demo.university.edu",
      issuerAddress: "0x0000000000000000000000000000000000000001",
      validFrom: new Date("2025-01-01"),
      validUntil: new Date("2030-01-01"),
      revoked: false,
      metadataUri: "local://demo-university",
    },
  ]);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ error: "Invalid request", details: error.flatten() });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ error: error.message });
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });
  app.get("/health", async () => ({ status: "ok" }));
  institutionRoutes(app, institutions);
  credentialRoutes(
    app,
    new CredentialService(
      credentials,
      {
        privateKey: keyPair.privateKey,
        verificationMethod,
      },
      new CredentialQrService(),
    ),
  );
  verificationRoutes(
    app,
    new VerificationService(
      chain,
      (method) =>
        method === verificationMethod
          ? keyPair.publicKey
          : process.env.NODE_ENV !== "production" &&
              /^did:web:(wvit|rie|ehu|git)\.edu\.in#iss-\d+#key-\d+$/.test(
                method,
              )
            ? deterministicIssuerKeyPair(method.replace(/#key-\d+$/, ""))
                .publicKey
            : undefined,
      credentials,
      new VerificationRepository(),
    ),
  );
  return app;
}
