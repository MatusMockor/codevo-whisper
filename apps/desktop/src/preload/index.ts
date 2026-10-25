import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('codevo', Object.freeze({}));
