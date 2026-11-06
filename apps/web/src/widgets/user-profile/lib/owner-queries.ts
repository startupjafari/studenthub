import {
  contentOwnerKey,
  fetchOwnerAlbums,
  fetchOwnerArticles,
  fetchOwnerCounts,
  fetchOwnerMedia,
  profileContentKeys,
  type ContentOwner,
} from '../../../entities/profile-content'
import {
  fetchPollsByCompany,
  fetchPollsByUniversity,
  fetchPollsByUser,
  pollKeys,
} from '../../../entities/poll'

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
  if (owner.kind === 'company') return pollKeys.byCompany(owner.id)
  if (owner.kind === 'university') return pollKeys.byUniversity(owner.id)
  return pollKeys.byUser(owner.id)
}

export function ownerPollsQuery(owner: ContentOwner) {
  const fetchPolls =
    owner.kind === 'company'
      ? fetchPollsByCompany
      : owner.kind === 'university'
        ? fetchPollsByUniversity
        : fetchPollsByUser
  return { queryKey: ownerPollsKey(owner), queryFn: () => fetchPolls(owner.id) }
}

export function ownerCountsKey(owner: ContentOwner) {
  return profileContentKeys.counts(contentOwnerKey(owner))
}

export function fetchCountsOf(owner: ContentOwner) {
  return fetchOwnerCounts(owner)
}
