import { createZodDto } from 'nestjs-zod'
import {
  ChatAttachmentMultipartAbortSchema,
  ChatAttachmentMultipartStartSchema,
  ChatAttachmentMultipartUrlsSchema,
  ChatAttachmentPresignSchema,
  MessageSendUploadedSchema,
} from '@studenthub/shared-schemas'

export class ChatAttachmentPresignDto extends createZodDto(ChatAttachmentPresignSchema) {}
export class ChatAttachmentMultipartStartDto extends createZodDto(
  ChatAttachmentMultipartStartSchema,
) {}
export class ChatAttachmentMultipartUrlsDto extends createZodDto(
  ChatAttachmentMultipartUrlsSchema,
) {}
export class ChatAttachmentMultipartAbortDto extends createZodDto(
  ChatAttachmentMultipartAbortSchema,
) {}
export class MessageSendUploadedDto extends createZodDto(MessageSendUploadedSchema) {}
