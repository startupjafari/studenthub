import { ApiSuccessResponse, ApiMeta } from '../interfaces/response.interface';

export class ResponseUtil {
  static success<T>(
    data: T,
    meta?: Partial<ApiMeta>,
  ): ApiSuccessResponse<T> {
    return {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    };
  }

  static paginated<T>(
    items: T[],
    pagination: {
      page: number;
      limit: number;
      total: number;
    },
    meta?: Partial<ApiMeta>,
  ): ApiSuccessResponse<{
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    return {
      success: true,
      data: {
        items,
        pagination: {
          ...pagination,
          totalPages: Math.ceil(pagination.total / pagination.limit),
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    };
  }
}
