import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { ApiCenterSdkService } from '../api-center/api-center-sdk.service.js';

export type HealthStatus = 'ok' | 'degraded' | 'error';

export interface HealthChecks {
  database: boolean;
  apiCenter: boolean;
}

export interface HealthResponse {
  status: HealthStatus;
  uptimeSeconds: number;
  checks: HealthChecks;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly apiCenterSdkService: ApiCenterSdkService,
  ) {}

  async getStatus(): Promise<HealthResponse> {
    const [dbResult, apiResult] = await Promise.allSettled([
      this.supabaseService.ping(),
      this.apiCenterSdkService.ping(),
    ]);

    const database = dbResult.status === 'fulfilled' ? dbResult.value : false;
    const apiCenter =
      apiResult.status === 'fulfilled' ? apiResult.value : false;

    const passCount = (database ? 1 : 0) + (apiCenter ? 1 : 0);

    let status: HealthStatus;
    if (passCount === 2) {
      status = 'ok';
    } else if (passCount === 1) {
      status = 'degraded';
    } else {
      status = 'error';
    }

    return {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { database, apiCenter },
    };
  }
}
