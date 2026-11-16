export type Device = {
  id: string;
  name: string;
  publicKey: Uint8Array;
  pairedAt: string;
  lastSeenAt: string | null;
  manageModels: boolean;
};

export interface DeviceRepository {
  add(name: string, publicKey: Uint8Array): Promise<Device>;
  findByPublicKey(publicKey: Uint8Array): Promise<Device | null>;
  findById(id: string): Promise<Device | null>;
  list(): Promise<Device[]>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
  allowModelManagement(id: string, allowed: boolean): Promise<boolean>;
}
