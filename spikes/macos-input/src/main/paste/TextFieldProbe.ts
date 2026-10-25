import type { FocusedElementInfo, InputHelper } from '../helper/InputHelper.js'

export interface TextFieldProbe {
  inspect(): Promise<FocusedElementInfo>
}

export class HelperTextFieldProbe implements TextFieldProbe {
  constructor(private readonly helper: Pick<InputHelper, 'focusedElement'>) {}

  async inspect(): Promise<FocusedElementInfo> {
    try {
      return await this.helper.focusedElement()
    } catch (error) {
      return { editable: null, role: null, subrole: null, reason: `helper-error:${String(error)}` }
    }
  }
}
