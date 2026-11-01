import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fingerprint, type Language } from '@codevo-whisper/protocol';
import { pairDevice, parsePairing } from './core/pairing';
import { MAX_PAIRING_TOKEN_LENGTH, PairingScanner, type ScanState } from './core/pairing-scanner';
import { native, openWire, pairingScannerNative, subscribeLanguage, vault } from './platform';
import { runRecording, type RecordingState } from './runtime';
import { parseLanguage, parseSetupStatus, setupSteps, type SetupStatus } from './core/settings';

type PairState = { kind: 'idle' } | { kind: 'connecting' } | { kind: 'approval'; connection: string; device: string; server: string };
export function App() {
  const [paired, setPaired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });
  const [scanner] = useState(() => new PairingScanner(pairingScannerNative, setScan, setToken));
  const [name, setName] = useState(Platform.OS === 'android' ? 'Android phone' : 'iPhone');
  const [pairing, setPairing] = useState<PairState>({ kind: 'idle' });
  const [language, setLanguage] = useState<Language>('auto');
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [pairingSettings, setPairingSettings] = useState(false);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const pairingAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    let mounted = true;
    let languageVersion = 0;
    const unsubscribeLanguage = subscribeLanguage((selected) => {
      languageVersion++;
      setLanguage(selected);
    }, () => setError('Voice language could not be read. Reopen Codevo Voice.'));
    void vault
      .load()
      .then((value) => {
        if (mounted) {
          setPaired(value === null ? null : fingerprint(parsePairing(value).serverPublicKey));
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Protected pairing could not be read. Remove it and pair again.');
          setLoading(false);
        }
      });
    const refresh = () => {
      const version = ++languageVersion;
      void Promise.all([native.getLanguage(), native.setupStatus()]).then(([selected, status]) => {
        const language = parseLanguage(selected);
        const setup = parseSetupStatus(status);
        if (mounted) {
          if (version === languageVersion) setLanguage(language);
          setSetup(setup);
        }
      }).catch(() => { if (mounted) { setSetup(null); setError('Setup status could not be read. Reopen Codevo Voice.'); } });
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
      if (state !== 'active') {
        pairingAbort.current?.abort();
      }
    });
    return () => {
      mounted = false;
      unsubscribeLanguage();
      scanner.cancel();
      pairingAbort.current?.abort();
      subscription.remove();
    };
  }, [scanner]);
  const failure = (error: unknown) => setError(error instanceof Error ? error.message : 'Operation failed');
  async function pair() {
    if (scanner.state.kind === 'scanning') return;
    scanner.clear();
    setError('');
    setPairing({ kind: 'connecting' });
    const abort = new AbortController();
    pairingAbort.current = abort;
    try {
      const result = await pairDevice({
        token,
        name,
        vault,
        open: openWire,
        signal: abort.signal,
        awaitingApproval: (f) => setPairing({ kind: 'approval', ...f }),
      });
      setPaired(fingerprint(result.serverPublicKey));
      setToken('');
    } catch (error) {
      failure(error);
    } finally {
      setPairing({ kind: 'idle' });
      pairingAbort.current = null;
    }
  }
  async function microphone(): Promise<boolean> {
    try {
      if (Platform.OS === 'ios') return (await native.requestMicrophone?.()) === true;
      return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) === PermissionsAndroid.RESULTS.GRANTED;
    } finally {
      setSetup(parseSetupStatus(await native.setupStatus()));
    }
  }
  async function record() {
    if (scanner.state.kind === 'scanning') return;
    setError('');
    setText('');
    setRecording('Connecting');
    try {
      if (!(await microphone())) {
        setError('Microphone permission is required. Allow it in system settings.');
        return;
      }
      const runId = await native.beginCompanion();
      setRecording('Connecting');
      setText(await runRecording(runId, setRecording));
    } catch (error) {
      failure(error);
    } finally {
      setRecording(null);
    }
  }
  const missingSteps = setup === null ? [] : setupSteps(setup);
  const busy = pairing.kind !== 'idle' || recording !== null || loading || scan.kind === 'scanning';
  const recorder = (
    <View style={styles.section}>
      <Text style={styles.heading}>Companion recorder</Text>
      <Text style={styles.body}>
        Record here to review and select text. Android voice keyboard inserts directly into the original field.
      </Text>
      <View style={styles.languages}>
        {(['auto', 'sk', 'en', 'cs'] as const).map((value) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: value === language, disabled: busy }}
            key={value}
            disabled={busy}
            onPress={() => {
              void native.setLanguage(value).catch(failure);
            }}
            style={[styles.language, language === value && styles.selected]}
          >
            <Text style={styles.buttonText}>{({ auto: 'Auto', sk: 'Slovak', en: 'English', cs: 'Czech' })[value]}</Text>
          </Pressable>
        ))}
      </View>
      {recording === null && (
        <Action
          title="Record"
          primary
          disabled={busy || !paired || setup === null}
          onPress={() => {
            void record();
          }}
        />
      )}
      {recording !== null && (
        <View>
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {recording}…
          </Text>
          <Action
            title="Stop"
            disabled={recording !== 'Recording'}
            onPress={() => {
              void native.stop().catch(failure);
            }}
          />
          <Action
            title="Cancel"
            onPress={() => {
              void native.cancel().catch(failure);
            }}
          />
        </View>
      )}
      {text !== '' && (
        <Text selectable style={styles.transcript}>
          {text}
        </Text>
      )}
      {Platform.OS === 'ios' && (
        <Text style={styles.body}>
          The iPhone keyboard extension is planned for a later release. Use this recorder while the app is open.
        </Text>
      )}
    </View>
  );
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Codevo Voice</Text>
      <Text style={styles.body}>Audio goes encrypted to your paired Codevo server. Models stay there.</Text>
      {loading && <ActivityIndicator accessibilityLabel="Loading protected pairing" color="#F0A23A" />}
      {error !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {paired && recorder}
      <View style={styles.section}>
        <Text style={styles.heading}>{paired ? 'Paired server' : '1. Pair your server'}</Text>
        {paired && (
          <Text selectable style={styles.fingerprint}>
            {paired}
          </Text>
        )}
        {paired && <Action title={pairingSettings ? 'Hide pairing settings' : 'Pairing settings'} disabled={busy} onPress={() => setPairingSettings(!pairingSettings)} />}
        {(!paired || pairingSettings) && (
          <View>
            <Text style={styles.body}>
              Run the server pairing command. Scan its QR or paste its cw1 token, compare the connection fingerprint, then approve on the server.
              Use a wss:// endpoint for release builds.
            </Text>
            <Text style={styles.label}>Pairing token</Text>
            <TextInput
              accessibilityLabel="Pairing token"
              value={token}
              onChangeText={(value) => {
                scanner.clear();
                setToken(value);
              }}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              maxLength={MAX_PAIRING_TOKEN_LENGTH}
              style={styles.input}
            />
            <Action
              title={scan.kind === 'scanning' ? 'Scanning QR…' : 'Scan QR'}
              disabled={busy}
              onPress={() => { void scanner.start(busy); }}
            />
            {scan.kind === 'result' && (
              <Text accessibilityLiveRegion="polite" style={styles.body}>
                QR scanned. Choose {paired ? 'Replace pairing' : 'Pair server'} to continue.
              </Text>
            )}
            {scan.kind === 'error' && (
              <View>
                <Text accessibilityRole="alert" style={styles.error}>{scan.message}</Text>
                {scan.settings && (
                  <Action
                    title="Open app settings"
                    disabled={busy}
                    onPress={() => {
                      void Linking.openSettings().catch(() => setError('Open Camera permission in system app settings, or paste the token.'));
                    }}
                  />
                )}
              </View>
            )}
            <Text style={styles.label}>Device name</Text>
            <TextInput
              accessibilityLabel="Device name"
              value={name}
              onChangeText={setName}
              maxLength={64}
              editable={!busy}
              style={styles.input}
            />
            <Action
              title={paired ? 'Replace pairing' : 'Pair server'}
              disabled={busy || !token.trim()}
              onPress={() => {
                void pair();
              }}
            />
            {pairing.kind === 'connecting' && <Text style={styles.body}>Authenticating server…</Text>}
            {pairing.kind === 'approval' && (
              <View>
                <Text style={styles.label}>Compare this connection fingerprint on the server</Text>
                <Text selectable style={styles.fingerprint}>
                  {pairing.connection}
                </Text>
                <Text style={styles.body}>Awaiting server operator approval.</Text>
              </View>
            )}
            {pairing.kind !== 'idle' && <Action title="Cancel pairing" onPress={() => pairingAbort.current?.abort()} />}
            <Action
              title="Remove pairing"
              disabled={busy}
              onPress={() =>
                Alert.alert('Remove this pairing?', 'You will need a new token to reconnect.', [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      void vault.remove().then(() => setPaired(null), failure);
                    },
                  },
                ])
              }
            />
          </View>
        )}
      </View>
      <View style={styles.section}>
        <Text style={styles.heading}>Microphone</Text>
        <Text style={styles.body}>
          Record only when you choose. Leaving the recorder or changing the active keyboard field cancels the recording.
        </Text>
        {setup?.microphone ? <Text style={styles.complete}>Microphone allowed</Text> : <Action
          disabled={busy || setup === null}
          title="Allow microphone"
          onPress={() => {
            void microphone().then((allowed) => {
              if (!allowed) setError('Microphone permission denied. Open app permissions in system settings.');
            }, failure);
          }}
        />}
      </View>
      {Platform.OS === 'android' && (
        <View style={styles.section}>
          <Text style={styles.heading}>Voice keyboard</Text>
          <Text style={styles.body}>
            Keep Gboard enabled. Add Codevo Voice in system settings, then choose it from the keyboard picker in any text field. Password
            fields are disabled.
          </Text>
          {setup?.keyboard === 'selected' && <Text style={styles.complete}>Voice keyboard ready</Text>}
          {setup?.keyboard === 'enabled' && <Text style={styles.complete}>Voice keyboard enabled</Text>}
          {missingSteps.includes('enableKeyboard') && <Action
            disabled={busy}
            title="Enable keyboard"
            onPress={() => {
              void native.keyboardSettings().catch(failure);
            }}
          />}
          {missingSteps.includes('selectKeyboard') && <Action
            disabled={busy}
            title="Choose keyboard"
            onPress={() => {
              void native.switchKeyboard().catch(failure);
            }}
          />}
        </View>
      )}
      {!paired && recorder}
    </ScrollView>
  );
}
function Action({ title, onPress, disabled = false, primary = false }: { title: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.button, primary && styles.primary, disabled && styles.disabled, pressed && styles.pressed, focused && styles.focused]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{title}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  page: { padding: 24, paddingTop: 64, paddingBottom: 60, backgroundColor: '#0F131B', flexGrow: 1 },
  title: { color: '#E8ECF2', fontSize: 30, fontWeight: '600', lineHeight: 38, marginBottom: 16 },
  body: { color: '#B6BFCC', fontSize: 14, lineHeight: 21, marginBottom: 16 },
  heading: { color: '#E8ECF2', fontSize: 20, fontWeight: '600', marginBottom: 14 },
  section: { borderTopWidth: 1, borderColor: '#303949', paddingTop: 20, marginTop: 20 },
  label: { color: '#E8ECF2', fontSize: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#626D7E', borderRadius: 8, padding: 14, color: '#E8ECF2', fontSize: 16, marginBottom: 16 },
  button: { backgroundColor: '#161B25', borderRadius: 8, padding: 16, minHeight: 52, justifyContent: 'center', marginBottom: 10 },
  buttonText: { color: '#E8ECF2', fontSize: 16, fontWeight: '600' },
  primary: { backgroundColor: '#F0A23A' },
  primaryText: { color: '#0F131B' },
  focused: { borderWidth: 2, borderColor: '#FFD08A' },
  disabled: { opacity: 0.4 },
  pressed: { backgroundColor: '#394557' },
  fingerprint: {
    color: '#FFD08A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 16,
  },
  complete: { color: '#FFD08A', fontSize: 14, lineHeight: 21, marginBottom: 12 },
  error: { color: '#ffb8ab', fontSize: 14, lineHeight: 21, marginVertical: 16 },
  transcript: { color: '#E8ECF2', fontSize: 20, lineHeight: 30, marginTop: 20 },
  languages: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  language: { minHeight: 48, minWidth: 48, justifyContent: 'center', padding: 12, borderWidth: 1, borderColor: '#626D7E', borderRadius: 6 },
  selected: { backgroundColor: '#161B25', borderColor: '#F0A23A' },
});
