import { DeanApplicationsView } from '../../../../widgets/applications'

// Модератор вуза по политике заявок вправе их обрабатывать (read:university + process), а
// экрана не было — заявки вуза видели только деканат и админ. Очередь та же, что у них.
export default function Page() {
  return <DeanApplicationsView />
}
