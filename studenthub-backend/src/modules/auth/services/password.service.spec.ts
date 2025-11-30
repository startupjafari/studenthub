import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from './password.service';
import { PasswordTooWeakException } from '../../../common/exceptions/auth.exceptions';
import * as bcrypt from 'bcryptjs';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'TestPassword123';
      const hash = await service.hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should produce different hashes for same password', async () => {
      const password = 'TestPassword123';
      const hash1 = await service.hashPassword(password);
      const hash2 = await service.hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('comparePasswords', () => {
    it('should return true for matching passwords', async () => {
      const password = 'TestPassword123';
      const hash = await bcrypt.hash(password, 10);

      const result = await service.comparePasswords(password, hash);
      expect(result).toBe(true);
    });

    it('should return false for non-matching passwords', async () => {
      const password = 'TestPassword123';
      const wrongPassword = 'WrongPassword123';
      const hash = await bcrypt.hash(password, 10);

      const result = await service.comparePasswords(wrongPassword, hash);
      expect(result).toBe(false);
    });
  });

  describe('validatePasswordStrength', () => {
    it('should pass for strong password', () => {
      expect(() => {
        service.validatePasswordStrength('StrongPass123');
      }).not.toThrow();
    });

    it('should throw for short password', () => {
      expect(() => {
        service.validatePasswordStrength('Short1');
      }).toThrow(PasswordTooWeakException);
    });

    it('should throw for password without letters', () => {
      expect(() => {
        service.validatePasswordStrength('12345678');
      }).toThrow(PasswordTooWeakException);
    });

    it('should throw for password without numbers', () => {
      expect(() => {
        service.validatePasswordStrength('NoNumbers');
      }).toThrow(PasswordTooWeakException);
    });

    it('should throw for common password', () => {
      expect(() => {
        service.validatePasswordStrength('password');
      }).toThrow(PasswordTooWeakException);
    });
  });
});

