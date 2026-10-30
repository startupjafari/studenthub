/** Код наклейки экземпляра для глаз: ABCD-EFGH, как у помещений. */
export function formatCopyCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
