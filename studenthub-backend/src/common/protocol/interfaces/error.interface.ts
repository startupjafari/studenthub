export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: any;
  timestamp: string;
}
