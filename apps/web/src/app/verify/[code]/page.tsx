import { VerifyDocumentView } from '../../../views/verify-document'

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function VerifyDocumentPage({ params }: PageProps) {
  const { code } = await params
  return <VerifyDocumentView code={code} />
}
