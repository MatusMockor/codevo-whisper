import type { InputHelper, Permissions } from '../helper/input-helper';
import type { Logger } from '../logging/logger';

export type PermissionsStatus = { microphone: boolean; listen: boolean; accessibility: boolean };

export type MicrophoneAccess = () => string;

const NO_INPUT_PERMISSIONS: Permissions = { listen: false, post: false, accessibility: false };

export function allGranted(status: PermissionsStatus): boolean {
  return status.microphone && status.listen && status.accessibility;
}

export class PermissionsService {
  constructor(
    private readonly helper: Pick<InputHelper, 'permissions'>,
    private readonly microphoneAccess: MicrophoneAccess,
    private readonly logger: Logger,
    private readonly inputReady: Promise<void> = Promise.resolve(),
  ) {}

  async status(): Promise<PermissionsStatus> {
    await this.inputReady;
    const input = await this.helper.permissions().catch((error: unknown) => {
      this.logger.error('The input permissions could not be read', error);
      return NO_INPUT_PERMISSIONS;
    });
    return { microphone: this.microphoneAccess() === 'granted', listen: input.listen, accessibility: input.accessibility };
  }
}
