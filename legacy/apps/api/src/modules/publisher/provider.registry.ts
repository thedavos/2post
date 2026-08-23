import { Injectable } from "@nestjs/common";

import type { PlatformSlug, SocialProvider } from "@brightbean/shared";

/**
 * Registry pattern ported from providers/__init__.py: one provider per
 * platform slug; adding a platform touches this file's map only.
 */
@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<PlatformSlug, SocialProvider>();

  register(provider: SocialProvider): void {
    this.providers.set(provider.platformName, provider);
  }

  get(platform: string): SocialProvider {
    const provider = this.providers.get(platform as PlatformSlug);
    if (!provider) {
      throw new Error(`No provider registered for platform "${platform}"`);
    }
    return provider;
  }

  has(platform: string): boolean {
    return this.providers.has(platform as PlatformSlug);
  }

  registeredPlatforms(): PlatformSlug[] {
    return [...this.providers.keys()];
  }
}
