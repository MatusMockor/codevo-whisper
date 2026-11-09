import type { SettingsFocus } from '../windows/settings-focus';
import type { HandlerGroup } from './invoke-handlers';
import { withoutArguments } from './without-arguments';

export type FocusHandlerDeps = { settingsFocus: Pick<SettingsFocus, 'take'> };

export function focusHandlers({ settingsFocus }: FocusHandlerDeps): HandlerGroup<'takeSettingsFocus'> {
  return {
    takeSettingsFocus: withoutArguments(() => settingsFocus.take()),
  };
}
