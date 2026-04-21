/// <reference types="jest" />
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ApiCenterSdkService } from './api-center-sdk.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConfigOptions {
  baseURL?: string;
  apiKey?: string;
  tribeId?: string;
  tribeSecret?: string;
  timeoutMs?: string;
}

function makeConfigService(
  options: ConfigOptions,
): Partial<ConfigService> {
  const {
    baseURL,
    apiKey,
    tribeId,
    tribeSecret,
    timeoutMs,
  } = options;

  return {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'API_CENTER_BASE_URL') return baseURL;
      if (key === 'API_CENTER_API_KEY') return apiKey;
      if (key === 'API_CENTER_TRIBE_ID') return tribeId;
      if (key === 'API_CENTER_TRIBE_SECRET') return tribeSecret;
      if (key === 'API_CENTER_TIMEOUT_MS') return timeoutMs;
      if (key === 'APICENTER_URL') return baseURL;
      if (key === 'APICENTER_TRIBE_ID') return tribeId;
      if (key === 'APICENTER_TRIBE_SECRET') return tribeSecret;
      if (key === 'APICENTER_TIMEOUT_MS') return timeoutMs;
      return undefined;
    }),
  };
}

async function createService(
  options: ConfigOptions,
): Promise<ApiCenterSdkService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ApiCenterSdkService,
      { provide: ConfigService, useValue: makeConfigService(options) },
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
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-123',
      });
      expect(service).toBeDefined();
    });

    it('should be defined when baseURL is not set (graceful degradation)', async () => {
      const service = await createService({});
      expect(service).toBeDefined();
    });

    it('initialises client without auth header when apiKey is not set', async () => {
      // Service instantiates without throwing even when apiKey is absent
      const service = await createService({
        baseURL: 'http://api-center.local',
      });
      expect(service).toBeDefined();
    });
  });

  describe('ping()', () => {
    it('returns false when client is not initialised (no baseURL)', async () => {
      const service = await createService({});
      const result = await service.ping();
      expect(result).toBe(false);
    });

    it('returns true when /api/v1/health/ready GET succeeds', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      // Patch the private client after construction
      const axiosGet = jest.fn().mockResolvedValue({ data: {}, headers: {} });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.ping();
      expect(result).toBe(true);
      expect(axiosGet).toHaveBeenCalledWith('/api/v1/health/ready');
    });

    it('falls back to /api/v1/health/live when ready endpoint is missing', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const readyNotFound = Object.assign(new Error('not found'), {
        isAxiosError: true,
        response: { status: 404 },
      });
      const axiosGet = jest
        .fn()
        .mockRejectedValueOnce(readyNotFound)
        .mockResolvedValueOnce({ data: {}, headers: {} });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.ping();
      expect(result).toBe(true);
      expect(axiosGet).toHaveBeenNthCalledWith(1, '/api/v1/health/ready');
      expect(axiosGet).toHaveBeenNthCalledWith(2, '/api/v1/health/live');
    });

    it('returns false when all health endpoints fail', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const axiosGet = jest.fn().mockRejectedValue(new Error('timeout'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.ping();
      expect(result).toBe(false);
      expect(axiosGet).toHaveBeenCalledTimes(4);
    });

    it('authenticates with tribe credentials before health probe', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        tribeId: 'tribe-a',
        tribeSecret: 'secret-a',
      });

      const axiosPost = jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            accessToken: 'access-token-1',
            refreshToken: 'refresh-token-1',
            expiresIn: 3600,
          },
        },
        headers: {},
      });
      const axiosGet = jest.fn().mockResolvedValue({ data: {}, headers: {} });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = {
        post: axiosPost,
        get: axiosGet,
        defaults: { headers: { common: {} } },
      };

      const result = await service.ping();

      expect(result).toBe(true);
      expect(axiosPost).toHaveBeenCalledWith('/api/v1/auth/token', {
        tribeId: 'tribe-a',
        secret: 'secret-a',
      });
      expect(axiosGet).toHaveBeenCalledWith('/api/v1/health/ready');
    });
  });

  describe('get()', () => {
    it('normalizes APICenter path and returns data/correlationId from response headers', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const axiosGet = jest.fn().mockResolvedValue({
        data: { foo: 'bar' },
        headers: { 'x-correlation-id': 'corr-001' },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.get<{ foo: string }>('/tribes/tribe-b/users');
      expect(result.data).toEqual({ foo: 'bar' });
      expect(result.correlationId).toBe('corr-001');
      expect(axiosGet).toHaveBeenCalledWith('/api/v1/tribes/tribe-b/users');
    });

    it('unwraps APICenter success envelope and falls back to meta correlationId', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const axiosGet = jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: { userId: 7 },
          meta: { correlationId: 'corr-meta-1' },
        },
        headers: {},
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { get: axiosGet };

      const result = await service.get<{ userId: number }>('/api/v1/tribes/tribe-b/users');
      expect(result.data).toEqual({ userId: 7 });
      expect(result.correlationId).toBe('corr-meta-1');
    });

    it('uses tribe credentials to mint APICenter token when configured', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        tribeId: 'tribe-a',
        tribeSecret: 'secret-a',
      });

      const axiosPost = jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            accessToken: 'access-token-1',
            refreshToken: 'refresh-token-1',
            expiresIn: 3600,
          },
        },
        headers: {},
      });
      const axiosGet = jest.fn().mockResolvedValue({
        data: { ok: true },
        headers: {},
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = {
        post: axiosPost,
        get: axiosGet,
        defaults: { headers: { common: {} } },
      };

      await service.get('/tribes/tribe-a/users');

      expect(axiosPost).toHaveBeenCalledWith('/api/v1/auth/token', {
        tribeId: 'tribe-a',
        secret: 'secret-a',
      });
      expect(axiosGet).toHaveBeenCalledWith('/api/v1/tribes/tribe-a/users');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientDefaults = (service as any).client.defaults.headers.common;
      expect(clientDefaults['Authorization']).toBe('Bearer access-token-1');
      expect(clientDefaults['X-Tribe-Id']).toBe('tribe-a');
    });

    it('throws when client is not initialised', async () => {
      const service = await createService({});
      await expect(service.get('/anything')).rejects.toThrow(
        'ApiCenterSdkService is not configured',
      );
    });
  });

  describe('post()', () => {
    it('normalizes APICenter path and returns data/correlationId from response', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

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

    it('unwraps APICenter success envelope in POST response', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const axiosPost = jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: { id: 2 },
        },
        headers: {},
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { post: axiosPost };

      const result = await service.post<{ id: number }>('/resources', {});
      expect(result.data).toEqual({ id: 2 });
      expect(result.correlationId).toBeNull();
    });

    it('throws when client is not initialised', async () => {
      const service = await createService({});
      await expect(service.post('/anything', {})).rejects.toThrow(
        'ApiCenterSdkService is not configured',
      );
    });

    it('does not retry failed POST requests', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const axiosPost = jest.fn().mockRejectedValue(new Error('timeout'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = { post: axiosPost };

      await expect(service.post('/resources', { x: 1 })).rejects.toThrow('timeout');
      expect(axiosPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('kafka helpers', () => {
    it('kafkaListClusters calls the APICenter external clusters path', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const getSpy = jest.spyOn(service, 'get').mockResolvedValue({
        data: { clusters: [] },
        correlationId: null,
      });

      await service.kafkaListClusters();

      expect(getSpy).toHaveBeenCalledWith('/external/kafka/v3/clusters');
    });

    it('kafkaListTopics URL-encodes cluster id', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const getSpy = jest.spyOn(service, 'get').mockResolvedValue({
        data: { topics: [] },
        correlationId: null,
      });

      await service.kafkaListTopics('cluster/alpha');

      expect(getSpy).toHaveBeenCalledWith(
        '/external/kafka/v3/clusters/cluster%2Falpha/topics',
      );
    });

    it('kafkaProduceRecords URL-encodes path segments and sends records envelope', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const postSpy = jest.spyOn(service, 'post').mockResolvedValue({
        data: { success: true },
        correlationId: null,
      });

      await service.kafkaProduceRecords('cluster/alpha', 'tribe.a.orders', [
        { key: 'order-1', value: JSON.stringify({ event: 'created' }) },
      ]);

      expect(postSpy).toHaveBeenCalledWith(
        '/external/kafka/v3/clusters/cluster%2Falpha/topics/tribe.a.orders/records',
        {
          records: [
            {
              key: 'order-1',
              value: JSON.stringify({ event: 'created' }),
            },
          ],
        },
      );
    });

    it('buildTenantTopic normalizes tribe id and suffix', () => {
      const topic = ApiCenterSdkService.buildTenantTopic(
        'Payments Service',
        'Order Created',
      );

      expect(topic).toBe('tribe.payments-service.order-created');
    });

    it('kafkaGetGovernanceCatalog calls governance endpoint', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const getSpy = jest.spyOn(service, 'get').mockResolvedValue({
        data: { topics: [] },
        correlationId: null,
      });

      await service.kafkaGetGovernanceCatalog();

      expect(getSpy).toHaveBeenCalledWith('/kafka/governance');
    });

    it('kafkaPublish posts to governance publish endpoint', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const postSpy = jest.spyOn(service, 'post').mockResolvedValue({
        data: { success: true },
        correlationId: null,
      });

      await service.kafkaPublish({ topic: 'tribe.a.test' });

      expect(postSpy).toHaveBeenCalledWith('/kafka/publish', {
        topic: 'tribe.a.test',
      });
    });
  });

  describe('shared service wrappers', () => {
    it('payment wrapper methods match contract paths', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const postSpy = jest.spyOn(service, 'post').mockResolvedValue({
        data: { ok: true },
        correlationId: null,
      });
      const getSpy = jest.spyOn(service, 'get').mockResolvedValue({
        data: { ok: true },
        correlationId: null,
      });

      await service.paymentCreateCheckoutSession({ amount: 1000 });
      await service.paymentGetCheckoutSession('sess_123');
      await service.paymentCreateRefund('pay_123', { amount: 500 });

      expect(postSpy).toHaveBeenCalledWith('/shared/payment/checkout/sessions', {
        amount: 1000,
      });
      expect(getSpy).toHaveBeenCalledWith('/shared/payment/checkout/sessions/sess_123');
      expect(postSpy).toHaveBeenCalledWith('/shared/payment/payments/pay_123/refunds', {
        amount: 500,
      });
    });

    it('email and sms wrapper methods match contract paths', async () => {
      const service = await createService({
        baseURL: 'http://api-center.local',
        apiKey: 'key-abc',
      });

      const postSpy = jest.spyOn(service, 'post').mockResolvedValue({
        data: { ok: true },
        correlationId: null,
      });
      const getSpy = jest.spyOn(service, 'get').mockResolvedValue({
        data: { ok: true },
        correlationId: null,
      });

      await service.emailSend({ to: 'a@example.com' });
      await service.emailGetStatus('msg_1');
      await service.smsSend({ to: '+1234567890' });
      await service.smsGetStatus('sms_1');

      expect(postSpy).toHaveBeenCalledWith('/shared/email/send', {
        to: 'a@example.com',
      });
      expect(getSpy).toHaveBeenCalledWith('/shared/email/status/msg_1');
      expect(postSpy).toHaveBeenCalledWith('/shared/sms/send', {
        to: '+1234567890',
      });
      expect(getSpy).toHaveBeenCalledWith('/shared/sms/status/sms_1');
    });
  });
});
