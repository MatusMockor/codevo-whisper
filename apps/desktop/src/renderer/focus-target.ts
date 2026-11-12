import { sectionPage, type FocusRequest } from '../shared/section-focus';
import type { NavTarget } from './navigation';

export function focusTarget(request: FocusRequest): NavTarget {
  if (request.kind === 'setting') {
    return { page: 'settings', setting: request.setting };
  }
  return { page: sectionPage(request.section), section: request.section };
}
