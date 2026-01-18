export const endpoints = {
  auth: {
    register: "/auth/register",
    verifyEmail: "/auth/verify-email",
    resendVerification: "/auth/resend-verification",
    login: "/auth/login",
    verify2fa: "/auth/2fa/verify",
    refresh: "/auth/refresh",
    logout: "/auth/logout",
    logoutAll: "/auth/logout-all",
    me: "/auth/me",
    forgotPassword: "/auth/forgot-password",
    resetPassword: "/auth/reset-password",
    changePassword: "/auth/change-password",
    generate2fa: "/auth/2fa/generate",
    enable2fa: "/auth/2fa/enable",
    disable2fa: "/auth/2fa/disable",
  },
  users: {
    me: "/users/me",
    byId: (id: string) => `/users/${id}`,
    search: "/users/search",
    avatar: "/users/avatar",
  },
  posts: {
    base: "/posts",
    byId: (id: string) => `/posts/${id}`,
    userPosts: (userId: string) => `/posts/users/${userId}/posts`,
  },
  comments: {
    base: (postId: string) => `/posts/${postId}/comments`,
    byId: (postId: string, id: string) => `/posts/${postId}/comments/${id}`,
  },
  reactions: {
    postBase: (postId: string) => `/posts/${postId}/reactions`,
    postByType: (postId: string, type: string) => `/posts/${postId}/reactions/${type}`,
    commentBase: (commentId: string) => `/comments/${commentId}/reactions`,
    commentByType: (commentId: string, type: string) =>
      `/comments/${commentId}/reactions/${type}`,
  },
  groups: {
    base: "/groups",
    byId: (id: string) => `/groups/${id}`,
    members: (id: string) => `/groups/${id}/members`,
    memberById: (id: string, userId: string) => `/groups/${id}/members/${userId}`,
    memberRole: (id: string, userId: string) => `/groups/${id}/members/${userId}/role`,
  },
  groupMessages: {
    base: (groupId: string) => `/groups/${groupId}/messages`,
    byId: (groupId: string, messageId: string) =>
      `/groups/${groupId}/messages/${messageId}`,
  },
  conversations: {
    base: "/conversations",
    byId: (id: string) => `/conversations/${id}`,
    archive: (id: string) => `/conversations/${id}/archive`,
  },
  messages: {
    base: (conversationId: string) => `/conversations/${conversationId}/messages`,
    byId: (conversationId: string, messageId: string) =>
      `/conversations/${conversationId}/messages/${messageId}`,
  },
  notifications: {
    base: "/notifications",
    unread: "/notifications/unread",
    byId: (id: string) => `/notifications/${id}`,
    markRead: (id: string) => `/notifications/${id}/read`,
  },
  events: {
    base: "/events",
    byId: (id: string) => `/events/${id}`,
  },
  friends: {
    requests: "/friends/requests",
    requestsSent: "/friends/requests/sent",
    requestById: (id: string) => `/friends/requests/${id}`,
    acceptRequest: (id: string) => `/friends/requests/${id}/accept`,
    rejectRequest: (id: string) => `/friends/requests/${id}/reject`,
    byId: (id: string) => `/friends/${id}`,
    userFriends: (id: string) => `/friends/users/${id}/friends`,
  },
  presence: {
    base: "/presence",
    users: (userIds: string) => `/presence/users/${userIds}`,
  },
  stories: {
    base: "/stories",
    byId: (id: string) => `/stories/${id}`,
    views: (id: string) => `/stories/${id}/views`,
  },
  schedules: {
    base: "/schedules",
    byId: (id: string) => `/schedules/${id}`,
  },
  admin: {
    base: "/admin",
  },
  documents: {
    base: "/documents",
  },
  media: {
    base: "/media",
  },
  mentions: {
    base: "/mentions",
  },
  moderation: {
    base: "/moderation",
  },
  push: {
    base: "/push",
  },
  tags: {
    base: "/tags",
  },
  universities: {
    base: "/universities",
    byId: (id: string) => `/universities/${id}`,
  },
  health: {
    base: "/health",
  },
};
