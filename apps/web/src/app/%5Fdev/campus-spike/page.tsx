import { CampusSpikeLoader } from './campus-spike-loader'

// Спайк задачи 22.2 (docs/CAMPUS_BUILDER.md): three + earcut на синтетическом кампусе. Ветка
// `spike/campus-3d`, в прод не идёт. Параметры — в адресе: ?b=корпусов&f=этажей&r=комнат.
export default function CampusSpikePage() {
  return <CampusSpikeLoader />
}
