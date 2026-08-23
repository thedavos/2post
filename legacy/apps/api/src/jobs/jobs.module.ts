import { Global, Module } from "@nestjs/common";

import { CryptoModule } from "../common/crypto/crypto.module";
import { PublisherModule } from "../modules/publisher/publisher.module";
import { JobsService } from "./jobs.service";

/// Central recurring-jobs module (pg-boss). Worker process boots this;
/// the API process ignores schedules (WORKER_MODE gate in JobsService).
@Global()
@Module({
  imports: [PublisherModule, CryptoModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
