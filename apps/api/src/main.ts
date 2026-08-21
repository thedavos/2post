import "reflect-metadata";

import { type NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import cookie from "@fastify/cookie";

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
  app.enableShutdownHooks();

  await app.listen(PORT, HOST);
}

void bootstrap();

