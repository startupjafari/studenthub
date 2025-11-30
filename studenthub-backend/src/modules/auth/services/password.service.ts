import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PasswordTooWeakException } from '../../../common/exceptions/auth.exceptions';

@Injectable()
export class PasswordService {
  private readonly SALT_ROUNDS = 10;
  private readonly COMMON_PASSWORDS = [
    'password',
    '12345678',
    '123456789',
    'qwerty123',
    'abc123',
    'password123',
  ];

  /**
   * Hash a plain text password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Compare a plain text password with a hashed password
   */
  async comparePasswords(
    plainPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Validate password strength
   * - Minimum 8 characters
   * - At least one letter
   * - At least one number
   * - Not a common password
   */
  validatePasswordStrength(password: string): void {
    // Check minimum length
    if (password.length < 8) {
      throw new PasswordTooWeakException(
        'Password must be at least 8 characters long',
      );
    }

    // Check for at least one letter
    if (!/[A-Za-z]/.test(password)) {
      throw new PasswordTooWeakException(
        'Password must contain at least one letter',
      );
    }

    // Check for at least one number
    if (!/\d/.test(password)) {
      throw new PasswordTooWeakException(
        'Password must contain at least one number',
      );
    }

    // Check against common passwords (case-insensitive)
    const lowerPassword = password.toLowerCase();
    if (this.COMMON_PASSWORDS.includes(lowerPassword)) {
      throw new PasswordTooWeakException(
        'Password is too common. Please choose a stronger password',
      );
    }

    // Optional: Check for mixed case and special characters (can be enabled for stricter validation)
    // if (!/[A-Z]/.test(password)) {
    //   throw new PasswordTooWeakException('Password should contain at least one uppercase letter');
    // }
    // if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    //   throw new PasswordTooWeakException('Password should contain at least one special character');
    // }
  }
}

