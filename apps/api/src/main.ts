import "reflect-metadata";

import { type NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";

import { AppModule } from "./app.module";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      logger: false,
      routerOptions: { ignoreTrailingSlash: true },
    }),
  );

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024 } });

  // Webhook signature verification needs the EXACT raw bytes — stash them on
  // the request for /webhooks/* URLs before Fastify parses JSON.
  const instance = app.getHttpAdapter().getInstance();
  instance.addHook("preParsing", async (request: unknown, _reply: unknown, payload: unknown) => {
    const req = request as { url?: string; rawBody?: Buffer };
    if (req.url && req.url.startsWith("/webhooks/")) {
      const { Readable } = await import("node:stream");
      const chunks: Buffer[] = [];
      for await (const chunk of payload as AsyncIterable<Buffer>) {
        chunks.push(chunk as Buffer);
      }
      req.rawBody = Buffer.concat(chunks);
      return Readable.from(req.rawBody);
    }
    return payload;
  });

  app.enableShutdownHooks();

  await app.listen(PORT, HOST);
}

void bootstrap();

