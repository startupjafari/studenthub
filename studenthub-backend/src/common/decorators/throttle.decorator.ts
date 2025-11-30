import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom throttle decorator for specific endpoints
 */
export const ThrottleEndpoint = (limit: number, ttl: number) => {
  return applyDecorators(
    Throttle({ default: { limit, ttl } }),
    UseGuards(ThrottlerGuard),
  );
};

