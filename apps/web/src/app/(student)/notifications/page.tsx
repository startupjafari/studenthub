import { redirect } from 'next/navigation'

// Уведомления больше не отдельная страница, а оверлей сайдбара (открывается пунктом «Уведомления»
// в навигации). Прямой заход по /notifications уводим на главную.
export default function Page() {
  redirect('/')
}
