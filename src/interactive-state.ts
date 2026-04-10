const lastInteractiveConversationMessageIds = new Map<string, string>();

function buildInteractiveStateKey(accountId: string, peerId: string): string {
  return `${accountId}:${peerId.trim()}`;
}

export function resolveRememberedVkInteractiveMessageId(params: {
  accountId: string;
  peerId: string;
}): string | undefined {
  return lastInteractiveConversationMessageIds.get(
    buildInteractiveStateKey(params.accountId, params.peerId),
  );
}

export function rememberVkInteractiveMessageId(params: {
  accountId: string;
  peerId: string;
  conversationMessageId: string;
}): void {
  lastInteractiveConversationMessageIds.set(
    buildInteractiveStateKey(params.accountId, params.peerId),
    params.conversationMessageId,
  );
}

export function clearVkInteractiveMessageState(): void {
  lastInteractiveConversationMessageIds.clear();
}

export function forgetVkInteractiveMessageId(params: {
  accountId: string;
  peerId: string;
}): void {
  lastInteractiveConversationMessageIds.delete(
    buildInteractiveStateKey(params.accountId, params.peerId),
  );
}

export function isVkInteractiveMessageCurrent(params: {
  accountId: string;
  peerId: string;
  conversationMessageId?: string;
}): boolean {
  const remembered = resolveRememberedVkInteractiveMessageId({
    accountId: params.accountId,
    peerId: params.peerId,
  });
  if (!remembered || !params.conversationMessageId) {
    return true;
  }
  return remembered === params.conversationMessageId;
}
