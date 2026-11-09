import type { IPC, EVENTS, IpcChannel } from '../shared/ipc';

declare global {
  interface Window {
    api: {
      IPC: typeof IPC;
      EVENTS: typeof EVENTS;
      invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T>;
      on<T = unknown>(channel: string, cb: (payload: T) => void): () => void;
    };
  }
}

export {};
