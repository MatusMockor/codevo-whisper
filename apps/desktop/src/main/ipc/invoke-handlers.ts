import type { IpcInvokeApi } from '../../shared/ipc-contract';

export type InvokeHandlers = { readonly [K in keyof IpcInvokeApi]: (...args: unknown[]) => ReturnType<IpcInvokeApi[K]> };

export type HandlerGroup<K extends keyof IpcInvokeApi> = Pick<InvokeHandlers, K>;
