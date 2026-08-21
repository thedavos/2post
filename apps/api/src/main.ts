import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type {
  NestFastifyApplication} from "@nestjs/platform-fastify";
import {
  FastifyAdapter
} from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      logger: false,
      ignoreTrailingSlash: true,
    }),
  );

  app.enableShutdownHooks();

  await app.listen(PORT, HOST);
}

void bootstrap();
