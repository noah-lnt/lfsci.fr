/**
 * UX-06: the assistant is a Server-Sent Events route (`POST /api/assistant`), not
 * an oRPC procedure — oRPC has no streaming transport here. Its event shape is
 * `api.assistant.AssistantEvent` in @lfsci/contracts.
 */
export const assistantContract = {};
