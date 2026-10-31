import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
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
import { native, openWire, vault } from './platform';
import { runRecording, type RecordingState } from './runtime';

type PairState = { kind: 'idle' } | { kind: 'connecting' } | { kind: 'approval'; connection: string; device: string; server: string };
export function App() {
  const [paired, setPaired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [name, setName] = useState(Platform.OS === 'android' ? 'Android phone' : 'iPhone');
  const [pairing, setPairing] = useState<PairState>({ kind: 'idle' });
  const [language, setLanguage] = useState<Language>('auto');
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const pairingAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    let mounted = true;
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
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        pairingAbort.current?.abort();
      }
    });
    return () => {
      mounted = false;
      pairingAbort.current?.abort();
      subscription.remove();
    };
  }, []);
  const failure = (error: unknown) => setError(error instanceof Error ? error.message : 'Operation failed');
  async function pair() {
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
    if (Platform.OS === 'ios') {
      return (await native.requestMicrophone?.()) === true;
    }
    return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) === PermissionsAndroid.RESULTS.GRANTED;
  }
  async function record() {
    setError('');
    setText('');
    try {
      if (!(await microphone())) {
        setError('Microphone permission is required. Allow it in system settings.');
        return;
      }
      const runId = await native.beginCompanion();
      setRecording('Connecting');
      setText(await runRecording(runId, language, setRecording));
    } catch (error) {
      failure(error);
    } finally {
      setRecording(null);
    }
  }
  const busy = pairing.kind !== 'idle' || recording !== null || loading;
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Codevo Voice</Text>
      <Text style={styles.body}>Audio goes encrypted to your paired Codevo server. Models stay there.</Text>
      {loading && <ActivityIndicator accessibilityLabel="Loading protected pairing" color="#99dfc3" />}
      {error !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.section}>
        <Text style={styles.heading}>{paired ? 'Paired server' : '1. Pair your server'}</Text>
        {paired && (
          <Text selectable style={styles.fingerprint}>
            {paired}
          </Text>
        )}
        <Text style={styles.body}>
          Run the server pairing command. Paste its cw1 token, compare the connection fingerprint, then approve on the server. Use a wss://
          endpoint for release builds.
        </Text>
        <Text style={styles.label}>Pairing token</Text>
        <TextInput
          accessibilityLabel="Pairing token"
          value={token}
          onChangeText={setToken}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />
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
      <View style={styles.section}>
        <Text style={styles.heading}>2. Allow microphone</Text>
        <Text style={styles.body}>
          Record only when you choose. Leaving the recorder or changing the active keyboard field cancels the recording.
        </Text>
        <Action
          title="Allow microphone"
          onPress={() => {
            void microphone().then((allowed) => {
              if (!allowed) setError('Microphone permission denied. Open app permissions in system settings.');
            }, failure);
          }}
        />
      </View>
      {Platform.OS === 'android' && (
        <View style={styles.section}>
          <Text style={styles.heading}>3. Enable voice keyboard</Text>
          <Text style={styles.body}>
            Keep Gboard enabled. Add Codevo Voice in system settings, then choose it from the keyboard picker in any text field. Password
            fields are disabled.
          </Text>
          <Action
            title="Enable keyboard"
            onPress={() => {
              void native.keyboardSettings().catch(failure);
            }}
          />
          <Action
            title="Choose keyboard"
            onPress={() => {
              void native.switchKeyboard().catch(failure);
            }}
          />
        </View>
      )}
      <View style={styles.section}>
        <Text style={styles.heading}>Companion recorder</Text>
        <Text style={styles.body}>
          Record here to review and select text. Android voice keyboard inserts directly into the original field.
        </Text>
        <View style={styles.languages}>
          {(['auto', 'sk', 'en', 'cs'] as const).map((value) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: value === language, disabled: recording !== null }}
              key={value}
              disabled={recording !== null}
              onPress={() => setLanguage(value)}
              style={[styles.language, language === value && styles.selected]}
            >
              <Text style={styles.buttonText}>{value.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        {recording === null && (
          <Action
            title="Record"
            disabled={busy || !paired}
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
    </ScrollView>
  );
}
function Action({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  page: { padding: 24, paddingTop: 64, paddingBottom: 60, backgroundColor: '#101a1a', flexGrow: 1 },
  title: { color: '#f1f5ec', fontSize: 42, fontWeight: '600', lineHeight: 48, marginBottom: 16 },
  body: { color: '#bdceca', fontSize: 16, lineHeight: 24, marginBottom: 16 },
  heading: { color: '#f1f5ec', fontSize: 23, fontWeight: '600', marginBottom: 14 },
  section: { borderTopWidth: 1, borderColor: '#3e5350', paddingTop: 28, marginTop: 28 },
  label: { color: '#e0ece5', fontSize: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#6b8d82', borderRadius: 8, padding: 14, color: '#f1f5ec', fontSize: 16, marginBottom: 16 },
  button: { backgroundColor: '#25453b', borderRadius: 8, padding: 16, minHeight: 52, justifyContent: 'center', marginBottom: 10 },
  buttonText: { color: '#e7fff4', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { backgroundColor: '#356551' },
  fingerprint: {
    color: '#b5f7d8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 16,
  },
  error: { color: '#ffb8ab', fontSize: 16, lineHeight: 24, marginVertical: 16 },
  transcript: { color: '#f1f5ec', fontSize: 20, lineHeight: 30, marginTop: 20 },
  languages: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  language: { padding: 12, borderWidth: 1, borderColor: '#526e64', borderRadius: 6 },
  selected: { backgroundColor: '#25453b', borderColor: '#99dfc3' },
});
