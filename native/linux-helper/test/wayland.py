import argparse, importlib.util, json, os, pathlib, socket, subprocess, sys, time
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('desktop',pathlib.Path(__file__).with_name('desktop.py'));desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)
parser=argparse.ArgumentParser();parser.add_argument('--helper',required=True);parser.add_argument('--evidence',type=pathlib.Path,required=True);args=parser.parse_args()
session=os.environ.get('XDG_SESSION_ID') or subprocess.check_output(['loginctl','show-user',str(os.getuid()),'-p','Display','--value'],text=True).strip()
def property(name):return subprocess.check_output(['loginctl','show-session',session,'-p',name,'--value'],text=True).strip()
if property('Type')!='wayland' or property('Active')!='yes' or property('Remote')!='no' or 'GNOME' not in os.environ.get('XDG_CURRENT_DESKTOP','').upper():
 print('REFUSED: requires the actual active local GNOME Wayland login, not an environment override',file=sys.stderr);sys.exit(78)
wayland=pathlib.Path(os.environ['XDG_RUNTIME_DIR'])/os.environ['WAYLAND_DISPLAY'];assert wayland.is_socket(),wayland
assert os.environ.get('DISPLAY'),'XWayland clipboard bridge requires DISPLAY'
subprocess.run(['xdpyinfo'],check=True,stdout=subprocess.DEVNULL)
args.evidence.mkdir(parents=True,exist_ok=True)
helper=desktop.Client([str(pathlib.Path(args.helper).resolve())]);assert helper.read()['event']=='ready'
fixture=None
observations={'session':session,'type':property('Type'),'nativeWaylandTarget':False,'events':[]}
def receipt():
 observations['events']=helper.events
 (args.evidence/'wayland-native.json').write_text(json.dumps(observations,indent=2)+'\n')
def gesture():
 start=len(helper.events);input('Press and hold the recorded dictation gesture, release it, then press Enter here. ')
 helper.request('ping');edges=[e['phase'] for e in helper.events[start:] if e.get('event')=='hotkey'];assert edges==['down','up'],edges
try:
 permissions=helper.request('permissions');assert permissions.get('inputBackend')=='evdev' and permissions['listenEvent'] and permissions['inputDeviceCount']>0 and not permissions['postEvent'],permissions
 observations['permissions']=permissions
 assert helper.request('check-delivery',expected=None,intent='replay',shortcut='ctrl-v')['kind']=='copy'
 assert not helper.request('paste')['posted']
 saved_backend=os.environ.get('GDK_BACKEND');os.environ['GDK_BACKEND']='wayland'
 fixture=desktop.Client([sys.executable,str(pathlib.Path(__file__).with_name('desktop.py')),'--target']);target=fixture.read();assert target['nativeWayland'] and target['windowId'] is None,target
 if saved_backend is None:os.environ.pop('GDK_BACKEND',None)
 else:os.environ['GDK_BACKEND']=saved_backend
 observations['nativeWaylandTarget']=True
 print('Record a nonreserved physical hotkey now. Only the selected binding is retained.')
 assert helper.request('record-key',recordingId=1,timeoutMs=30000)['recording']
 while True:
  event=helper.read(timeout=35);helper.events.append(event)
  if event.get('event') in ['recorded','record-timeout','record-unsupported']:break
 assert event['event']=='recorded',event
 binding={k:v for k,v in event.items() if k in ['kind','keycode','keycodes','modifiers']}
 codes=binding.get('keycodes',[binding.get('keycode')]);assert all(isinstance(k,int) and 0x20000<k<0x30000 for k in codes),binding
 assert helper.request('listen-start',listenId=1,**binding)['running'];gesture()
 start=len(helper.events);input('Lock the screen and unlock it, then press Enter here. ');helper.request('ping')
 loss=[e['event'] for e in helper.events[start:]];assert 'tap-error' in loss and 'tap-reenabled' in loss,loss
 assert not any(e.get('event')=='hotkey' for e in helper.events[start:]),'unlock must not start dictation';gesture()
 for intent in ['automatic','replay']:
  decision=helper.request('check-delivery',expected=None,intent=intent,shortcut='ctrl-v');assert decision['kind']=='copy',decision
 expected='Wayland Žilina é 🚀'
 helper.request('clipboard-save');assert helper.request('clipboard-write',text=expected)['written']
 input('Click the first native GTK field and manually paste with Ctrl+V, then return here and press Enter. ')
 assert fixture.request('text')['texts'][0]==expected,'native Wayland target did not consume the XWayland selection bridge'
 assert not helper.request('paste')['posted'],'unknown focus must never authorize posting'
 helper.request('clipboard-restore',expectedText=expected)
 input('Click the password field. Press Ctrl+Super+V, then return here and press Enter. ');helper.request('ping')
 assert any(e.get('event')=='shortcut' for e in helper.events),'physical replay shortcut unavailable'
 observations['nativeGtkManualPaste']=True;observations['clipboardOnlyAutomaticAndReplay']=True;observations['physicalGestureAndLockReset']=True
 observations['remaining']='Run the secure native Wayland product overlay test, controlled terminal paste and real microphone steps in docs/operations/linux.md; those are separate receipts.'
 receipt();print(json.dumps(observations))
finally:
 receipt()
 if fixture:fixture.close()
 helper.close()
