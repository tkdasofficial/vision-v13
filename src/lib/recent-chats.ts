type ChatPlacement = { projectId?: string | null; pinned?: boolean; createdAt?: number };

/** Moving between workspaces never changes a chat's original chronological position. */
function orderedChats<T extends ChatPlacement>(chats: T[]): T[] {
  return [...chats].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Chats shown under Recent belong to no project. */
export function recentChats<T extends ChatPlacement>(chats: T[]): T[] {
  return orderedChats(chats.filter((c) => !c.projectId));
}

export function projectChats<T extends ChatPlacement>(chats: T[], projectId: string): T[] {
  return orderedChats(chats.filter((c) => c.projectId === projectId));
}
