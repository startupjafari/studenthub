import { PublicResumeView } from '../../../../views/career'

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <PublicResumeView slug={slug} />
}
