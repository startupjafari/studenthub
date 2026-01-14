import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorResponse } from '../interfaces/response.interface';
import { ErrorCode, ERROR_MESSAGES } from '../constants/error-codes.constant';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const requestId = (request as any).id || request.headers['x-request-id'];

    let statusCode: number;
    let errorCode: string;
    let message: string;
    let details: any;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorCode = this.getErrorCodeFromStatus(statusCode);
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || exception.message;
        errorCode = responseObj.code || this.getErrorCodeFromStatus(statusCode);
        details = responseObj.details;
      } else {
        message = exception.message;
        errorCode = this.getErrorCodeFromStatus(statusCode);
      }
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
      message = ERROR_MESSAGES[ErrorCode.INTERNAL_SERVER_ERROR];
      
      this.logger.error(
        `Unexpected error: ${exception}`,
        (exception as Error).stack,
        `${request.method} ${request.url}`,
      );
    }

    const errorResponse: ApiErrorResponse = {
      success: false,
      error: {
        code: errorCode,
        message: this.getErrorMessage(errorCode, message),
        statusCode,
        details,
        timestamp: new Date().toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId,
        version: process.env.API_VERSION || '1.0',
      },
    };

    response.status(statusCode).json(errorResponse);
  }

  private getErrorCodeFromStatus(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.AUTH_REQUIRED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.RESOURCE_ALREADY_EXISTS;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return ErrorCode.INTERNAL_SERVER_ERROR;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }

  private getErrorMessage(code: string, defaultMessage: string): string {
    return ERROR_MESSAGES[code as ErrorCode] || defaultMessage;
  }
}

