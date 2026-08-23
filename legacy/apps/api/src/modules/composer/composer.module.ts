import { Module } from "@nestjs/common";

import { ComposerController } from "./composer.controller";

@Module({
  controllers: [ComposerController],
})
export class ComposerModule {}
