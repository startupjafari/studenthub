import { ApiError } from './error.interface';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface ApiSuccessResponse<T> extends ApiResponse<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorResponse extends ApiResponse {
  success: false;
  error: ApiError;
  meta?: ApiMeta;
}

export interface ApiMeta {
  timestamp: string;
  version?: string;
  requestId?: string;
  [key: string]: any;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

