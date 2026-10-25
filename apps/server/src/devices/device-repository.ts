export type Device = {
  id: string;
  name: string;
  publicKey: Uint8Array;
  pairedAt: string;
  lastSeenAt: string | null;
};

export interface DeviceRepository {
  add(name: string, publicKey: Uint8Array): Promise<Device>;
  findByPublicKey(publicKey: Uint8Array): Promise<Device | null>;
  list(): Promise<Device[]>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
}
