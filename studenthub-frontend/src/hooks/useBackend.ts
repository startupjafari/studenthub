import { useMemo } from "react";

import { endpoints } from "@/api/endpoints";
import { useApiClient } from "@/hooks/useApiClient";

type UploadPayload = {
  field?: string;
  file: File;
  extra?: Record<string, string>;
};

const buildFormData = ({ field = "file", file, extra }: UploadPayload) => {
  const formData = new FormData();
  formData.append(field, file);
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => {
      formData.append(key, value);
    });
  }
  return formData;
};

export const useBackend = () => {
  const client = useApiClient();

  const auth = useMemo(
    () => ({
      register: (data: unknown) => client.post(endpoints.auth.register, data),
      verifyEmail: (data: unknown) => client.post(endpoints.auth.verifyEmail, data),
      resendVerification: (email: string) =>
        client.post(endpoints.auth.resendVerification, { email }),
      login: (data: unknown) => client.post(endpoints.auth.login, data),
      verify2fa: (data: unknown) => client.post(endpoints.auth.verify2fa, data),
      refresh: (data: unknown) => client.post(endpoints.auth.refresh, data),
      logout: (data: unknown) => client.post(endpoints.auth.logout, data),
      logoutAll: () => client.post(endpoints.auth.logoutAll),
      me: () => client.get(endpoints.auth.me),
      forgotPassword: (data: unknown) => client.post(endpoints.auth.forgotPassword, data),
      resetPassword: (data: unknown) => client.post(endpoints.auth.resetPassword, data),
      changePassword: (data: unknown) => client.put(endpoints.auth.changePassword, data),
      generate2fa: () => client.post(endpoints.auth.generate2fa),
      enable2fa: (data: unknown) => client.post(endpoints.auth.enable2fa, data),
      disable2fa: (data: unknown) => client.post(endpoints.auth.disable2fa, data),
    }),
    [client],
  );

  const users = useMemo(
    () => ({
      me: () => client.get(endpoints.users.me),
      getById: (id: string) => client.get(endpoints.users.byId(id)),
      updateMe: (data: unknown) => client.put(endpoints.users.me, data),
      search: (params?: Record<string, unknown>) =>
        client.get(endpoints.users.search, params),
      uploadAvatar: (payload: UploadPayload) =>
        client.upload(endpoints.users.avatar, buildFormData(payload)),
      deleteMe: () => client.del(endpoints.users.me),
    }),
    [client],
  );

  const posts = useMemo(
    () => ({
      create: (data: unknown) => client.post(endpoints.posts.base, data),
      list: (params?: Record<string, unknown>) => client.get(endpoints.posts.base, params),
      getById: (id: string) => client.get(endpoints.posts.byId(id)),
      getUserPosts: (userId: string, params?: Record<string, unknown>) =>
        client.get(endpoints.posts.userPosts(userId), params),
      update: (id: string, data: unknown) => client.put(endpoints.posts.byId(id), data),
      remove: (id: string) => client.del(endpoints.posts.byId(id)),
    }),
    [client],
  );

  const comments = useMemo(
    () => ({
      create: (postId: string, data: unknown) =>
        client.post(endpoints.comments.base(postId), data),
      list: (postId: string, params?: Record<string, unknown>) =>
        client.get(endpoints.comments.base(postId), params),
      update: (postId: string, id: string, data: unknown) =>
        client.put(endpoints.comments.byId(postId, id), data),
      remove: (postId: string, id: string) => client.del(endpoints.comments.byId(postId, id)),
    }),
    [client],
  );

  const reactions = useMemo(
    () => ({
      addPost: (postId: string, data: unknown) =>
        client.post(endpoints.reactions.postBase(postId), data),
      removePost: (postId: string, type: string) =>
        client.del(endpoints.reactions.postByType(postId, type)),
      listPost: (postId: string) => client.get(endpoints.reactions.postBase(postId)),
      addComment: (commentId: string, data: unknown) =>
        client.post(endpoints.reactions.commentBase(commentId), data),
      removeComment: (commentId: string, type: string) =>
        client.del(endpoints.reactions.commentByType(commentId, type)),
      listComment: (commentId: string) => client.get(endpoints.reactions.commentBase(commentId)),
    }),
    [client],
  );

  const groups = useMemo(
    () => ({
      create: (data: unknown) => client.post(endpoints.groups.base, data),
      list: () => client.get(endpoints.groups.base),
      getById: (id: string) => client.get(endpoints.groups.byId(id)),
      update: (id: string, data: unknown) => client.put(endpoints.groups.byId(id), data),
      remove: (id: string) => client.del(endpoints.groups.byId(id)),
      addMember: (id: string, data: unknown) => client.post(endpoints.groups.members(id), data),
      members: (id: string, params?: Record<string, unknown>) =>
        client.get(endpoints.groups.members(id), params),
      removeMember: (id: string, userId: string) =>
        client.del(endpoints.groups.memberById(id, userId)),
      updateMemberRole: (id: string, userId: string, data: unknown) =>
        client.patch(endpoints.groups.memberRole(id, userId), data),
    }),
    [client],
  );

  const groupMessages = useMemo(
    () => ({
      send: (groupId: string, data: unknown) =>
        client.post(endpoints.groupMessages.base(groupId), data),
      list: (groupId: string, params?: Record<string, unknown>) =>
        client.get(endpoints.groupMessages.base(groupId), params),
      update: (groupId: string, messageId: string, data: unknown) =>
        client.put(endpoints.groupMessages.byId(groupId, messageId), data),
      remove: (groupId: string, messageId: string) =>
        client.del(endpoints.groupMessages.byId(groupId, messageId)),
    }),
    [client],
  );

  const conversations = useMemo(
    () => ({
      create: (data: unknown) => client.post(endpoints.conversations.base, data),
      list: () => client.get(endpoints.conversations.base),
      getById: (id: string) => client.get(endpoints.conversations.byId(id)),
      archive: (id: string) => client.patch(endpoints.conversations.archive(id)),
    }),
    [client],
  );

  const messages = useMemo(
    () => ({
      send: (conversationId: string, data: unknown) =>
        client.post(endpoints.messages.base(conversationId), data),
      list: (conversationId: string, params?: Record<string, unknown>) =>
        client.get(endpoints.messages.base(conversationId), params),
      update: (conversationId: string, messageId: string, data: unknown) =>
        client.put(endpoints.messages.byId(conversationId, messageId), data),
      remove: (conversationId: string, messageId: string) =>
        client.del(endpoints.messages.byId(conversationId, messageId)),
    }),
    [client],
  );

  const notifications = useMemo(
    () => ({
      list: (params?: Record<string, unknown>) =>
        client.get(endpoints.notifications.base, params),
      unreadCount: () => client.get(endpoints.notifications.unread),
      markRead: (id: string) => client.patch(endpoints.notifications.markRead(id)),
      remove: (id: string) => client.del(endpoints.notifications.byId(id)),
      clearAll: () => client.del(endpoints.notifications.base),
    }),
    [client],
  );

  const events = useMemo(
    () => ({
      create: (data: unknown) => client.post(endpoints.events.base, data),
      list: (params?: Record<string, unknown>) => client.get(endpoints.events.base, params),
      getById: (id: string) => client.get(endpoints.events.byId(id)),
      update: (id: string, data: unknown) => client.put(endpoints.events.byId(id), data),
      remove: (id: string) => client.del(endpoints.events.byId(id)),
    }),
    [client],
  );

  const friends = useMemo(
    () => ({
      sendRequest: (data: unknown) => client.post(endpoints.friends.requests, data),
      incoming: () => client.get(endpoints.friends.requests),
      sent: () => client.get(endpoints.friends.requestsSent),
      accept: (id: string) => client.patch(endpoints.friends.acceptRequest(id)),
      reject: (id: string) => client.patch(endpoints.friends.rejectRequest(id)),
      remove: (id: string) => client.del(endpoints.friends.byId(id)),
      userFriends: (id: string) => client.get(endpoints.friends.userFriends(id)),
    }),
    [client],
  );

  const presence = useMemo(
    () => ({
      get: () => client.get(endpoints.presence.base),
      update: (data: unknown) => client.put(endpoints.presence.base, data),
      getUsers: (userIds: string[]) => client.get(endpoints.presence.users(userIds.join(","))),
    }),
    [client],
  );

  const stories = useMemo(
    () => ({
      create: (data: unknown) => client.post(endpoints.stories.base, data),
      list: () => client.get(endpoints.stories.base),
      getById: (id: string) => client.get(endpoints.stories.byId(id)),
      remove: (id: string) => client.del(endpoints.stories.byId(id)),
      views: (id: string) => client.get(endpoints.stories.views(id)),
    }),
    [client],
  );

  const schedules = useMemo(
    () => ({
      create: (data: unknown) => client.post(endpoints.schedules.base, data),
      list: (params?: Record<string, unknown>) =>
        client.get(endpoints.schedules.base, params),
      getById: (id: string) => client.get(endpoints.schedules.byId(id)),
      update: (id: string, data: unknown) => client.put(endpoints.schedules.byId(id), data),
      remove: (id: string) => client.del(endpoints.schedules.byId(id)),
    }),
    [client],
  );

  return {
    client,
    auth,
    users,
    posts,
    comments,
    reactions,
    groups,
    groupMessages,
    conversations,
    messages,
    notifications,
    events,
    friends,
    presence,
    stories,
    schedules,
  };
};
