import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigService(
  url: string | undefined,
  key: string | undefined,
): Partial<ConfigService> {
  return {
    get: jest.fn().mockImplementation((k: string) => {
      if (k === 'SUPABASE_URL') return url;
      if (k === 'SUPABASE_SERVICE_ROLE_KEY') return key;
      return undefined;
    }),
  };
}

async function createService(
  url: string | undefined,
  key: string | undefined,
): Promise<SupabaseService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SupabaseService,
      { provide: ConfigService, useValue: makeConfigService(url, key) },
    ],
  }).compile();

  const service = module.get<SupabaseService>(SupabaseService);
  // Manually trigger lifecycle hook (NestJS testing module does not call it automatically)
  service.onModuleInit();
  return service;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupabaseService', () => {
  describe('onModuleInit / getClient', () => {
    it('should be defined', async () => {
      const service = await createService(
        'https://abc.supabase.co',
        'service-role-key',
      );
      expect(service).toBeDefined();
    });

    it('creates a Supabase client when both URL and key are provided', async () => {
      const service = await createService(
        'https://abc.supabase.co',
        'service-role-key',
      );
      expect(service.getClient()).not.toBeNull();
    });

    it('leaves client null when URL is missing', async () => {
      const service = await createService(undefined, 'service-role-key');
      expect(service.getClient()).toBeNull();
    });

    it('leaves client null when key is missing', async () => {
      const service = await createService('https://abc.supabase.co', undefined);
      expect(service.getClient()).toBeNull();
    });

    it('leaves client null when both URL and key are missing', async () => {
      const service = await createService(undefined, undefined);
      expect(service.getClient()).toBeNull();
    });
  });

  describe('ping()', () => {
    it('returns false immediately when client is null', async () => {
      const service = await createService(undefined, undefined);
      const result = await service.ping();
      expect(result).toBe(false);
    });

    it('returns true when listUsers resolves without error', async () => {
      const service = await createService(
        'https://abc.supabase.co',
        'service-role-key',
      );

      // Stub the internal Supabase client
      const mockListUsers = jest.fn().mockResolvedValue({ error: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = {
        auth: { admin: { listUsers: mockListUsers } },
      };

      const result = await service.ping();
      expect(result).toBe(true);
      expect(mockListUsers).toHaveBeenCalledWith({ page: 1, perPage: 1 });
    });

    it('returns false when listUsers resolves with an error object', async () => {
      const service = await createService(
        'https://abc.supabase.co',
        'service-role-key',
      );

      const mockListUsers = jest
        .fn()
        .mockResolvedValue({ error: new Error('auth failed') });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = {
        auth: { admin: { listUsers: mockListUsers } },
      };

      const result = await service.ping();
      expect(result).toBe(false);
    });

    it('returns false when listUsers throws', async () => {
      const service = await createService(
        'https://abc.supabase.co',
        'service-role-key',
      );

      const mockListUsers = jest
        .fn()
        .mockRejectedValue(new Error('network error'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = {
        auth: { admin: { listUsers: mockListUsers } },
      };

      const result = await service.ping();
      expect(result).toBe(false);
    });

    it('returns false when the 3-second timeout fires before listUsers resolves', async () => {
      jest.useFakeTimers();

      const service = await createService(
        'https://abc.supabase.co',
        'service-role-key',
      );

      // Promise that never resolves
      const mockListUsers = jest.fn().mockReturnValue(new Promise(() => {}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).client = {
        auth: { admin: { listUsers: mockListUsers } },
      };

      const pingPromise = service.ping();

      // Advance past the 3000 ms timeout
      jest.advanceTimersByTime(3001);

      const result = await pingPromise;
      expect(result).toBe(false);

      jest.useRealTimers();
    });
  });
});
