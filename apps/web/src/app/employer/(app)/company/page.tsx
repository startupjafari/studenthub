import { redirect } from 'next/navigation'

// Страница компании переехала в профиль работодателя (переключатель «Мой профиль /
// Компания»). Старый адрес из закладок и писем ведёт туда же.
export default function Page() {
  redirect('/profile?view=company')
}
