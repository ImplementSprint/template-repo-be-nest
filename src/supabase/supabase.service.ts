import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const PING_TIMEOUT_MS = 3_000;

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !key) {
      this.logger.warn(
        'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. ' +
          'SupabaseService will not be available.',
      );
      return;
    }

    this.client = createClient(url, key, {
      auth: {
        // Service-role key must not persist sessions
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }

  async ping(): Promise<boolean> {
    if (this.client === null) {
      return false;
    }

    const attempt = async (): Promise<boolean> => {
      try {
        // Lightweight existence check — list zero users from the auth admin API.
        // This round-trips to the Supabase project without touching any
        // application table and works on any freshly created project.
        const { error } = await (
          this.client as SupabaseClient
        ).auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });
        return error === null;
      } catch {
        return false;
      }
    };

    let timerId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<boolean>((resolve) => {
      timerId = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    });

    return Promise.race([attempt(), timeout]).finally(() => {
      // Clear the timer regardless of which promise won so the handle is
      // released and Node / Jest can exit cleanly without open-handle warnings.
      clearTimeout(timerId);
    });
  }
}
