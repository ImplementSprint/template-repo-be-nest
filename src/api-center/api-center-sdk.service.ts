import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, {
  type AxiosInstance,
  type AxiosResponse,
  isAxiosError,
} from 'axios';

export interface SdkResponse<T> {
  data: T;
  correlationId: string | null;
}

export interface KafkaProduceRecord {
  key?: string;
  value: string;
  headers?: Record<string, string>;
}

@Injectable()
export class ApiCenterSdkService {
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_BASE_DELAY_MS = 200;
  private static readonly TOKEN_REFRESH_SKEW_MS = 30_000;

  private readonly logger = new Logger(ApiCenterSdkService.name);
  private readonly client: AxiosInstance | null;
  private readonly apiKey: string | null;
  private readonly tribeId: string | null;
  private readonly tribeSecret: string | null;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.get<string>('API_CENTER_BASE_URL')?.trim();
    this.apiKey = this.configService.get<string>('API_CENTER_API_KEY')?.trim() ?? null;
    this.tribeId = this.configService.get<string>('API_CENTER_TRIBE_ID')?.trim() ?? null;
    this.tribeSecret =
      this.configService.get<string>('API_CENTER_TRIBE_SECRET')?.trim() ?? null;

    if (!baseURL) {
      this.logger.warn(
        'API_CENTER_BASE_URL is not set — ApiCenterSdkService will be unavailable',
      );
      this.client = null;
      return;
    }

    if (this.tribeId !== null && this.tribeSecret === null) {
      this.logger.warn(
        'API_CENTER_TRIBE_ID is set but API_CENTER_TRIBE_SECRET is missing — falling back to API_CENTER_API_KEY mode',
      );
    }

    if (this.tribeId === null && this.tribeSecret !== null) {
      this.logger.warn(
        'API_CENTER_TRIBE_SECRET is set but API_CENTER_TRIBE_ID is missing — falling back to API_CENTER_API_KEY mode',
      );
    }

    if (this.usesTribeCredentials() && this.apiKey !== null) {
      this.logger.log(
        'API_CENTER_TRIBE_ID/API_CENTER_TRIBE_SECRET detected — preferring token lifecycle over static API_CENTER_API_KEY',
      );
    }

    const timeoutMs = this.getTimeoutMs();

