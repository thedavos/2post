import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { PrismaService } from "../../prisma/prisma.service";
import { pubsubHubbubChallenge, verifyMetaSignature } from "./webhook-signature";

/**
 * Public inbound webhook receivers. Paths are byte-identical to the legacy
 * routes (platforms are configured against them). Raw-body signature
 * verification happens BEFORE JSON parsing — main.ts stashes the raw buffer
 * on the request for /webhooks/* URLs only.
 */

interface WebhookRequest extends FastifyRequest {
  rawBody?: Buffer;
}

function metaSecretFor(platform: string): string | undefined {
  // Resolved lazily so env vars set after module load still apply.
  switch (platform) {
    case "facebook":
    case "instagram":
      return process.env.PLATFORM_FACEBOOK_APP_SECRET;
    case "threads":
      return process.env.PLATFORM_THREADS_APP_SECRET;
    case "instagram_login":
      return process.env.PLATFORM_INSTAGRAM_APP_SECRET;
    default:
      return undefined;
  }
}

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly prisma: PrismaService) {}

  // Meta subscription verification handshake (Facebook/Instagram/Threads/IG Login)
  @Get(":platform/")
  async metaVerify(
    @Param("platform") platform: string,
    @Query("hub.mode") mode: string | undefined,
    @Query("hub.verify_token") verifyToken: string | undefined,
    @Query("hub.challenge") challenge: string | undefined,
  ) {
    const expected = platformEnv(platform, "VERIFY_TOKEN");
    if (mode === "subscribe" && challenge && (!expected || verifyToken === expected)) {
      return challenge; // echo back plain text
    }
    throw new ForbiddenException("Verification failed");
  }

  @Post("facebook/")
  @Post("instagram/")
  @Post("threads/")
  @Post("instagram_login/")
  async metaEvent(
    @Req() request: WebhookRequest & { rawBody?: Buffer; params?: Record<string, string> },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const platform =
      request.params?.["platform"] ??
      (request.raw?.url?.match(/\/webhooks\/(facebook|instagram|threads|instagram_login)\//i)?.[1] ??
        "").toLowerCase();
    const rawBody = request.rawBody;
    if (!rawBody) throw new BadRequestException("Missing body");

    const appSecret = metaSecretFor(platform);
    if (!appSecret) throw new ForbiddenException("Webhook not configured");
    const signature =
      (request.headers["x-hub-signature-256"] as string | undefined) ?? undefined;
    if (!verifyMetaSignature(appSecret, rawBody, signature)) {
      throw new ForbiddenException("Invalid signature");
    }

    // Platforms require fast 2xx — enqueue processing later (inbox phase job).
    reply.code(200);
    return { ok: true };
  }

  /// YouTube PubSubHubbub: GET challenge during subscribe.
  @Get("youtube/")
  async youtubeVerify(
    @Query() query: Record<string, string | undefined>,
  ) {
    const { ok, challenge } = pubsubHubbubChallenge(query);
    if (!ok) throw new ForbiddenException("Verification failed");
    return challenge!;
  }

  @Post("youtube/")
  async youtubeEvent(
    @Req() request: WebhookRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // Atom XML payloads — parse + dedup in the inbox sync phase; ack immediately.
    void this.prisma;
    void request;
    reply.code(200);
    return { ok: true };
  }
}

function platformEnv(platform: string, _suffix: "VERIFY_TOKEN"): string | undefined {
  const map: Record<string, string> = {
    facebook: "FACEBOOK_WEBHOOK_VERIFY_TOKEN",
    instagram: "FACEBOOK_WEBHOOK_VERIFY_TOKEN",
    instagram_login: "INSTAGRAM_LOGIN_WEBHOOK_VERIFY_TOKEN",
    threads: "FACEBOOK_WEBHOOK_VERIFY_TOKEN",
    youtube: "YOUTUBE_WEBHOOK_SECRET",
  };
  return process.env[map[platform] ?? ""];
}
