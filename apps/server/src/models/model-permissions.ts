import type { DeviceRepository } from '../devices/device-repository';

export interface ModelPermissions {
  canManageModels(deviceId: string): Promise<boolean>;
}

export class DeviceModelPermissions implements ModelPermissions {
  constructor(private readonly devices: Pick<DeviceRepository, 'findById'>) {}

  async canManageModels(deviceId: string): Promise<boolean> {
    const device = await this.devices.findById(deviceId).catch(() => null);
    return device?.manageModels === true;
  }
}
