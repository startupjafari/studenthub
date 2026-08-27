import { PostPageView } from '../../../../views/post'

// Постоянная ссылка на публикацию: /posts/<id>. Группа (student) не добавляет сегмент
// в адрес, а её оболочка доступна всем ролям — как и /profile/<id>.
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PostPageView postId={id} />
}
