import {
  contentOwnerKey,
  fetchOwnerAlbums,
  fetchOwnerArticles,
  fetchOwnerCounts,
  fetchOwnerMedia,
  profileContentKeys,
  type ContentOwner,
} from '../../../entities/profile-content'
import { fetchPollsByCompany, fetchPollsByUser, pollKeys } from '../../../entities/poll'

// Запросы вкладок профиля по владельцу контента (пользователь или страница компании). Ключи
// общие для вкладки и бейджа на ней (ProfileTabs) — список грузится один раз на оба места.

export function ownerMediaQuery(owner: ContentOwner) {
  return {
    queryKey: profileContentKeys.media(contentOwnerKey(owner)),
    queryFn: () => fetchOwnerMedia(owner),
  }
}

export function ownerAlbumsQuery(owner: ContentOwner) {
  return {
    queryKey: profileContentKeys.albums(contentOwnerKey(owner)),
    queryFn: () => fetchOwnerAlbums(owner),
  }
}

export function ownerArticlesQuery(owner: ContentOwner) {
  return {
    queryKey: profileContentKeys.articles(contentOwnerKey(owner)),
    queryFn: () => fetchOwnerArticles(owner),
  }
}

export function ownerPollsKey(owner: ContentOwner) {
  return owner.kind === 'company' ? pollKeys.byCompany(owner.id) : pollKeys.byUser(owner.id)
}

export function ownerPollsQuery(owner: ContentOwner) {
  return {
    queryKey: ownerPollsKey(owner),
    queryFn: () =>
      owner.kind === 'company' ? fetchPollsByCompany(owner.id) : fetchPollsByUser(owner.id),
  }
}

export function ownerCountsKey(owner: ContentOwner) {
  return profileContentKeys.counts(contentOwnerKey(owner))
}

export function fetchCountsOf(owner: ContentOwner) {
  return fetchOwnerCounts(owner)
}