    this.client = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
    });
  }

  async get<T>(path: string): Promise<SdkResponse<T>> {
    this.assertClient();
    const normalizedPath = this.normalizePath(path);
    const response = await this.executeWithAuth<T>(() =>
      this.callWithRetry(() => this.client!.get<T>(normalizedPath)),
    );
    return {
      data: this.unwrapData<T>(response),
      correlationId: this.extractCorrelationId(response),
    };
  }

  async post<T>(path: string, body: unknown): Promise<SdkResponse<T>> {
    this.assertClient();
    const normalizedPath = this.normalizePath(path);
    const response = await this.executeWithAuth<T>(() =>
      // Avoid write replay risk for non-idempotent POST calls.
      this.callWithRetry(() => this.client!.post<T>(normalizedPath, body), 0),
    );
    return {
      data: this.unwrapData<T>(response),
      correlationId: this.extractCorrelationId(response),
    };
  }

  async kafkaListClusters<T = unknown>(): Promise<SdkResponse<T>> {
    return this.get<T>('/external/kafka/v3/clusters');
  }

  async kafkaListTopics<T = unknown>(
    clusterId: string,
  ): Promise<SdkResponse<T>> {
    const encodedClusterId = encodeURIComponent(clusterId);
    return this.get<T>(`/external/kafka/v3/clusters/${encodedClusterId}/topics`);
  }

  async kafkaProduceRecords<T = unknown>(
    clusterId: string,
    topic: string,
    records: KafkaProduceRecord[],
  ): Promise<SdkResponse<T>> {
    const encodedClusterId = encodeURIComponent(clusterId);
    const encodedTopic = encodeURIComponent(topic);

    return this.post<T>(
      `/external/kafka/v3/clusters/${encodedClusterId}/topics/${encodedTopic}/records`,
      { records },
    );
  }

  static buildTenantTopic(tribeId: string, suffix: string): string {
    const normalizedTribeId = String(tribeId)
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]/g, '-');
    const normalizedSuffix = String(suffix)
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]/g, '-');

    return `tribe.${normalizedTribeId}.${normalizedSuffix}`;
  }

  async ping(): Promise<boolean> {
    if (!this.client) {
      this.logger.warn('ping() called but client is not initialised');
      return false;
    }

    const healthPaths = [
      '/api/v1/health/ready',
      '/api/v1/health/live',
      '/api/v1/health',
      '/health',
    ];

    for (const healthPath of healthPaths) {
      try {
        await this.executeWithAuth<unknown>(
          () =>
            this.callWithRetry(
              () => this.client!.get(healthPath),
              // Health probes are short and should fail fast.
              1,
            ),
        );
        return true;
      } catch (error) {
        if (!this.isNotFoundError(error)) {
          this.logger.warn(`ApiCenter ping failed for '${healthPath}'`);
        }
      }
    }

    return false;
  }

  private assertClient(): void {
    if (!this.client) {
      throw new Error(
        'ApiCenterSdkService is not configured — set API_CENTER_BASE_URL',
      );
    }
  }

  private async executeWithAuth<T>(
    operation: () => Promise<AxiosResponse<T>>,
  ): Promise<AxiosResponse<T>> {
    if (this.usesTribeCredentials()) {
      await this.ensureAccessToken();
      this.setAuthHeaders();
    }

    try {
      return await operation();
    } catch (error) {
      if (this.usesTribeCredentials() && this.isUnauthorizedError(error)) {
        await this.authenticateWithTribeSecret();
        this.setAuthHeaders();
        return operation();
      }
      throw error;
    }
  }

  private normalizePath(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;

    if (normalized.startsWith('/api/v1/')) {
      return normalized;
    }

    const shouldPrefix =
      normalized.startsWith('/auth/') ||
      normalized.startsWith('/external/') ||
      normalized.startsWith('/health') ||
      normalized.startsWith('/registry/') ||
      normalized.startsWith('/shared/') ||
      normalized.startsWith('/tribes/');

    return shouldPrefix ? `/api/v1${normalized}` : normalized;
  }

  private unwrapData<T>(response: AxiosResponse<T>): T {
    const payload = response.data as unknown;

    if (
      payload !== null &&
      typeof payload === 'object' &&
      'success' in payload &&
      'data' in payload
    ) {
      return (payload as { data: T }).data;
    }

    return response.data;
  }

  private extractCorrelationId(response: AxiosResponse<unknown>): string | null {
    const headerValue = response.headers['x-correlation-id'];

    if (typeof headerValue === 'string' && headerValue.length > 0) {
      return headerValue;
    }

    if (Array.isArray(headerValue) && typeof headerValue[0] === 'string') {
      return headerValue[0];
    }

    const payload = response.data;
    if (
      payload !== null &&
      typeof payload === 'object' &&
      'meta' in payload &&
      typeof (payload as { meta?: { correlationId?: unknown } }).meta
        ?.correlationId === 'string'
    ) {
      return (payload as { meta: { correlationId: string } }).meta.correlationId;
    }

    return null;
  }

  private getTimeoutMs(): number {
    const raw = this.configService.get<string>('API_CENTER_TIMEOUT_MS');

    if (!raw) {
      return 10_000;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `API_CENTER_TIMEOUT_MS='${raw}' is invalid — falling back to 10000ms`,
      );
      return 10_000;
    }

    return parsed;
  }

  private usesTribeCredentials(): boolean {
    return this.tribeId !== null && this.tribeSecret !== null;
  }

  private setAuthHeaders(): void {
    if (!this.client) {
      return;
    }

    if (this.usesTribeCredentials() && this.accessToken) {
      this.client.defaults.headers.common['Authorization'] =
        `Bearer ${this.accessToken}`;
      this.client.defaults.headers.common['X-Tribe-Id'] = this.tribeId!;
      return;
    }

    if (this.apiKey !== null) {
      this.client.defaults.headers.common['Authorization'] =
        `Bearer ${this.apiKey}`;
    }
  }

  private async ensureAccessToken(): Promise<void> {
    if (!this.usesTribeCredentials()) {
      return;
    }

    const tokenStillValid =
      this.accessToken !== null &&
      Date.now() < this.tokenExpiresAt - ApiCenterSdkService.TOKEN_REFRESH_SKEW_MS;

    if (tokenStillValid) {
      return;
    }

    if (this.refreshToken !== null) {
      try {
        await this.refreshAccessToken();
        return;
      } catch {
        this.logger.warn('ApiCenter token refresh failed — re-authenticating');
      }
    }

    await this.authenticateWithTribeSecret();
  }

  private async authenticateWithTribeSecret(): Promise<void> {
    this.assertClient();

    const response = await this.callWithRetry(() =>
      this.client!.post('/api/v1/auth/token', {
        tribeId: this.tribeId,
        secret: this.tribeSecret,
      }),
    );

    this.applyTokenPayload(response.data);
  }

  private async refreshAccessToken(): Promise<void> {
    this.assertClient();

    const response = await this.callWithRetry(() =>
      this.client!.post('/api/v1/auth/token/refresh', {
        refreshToken: this.refreshToken,
      }),
    );

    this.applyTokenPayload(response.data);
  }

  private applyTokenPayload(payload: unknown): void {
    const tokenData = this.extractTokenData(payload);

    if (!tokenData.accessToken) {
      throw new Error('APICenter token response did not include accessToken');
    }

    this.accessToken = tokenData.accessToken;
    this.refreshToken = tokenData.refreshToken ?? null;
    const expiresInSeconds = Number(tokenData.expiresIn ?? 3600);
    this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  }

  private extractTokenData(
    payload: unknown,
  ): {
    accessToken?: string;
    refreshToken?: string | null;
    expiresIn?: number;
  } {
    if (payload !== null && typeof payload === 'object' && 'data' in payload) {
      return (payload as { data: Record<string, unknown> }).data;
    }

    return (payload as Record<string, unknown>) ?? {};
  }

  private async callWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = ApiCenterSdkService.MAX_RETRIES,
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetryable(error) || attempt >= maxRetries) {
          throw error;
        }

        const waitMs =
          ApiCenterSdkService.RETRY_BASE_DELAY_MS * 2 ** attempt;
        await this.sleep(waitMs);
        attempt += 1;
      }
    }
  }

  private isRetryable(error: unknown): boolean {
    if (!isAxiosError(error)) {
      return false;
    }

    if (!error.response) {
      return true;
    }

    return [429, 502, 503, 504].includes(error.response.status);
  }

  private isUnauthorizedError(error: unknown): boolean {
    return this.getStatusCode(error) === 401;
  }

  private isNotFoundError(error: unknown): boolean {
    return this.getStatusCode(error) === 404;
  }

  private getStatusCode(error: unknown): number | null {
    if (!isAxiosError(error)) {
      return null;
    }

    return error.response?.status ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
