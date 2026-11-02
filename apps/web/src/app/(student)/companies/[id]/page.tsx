import { CompanyPageView } from '../../../../views/company'

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CompanyPageView companyId={id} />
}
