import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { ComingSoon, SettingsGroup, SettingsRow } from './SettingsGroup';

type EngineChoice = 'local' | 'server';

const ENGINES: ReadonlyArray<SegmentOption<EngineChoice>> = [
  { id: 'local', label: 'Lokálne' },
  { id: 'server', label: 'Server', disabled: true },
];

export function EngineSection() {
  return (
    <SettingsGroup title="Kde beží prepis">
      <SettingsRow
        title="Prepis"
        description={
          <>
            Lokálne sa reč prepisuje priamo na tomto Macu, bez internetu. Server: <ComingSoon />
          </>
        }
      >
        <SegmentedControl label="Kde beží prepis" options={ENGINES} value="local" onChange={() => undefined} />
      </SettingsRow>
    </SettingsGroup>
  );
}
