import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';

export interface SdkResponse<T> {
  data: T;
  correlationId: string | null;
}

@Injectable()
export class ApiCenterSdkService {
  private readonly logger = new Logger(ApiCenterSdkService.name);
  private readonly client: AxiosInstance | null;

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.get<string>('API_CENTER_BASE_URL');
    const apiKey = this.configService.get<string>('API_CENTER_API_KEY');

    if (!baseURL) {
      this.logger.warn(
        'API_CENTER_BASE_URL is not set — ApiCenterSdkService will be unavailable',
      );
      this.client = null;
      return;
    }

    this.client = axios.create({
      baseURL,
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
    });
  }

  async get<T>(path: string): Promise<SdkResponse<T>> {
    this.assertClient();
    const response = await this.client!.get<T>(path);
    return {
      data: response.data,
      correlationId: this.extractCorrelationId(response.headers),
    };
  }

  async post<T>(path: string, body: unknown): Promise<SdkResponse<T>> {
    this.assertClient();
    const response = await this.client!.post<T>(path, body);
    return {
      data: response.data,
      correlationId: this.extractCorrelationId(response.headers),
    };
  }

  async ping(): Promise<boolean> {
    if (!this.client) {
      this.logger.warn('ping() called but client is not initialised');
      return false;
    }

    try {
      await this.client.get('/health');
      return true;
    } catch {
      this.logger.warn('ApiCenter ping failed');
      return false;
    }
  }

  private assertClient(): void {
    if (!this.client) {
      throw new Error(
        'ApiCenterSdkService is not configured — set API_CENTER_BASE_URL',
      );
    }
  }

  private extractCorrelationId(
    headers: Record<string, unknown>,
  ): string | null {
    const value = headers['x-correlation-id'];
    return typeof value === 'string' ? value : null;
  }
}
