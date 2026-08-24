import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import { PrismaService } from "../../prisma/prisma.service";

const TOKEN_TTL_DAYS = 30;

/**
 * Magic-link semantics ported from apps/client_portal/models.py:
 * 32-byte random token shown once; only its SHA-256 hash is stored.
 */
@Injectable()
export class ClientPortalService {
  constructor(private readonly prisma: PrismaService) {}

  async issueLink(
    issuedByUserId: string,
    workspaceId: string,
    clientEmail: string,
  ): Promise<{ token: string; url: string; expiresAt: Date }> {
    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.portalAccess.create({
      data: {
        workspaceId,
        clientEmail,
        tokenHash: sha256(raw),
        createdById: issuedByUserId,
        expiresAt,
      },
    });

    const base = process.env.APP_URL ?? "";
    return { token: raw, url: `${base}/portal/${raw}`, expiresAt };
  }

  async redeem(rawToken: string): Promise<{ workspaceId: string; email: string }> {
    const access = await this.prisma.portalAccess.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!access || access.revokedAt || access.expiresAt < new Date()) {
      throw new NotFoundException("Invalid or expired link");
    }

    await this.prisma.portalAccess.update({
      where: { id: access.id },
      data: { lastUsedAt: new Date() },
    });

    return { workspaceId: access.workspaceId, email: access.clientEmail };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
