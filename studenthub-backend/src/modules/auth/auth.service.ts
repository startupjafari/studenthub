import {
  Injectable,
  Logger,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { EmailVerificationService } from './services/email-verification.service';
import { TwoFactorService } from './services/2fa.service';
import {
  InvalidCredentialsException,
  EmailAlreadyExistsException,
  EmailNotVerifiedException,
  TwoFactorRequiredException,
  InvalidTwoFactorCodeException,
  SamePasswordException,
} from '../../common/exceptions/auth.exceptions';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponse, TokenResponse } from '../../common/interfaces/auth-response.interface';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/modules/redis.module';
import { UserRole, UserStatus } from '../../common/constants/prisma-enums';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly twoFactorService: TwoFactorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Register a new user
   */
  async register(registerDto: RegisterDto): Promise<{ message: string; email: string }> {
    // Validate password strength
    this.passwordService.validatePasswordStrength(registerDto.password);

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new EmailAlreadyExistsException(registerDto.email);
    }

    // Hash password
    const passwordHash = await this.passwordService.hashPassword(
      registerDto.password,
    );

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email,
        passwordHash,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        role: registerDto.role || UserRole.STUDENT,
        emailVerified: false,
      },
    });

    // Generate and send verification code
    const code = await this.emailVerificationService.generateVerificationCode(
      registerDto.email,
    );
    await this.emailVerificationService.sendVerificationEmail(
      registerDto.email,
      code,
    );

    this.logger.log(`New user registered: ${user.email} (${user.id})`);

    return {
      message: 'Registration successful. Please check your email for verification code.',
      email: user.email,
    };
  }

  /**
   * Verify email with code
   */
  async verifyEmail(email: string, code: string): Promise<{ message: string }> {
    await this.emailVerificationService.verifyCode(email, code);

    await this.prisma.user.update({
      where: { email },
      data: { emailVerified: true },
    });

    this.logger.log(`Email verified: ${email}`);

    return { message: 'Email verified successfully' };
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if email exists for security
      return { message: 'If email exists, verification code has been sent' };
    }

    if (user.emailVerified) {
      return { message: 'Email is already verified' };
    }

    const code = await this.emailVerificationService.generateVerificationCode(
      email,
    );
    await this.emailVerificationService.sendVerificationEmail(email, code);

    this.logger.log(`Verification email resent: ${email}`);

    return { message: 'Verification code has been sent to your email' };
  }

  /**
   * Validate user credentials (for LocalStrategy)
   */
  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await this.passwordService.comparePasswords(
      password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      return null;
    }

    // Check if user is active
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    // Don't return password hash
    const { passwordHash, ...result } = user;
    return result;
  }

  /**
   * Login user
   */
  async login(loginDto: LoginDto, ip: string): Promise<AuthResponse | { requiresTwoFactor: boolean; temporaryToken: string }> {
    // Rate limiting is handled by ThrottlerGuard with @Throttle decorator

    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      this.logger.warn(`Failed login attempt for email: ${loginDto.email} (user not found)`);
      throw new InvalidCredentialsException();
    }

    const isPasswordValid = await this.passwordService.comparePasswords(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      this.logger.warn(`Failed login attempt for email: ${loginDto.email} (invalid password)`);
      throw new InvalidCredentialsException();
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    if (!user.emailVerified) {
      throw new EmailNotVerifiedException();
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      if (!loginDto.twoFactorCode) {
        // Generate temporary token for 2FA verification
        const temporaryToken = this.tokenService.generateAccessToken(
          user.id,
          user.email,
          user.role,
        );
        
        // Store temporary token in Redis for 2FA verification (short TTL)
        await this.redis.setex(`2fa:temp:${user.id}`, 300, temporaryToken); // 5 minutes

        return {
          requiresTwoFactor: true,
          temporaryToken,
        };
      }

      // Verify 2FA code
      const secret = user.twoFactorSecret;
      if (!secret) {
        throw new InvalidTwoFactorCodeException();
      }

      const isValid = this.twoFactorService.verifyToken(
        secret,
        loginDto.twoFactorCode,
      );

      if (!isValid) {
        this.logger.warn(`Failed 2FA verification for user: ${user.id}`);
        throw new InvalidTwoFactorCodeException();
      }

      // Clean up temporary token
      await this.redis.del(`2fa:temp:${user.id}`);
    }

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken(
      user.id,
      user.email,
      user.role,
    );
    const refreshToken = await this.tokenService.generateRefreshToken(user.id);

    this.logger.log(`User logged in: ${user.email} (${user.id})`);

    const { passwordHash, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Verify 2FA during login
   */
  async verify2FALogin(
    userId: string,
    code: string,
    temporaryToken: string,
  ): Promise<AuthResponse> {
    // Verify temporary token
    const storedToken = await this.redis.get(`2fa:temp:${userId}`);
    if (!storedToken || storedToken !== temporaryToken) {
      throw new InvalidCredentialsException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new InvalidTwoFactorCodeException();
    }

    const isValid = this.twoFactorService.verifyToken(
      user.twoFactorSecret,
      code,
    );

    if (!isValid) {
      throw new InvalidTwoFactorCodeException();
    }

    // Clean up temporary token
    await this.redis.del(`2fa:temp:${userId}`);

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken(
      user.id,
      user.email,
      user.role,
    );
    const refreshToken = await this.tokenService.generateRefreshToken(user.id);

    this.logger.log(`2FA login successful: ${user.email} (${user.id})`);

    const { passwordHash, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken);

    // Generate new tokens
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new InvalidCredentialsException();
    }

    // Revoke old refresh token
    await this.tokenService.revokeRefreshToken(refreshToken);

    // Generate new tokens
    const newAccessToken = this.tokenService.generateAccessToken(
      user.id,
      user.email,
      user.role,
    );
    const newRefreshToken = await this.tokenService.generateRefreshToken(user.id);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout user
   */
  async logout(refreshToken: string, userId?: string): Promise<{ message: string }> {
    await this.tokenService.revokeRefreshToken(refreshToken);
    
    this.logger.log(`User logged out: ${userId || 'unknown'}`);

    return { message: 'Logged out successfully' };
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.tokenService.revokeAllRefreshTokens(userId);
    
    this.logger.log(`User logged out from all devices: ${userId}`);

    return { message: 'Logged out from all devices successfully' };
  }

  /**
   * Get current user
   */
  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        firstName: true,
        lastName: true,
        avatar: true,
        bio: true,
        birthDate: true,
        role: true,
        status: true,
        emailVerified: true,
        phoneVerified: true,
        twoFactorEnabled: true,
        universityId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Forgot password - send reset code
   */
  async forgotPassword(email: string, ip: string): Promise<{ message: string }> {
    // Rate limiting is handled by ThrottlerGuard with @Throttle decorator

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if email exists for security
      return {
        message: 'If email exists, password reset code has been sent',
      };
    }

    const code = await this.emailVerificationService.generatePasswordResetCode(
      email,
    );
    await this.emailVerificationService.sendPasswordResetEmail(email, code);

    this.logger.log(`Password reset code sent: ${email}`);

    return {
      message: 'If email exists, password reset code has been sent',
    };
  }

  /**
   * Reset password with code
   */
  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    // Verify code
    await this.emailVerificationService.verifyResetCode(email, code);

    // Validate password strength
    this.passwordService.validatePasswordStrength(newPassword);

    // Get user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new InvalidCredentialsException();
    }

    // Check if new password is different
    const isSamePassword = await this.passwordService.comparePasswords(
      newPassword,
      user.passwordHash,
    );

    if (isSamePassword) {
      throw new SamePasswordException();
    }

    // Hash new password
    const passwordHash = await this.passwordService.hashPassword(newPassword);

    // Update password
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Revoke all refresh tokens for security
    await this.tokenService.revokeAllRefreshTokens(user.id);

    this.logger.log(`Password reset successful: ${email}`);

    return { message: 'Password reset successfully' };
  }

  /**
   * Change password (requires current password)
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify current password
    const isPasswordValid = await this.passwordService.comparePasswords(
      currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new InvalidCredentialsException('Current password is incorrect');
    }

    // Validate new password strength
    this.passwordService.validatePasswordStrength(newPassword);

    // Check if new password is different
    const isSamePassword = await this.passwordService.comparePasswords(
      newPassword,
      user.passwordHash,
    );

    if (isSamePassword) {
      throw new SamePasswordException();
    }

    // Hash new password
    const passwordHash = await this.passwordService.hashPassword(newPassword);

    // Update password
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    this.logger.log(`Password changed for user: ${userId}`);

    return { message: 'Password changed successfully' };
  }

  /**
   * Generate 2FA secret and QR code
   */
  async generate2FA(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.twoFactorEnabled) {
      throw new Error('2FA is already enabled');
    }

    const secret = this.twoFactorService.generateSecret(user.email);
    const qrCode = await this.twoFactorService.generateQRCode(
      secret,
      user.email,
    );

    // Store secret temporarily (will be saved after verification)
    await this.redis.setex(`2fa:setup:${userId}`, 600, secret); // 10 minutes

    return {
      secret,
      qrCode,
    };
  }

  /**
   * Enable 2FA
   */
  async enable2FA(userId: string, code: string): Promise<{ message: string }> {
    // Get temporary secret
    const secret = await this.redis.get(`2fa:setup:${userId}`);
    if (!secret) {
      throw new Error('2FA setup session expired. Please generate a new QR code.');
    }

    // Verify code
    const isValid = this.twoFactorService.verifyToken(secret, code);
    if (!isValid) {
      throw new InvalidTwoFactorCodeException();
    }

    // Enable 2FA
    await this.twoFactorService.enableTwoFactor(userId, secret);

    // Clean up temporary secret
    await this.redis.del(`2fa:setup:${userId}`);

    this.logger.log(`2FA enabled for user: ${userId}`);

    return { message: '2FA enabled successfully' };
  }

  /**
   * Disable 2FA
   */
  async disable2FA(userId: string, code: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new Error('2FA is not enabled');
    }

    // Verify code
    const isValid = this.twoFactorService.verifyToken(
      user.twoFactorSecret,
      code,
    );
    if (!isValid) {
      throw new InvalidTwoFactorCodeException();
    }

    // Disable 2FA
    await this.twoFactorService.disableTwoFactor(userId);

    this.logger.log(`2FA disabled for user: ${userId}`);

    return { message: '2FA disabled successfully' };
  }
}

