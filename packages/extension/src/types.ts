export type ExtensionEventPayload = object;

export interface ExtensionEvent<T extends ExtensionEventPayload = ExtensionEventPayload> {
  channelId: string;
  requestId: string;
  method: string;
  payload?: T;
  error?: string;
}
