/**
 * AuthService unit tests — critical paths:
 *   • sendOtp: per-identifier 60-second cooldown
 *   • verifyOtp: brute-force lock after 5 wrong attempts
 *   • verifyOtp: expired session → 401
 *   • verifyOtp: valid OTP → issues access + refresh tokens
 *   • refresh: token-version mismatch → 401 (replay after logout)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a fake Supabase chain that resolves to `{ data, error }`. */
function fakeSupaChain(result: { data?: any; error?: any; count?: number }) {
  const chain: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

// ─── mocks ──────────────────────────────────────────────────────────────────

const mockDbClient = {
  from: jest.fn(),
};

const mockDb: Partial<DatabaseService> = {
  client: mockDbClient as any,
};

const mockJwt: Partial<JwtService> = {
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  verify: jest.fn(),
};

const mockConfig: Partial<ConfigService> = {
  getOrThrow: jest.fn().mockReturnValue('test-refresh-secret'),
  get: jest.fn().mockReturnValue('test-key'),
};

const mockEmail: Partial<EmailService> = { sendOtp: jest.fn().mockResolvedValue(undefined) };
const mockSms: Partial<SmsService>     = { sendOtp: jest.fn().mockResolvedValue(undefined) };

// ─── setup ──────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailService, useValue: mockEmail },
        { provide: SmsService, useValue: mockSms },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ─── sendOtp ──────────────────────────────────────────────────────────────

  describe('sendOtp', () => {
    it('throws BadRequest when neither phone nor email provided', async () => {
      await expect(service.sendOtp({ phone: undefined, email: undefined } as any))
        .rejects.toThrow(BadRequestException);
    });

    it('enforces 60-second per-identifier cooldown', async () => {
      // Simulate a recent unused session exists for this identifier.
      const chain = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { created_at: new Date().toISOString() } }),
      };
      mockDbClient.from.mockReturnValue(chain);

      await expect(service.sendOtp({ email: 'user@example.com' }))
        .rejects.toThrow(/wait 60 seconds/i);
    });

    it('sends OTP by email when cooldown not triggered', async () => {
      // First call (cooldown check) → no recent session; second call (delete) → ok; third (insert) → ok.
      const noRecent = jest.fn().mockResolvedValue({ data: null });
      const chain: any = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        maybeSingle: noRecent,
      };
      mockDbClient.from.mockReturnValue(chain);

      const result = await service.sendOtp({ email: 'new@example.com' });
      expect(result.message).toMatch(/sent/i);
      expect(mockEmail.sendOtp).toHaveBeenCalledTimes(1);
    });
  });

  // ─── verifyOtp ────────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    it('throws Unauthorized when no valid session found', async () => {
      const chain: any = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        // No sessions found
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      // verifyOtp fetches sessions; mock returns empty array.
      mockDbClient.from.mockImplementation(() => {
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop; q.gt = noop; q.order = noop; q.limit = noop;
        q.then = (_: any, __: any) => Promise.resolve({ data: [] });
        return q;
      });

      await expect(service.verifyOtp({ email: 'x@x.com', otp: '123456' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('locks session after 5 wrong attempts', async () => {
      const otp_hash = await bcrypt.hash('000000', 10);
      const session = {
        id: 'sess-1',
        otp_hash,
        attempts: 4, // one more will hit MAX_ATTEMPTS
        used: false,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      };

      // Build a mock chain that returns the session for the session lookup,
      // then accepts update calls for incrementing attempts.
      let callCount = 0;
      mockDbClient.from.mockImplementation(() => {
        callCount++;
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop; q.gt = noop; q.order = noop; q.limit = noop;
        q.update = noop;
        // First chain call → return the session; subsequent → resolve update ok.
        if (callCount === 1) {
          q.then = (_: any, __: any) => Promise.resolve({ data: [session] });
        } else {
          q.then = (_: any, __: any) => Promise.resolve({ data: {}, error: null });
        }
        return q;
      });

      await expect(service.verifyOtp({ email: 'x@x.com', otp: '999999' })) // wrong OTP
        .rejects.toThrow(/too many attempts/i);
    });

    it('returns tokens on valid OTP', async () => {
      const realOtp = '123456';
      const otp_hash = await bcrypt.hash(realOtp, 10);
      const session = {
        id: 'sess-2',
        otp_hash,
        attempts: 0,
        used: false,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      };
      const fakeUser = { id: 'user-1', name: 'Test', role: 'user', token_version: 0 };

      let call = 0;
      mockDbClient.from.mockImplementation(() => {
        call++;
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop; q.gt = noop; q.order = noop; q.limit = noop;
        q.update = noop; q.insert = noop; q.is = noop;
        q.single = jest.fn().mockResolvedValue({ data: fakeUser });
        q.maybeSingle = jest.fn().mockResolvedValue(call === 1 ? { data: null } : { data: fakeUser });
        // Sessions array lookup
        q.then = (_: any, __: any) => Promise.resolve({ data: [session] });
        return q;
      });

      const result = await service.verifyOtp({ email: 'x@x.com', otp: realOtp });
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
    });
  });

  // ─── refresh ──────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('throws Unauthorized when token_version mismatches (replayed after logout)', async () => {
      (mockJwt.verify as jest.Mock).mockReturnValue({ sub: 'user-1', role: 'user', tv: 3 });

      mockDbClient.from.mockImplementation(() => {
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop;
        // Return user with token_version=5 (bumped by logout)
        q.maybeSingle = jest.fn().mockResolvedValue({ data: { role: 'user', token_version: 5 } });
        return q;
      });

      await expect(service.refresh('old.refresh.token'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('issues new tokens when token_version matches', async () => {
      (mockJwt.verify as jest.Mock).mockReturnValue({ sub: 'user-1', role: 'user', tv: 2 });

      mockDbClient.from.mockImplementation(() => {
        const q: any = {};
        const noop = () => q;
        q.select = noop; q.eq = noop;
        q.maybeSingle = jest.fn().mockResolvedValue({ data: { role: 'user', token_version: 2 } });
        return q;
      });

      const result = await service.refresh('valid.refresh.token');
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
    });
  });
});
