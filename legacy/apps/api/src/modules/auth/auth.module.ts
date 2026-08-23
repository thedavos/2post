import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

const JWT_SECRET = process.env.JWT_SECRET ?? process.env.SECRET_KEY;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET (or SECRET_KEY) must be set for the auth module");
}

/// Global so JwtAuthGuard/JwtService resolve in every feature module.
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { expiresIn: "15m" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
