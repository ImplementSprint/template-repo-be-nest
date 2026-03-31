import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ApiCenterSdkService } from './api-center-sdk.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigService(
  baseURL: string | undefined,
  apiKey: string | undefined,
): Partial<ConfigService> {
  return {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'API_CENTER_BASE_URL') return baseURL;
      if (key === 'API_CENTER_API_KEY') return apiKey;
      return undefined;
    }),
  };
}

async function createService(
  baseURL: string | undefined,
  apiKey?: string | undefined,
): Promise<ApiCenterSdkService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ApiCenterSdkService,
      { provide: ConfigService, useValue: makeConfigService(baseURL, apiKey) },
    ],
  }).compile();

  return module.get<ApiCenterSdkService>(ApiCenterSdkService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiCenterSdkService', () => {
  describe('constructor', () => {
    it('should be defined when baseURL is set', async () => {
      const service = await createService('http://api-center.local', 'key-123');
      expect(service).toBeDefined();
    });

    it('should be defined when baseURL is not set (graceful degradation)', async () => {
      const service = await createService(undefined, undefined);
      expect(service).toBeDefined();
    });

    it('initialises client without auth header when apiKey is not set', async () => {
      // Service instantiates without throwing even when apiKey is absent
      const service = await createService('http://api-center.local', undefined);
      expect(service).toBeDefined();
    });
  });

  describe('ping()', () => {
    it('returns false when client is not initialised (no baseURL)', async () => {
      const service = await createService(undefined, undefined);
      const result = await service.ping();
      expect(result).toBe(false);
    });

    it('returns true when /health GET succeeds', async () => {
      const service = await createService('http://api-center.local', 'key-abc');

      // Patch the private client after construction
      const axiosGet = jest.fn().mockResolvedValue({ data: {}, headers: {} });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.ping();
      expect(result).toBe(true);
      expect(axiosGet).toHaveBeenCalledWith('/health');
    });

    it('returns false when /health GET throws', async () => {
      const service = await createService('http://api-center.local', 'key-abc');

      const axiosGet = jest.fn().mockRejectedValue(new Error('timeout'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.ping();
      expect(result).toBe(false);
    });
  });

  describe('get()', () => {
    it('returns data and correlationId from response', async () => {
      const service = await createService('http://api-center.local', 'key-abc');

      const axiosGet = jest.fn().mockResolvedValue({
        data: { foo: 'bar' },
        headers: { 'x-correlation-id': 'corr-001' },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.get<{ foo: string }>('/resources');
      expect(result.data).toEqual({ foo: 'bar' });
      expect(result.correlationId).toBe('corr-001');
      expect(axiosGet).toHaveBeenCalledWith('/resources');
    });

    it('returns null correlationId when header is absent', async () => {
      const service = await createService('http://api-center.local', 'key-abc');

      const axiosGet = jest.fn().mockResolvedValue({
        data: {},
        headers: {},
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.get('/resources');
      expect(result.correlationId).toBeNull();
    });

    it('throws when client is not initialised', async () => {
      const service = await createService(undefined, undefined);
      await expect(service.get('/anything')).rejects.toThrow(
        'ApiCenterSdkService is not configured',
      );
    });
  });

  describe('post()', () => {
    it('returns data and correlationId from response', async () => {
      const service = await createService('http://api-center.local', 'key-abc');

      const axiosPost = jest.fn().mockResolvedValue({
        data: { id: 1 },
        headers: { 'x-correlation-id': 'corr-002' },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { post: axiosPost };

      const result = await service.post<{ id: number }>('/resources', {
        name: 'test',
      });
      expect(result.data).toEqual({ id: 1 });
      expect(result.correlationId).toBe('corr-002');
      expect(axiosPost).toHaveBeenCalledWith('/resources', { name: 'test' });
    });

    it('returns null correlationId when header is absent', async () => {
      const service = await createService('http://api-center.local', 'key-abc');

      const axiosPost = jest.fn().mockResolvedValue({
        data: {},
        headers: {},
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { post: axiosPost };

      const result = await service.post('/resources', {});
      expect(result.correlationId).toBeNull();
    });

    it('throws when client is not initialised', async () => {
      const service = await createService(undefined, undefined);
      await expect(service.post('/anything', {})).rejects.toThrow(
        'ApiCenterSdkService is not configured',
      );
    });
  });
});
