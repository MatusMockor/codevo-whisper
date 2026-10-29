import ctypes,importlib.util,json,pathlib,re,subprocess,sys,time
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('desktop',pathlib.Path(__file__).with_name('desktop.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
helper=str(pathlib.Path(sys.argv[1]).resolve())
unmanaged='--unmanaged' in sys.argv
original='' if unmanaged else subprocess.check_output(['xdotool','getactivewindow'],text=True).strip()
fixture=d.Client([sys.executable,str(pathlib.Path(__file__).with_name('desktop.py')),'--target']);target=fixture.read()
h=d.Client([helper]);assert h.read()['event']=='ready'
x=ctypes.CDLL('libX11.so.6');x.XOpenDisplay.restype=ctypes.c_void_p;x.XOpenDisplay.argtypes=[ctypes.c_char_p];display=x.XOpenDisplay(None)
x.XStringToKeysym.restype=ctypes.c_ulong;x.XStringToKeysym.argtypes=[ctypes.c_char_p];x.XKeysymToKeycode.restype=ctypes.c_uint;x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong]
def code(name):return 0x10000+x.XKeysymToKeycode(display,x.XStringToKeysym(name.encode()))
def phases(identity):
 h.request('ping');return [e['phase'] for e in h.events if e.get('event')=='hotkey' and e.get('listenId')==identity]
def wait_record(identity):
 end=time.monotonic()+2
 while time.monotonic()<end:
  h.request('ping')
  found=[e for e in h.events if e.get('event')=='recorded' and e.get('recordingId')==identity]
  if found:return found
  time.sleep(.03)
 return []
xtest=ctypes.CDLL('libXtst.so.6');xtest.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
x.XSync.argtypes=[ctypes.c_void_p,ctypes.c_int]
def key(command,*names):
 for name in names:
  states=[1,0] if command=='key' else [int(command=='keydown')]
  for pressed in states:xtest.XTestFakeKeyEvent(display,code(name)-0x10000,pressed,0)
 x.XSync(display,0);time.sleep(.06)
def locks():
 state=subprocess.check_output(['xset','q'],text=True)
 return {name:re.search(name+r':\s+(on|off)',state).group(1)=='on' for name in ['Caps Lock','Num Lock']}
initial=locks()
try:
 d.xdo('windowfocus' if unmanaged else 'windowactivate','--sync',target['windowId']);time.sleep(.2)
 assert h.request('listen-start',listenId=20,kind='modifiers',keycodes=[code('Control_L'),code('Shift_R')])['running']
 key('keydown','Control_L');key('keydown','Shift_R');key('keydown','Shift_R');key('keyup','Shift_R');key('keyup','Control_L')
 assert phases(20)==['down','up'],phases(20)
 for caps,num in [(False,False),(True,False),(False,True),(True,True)]:
  desired={'Caps Lock':caps,'Num Lock':num}
  for name,symbol in [('Caps Lock','Caps_Lock'),('Num Lock','Num_Lock')]:
   if locks()[name]!=desired[name]:key('key',symbol)
  identity=30+int(caps)*2+int(num)
  assert h.request('listen-start',listenId=identity,kind='key',keycode=code('F12'),modifiers=['control'])['running']
  key('keydown','Control_R');key('keydown','F12');key('keydown','F12');key('keyup','F12');key('keyup','Control_R')
  assert phases(identity)==['down','up'],(desired,phases(identity))
 rival=d.Client([helper]);assert rival.read()['event']=='ready'
 try:
  denied=rival.request('listen-start',listenId=1,kind='key',keycode=code('F12'),modifiers=['control'])
  assert not denied['running'] and denied['reason']=='shortcut-in-use',denied
 finally:rival.close()
 assert h.request('listen-start',listenId=40,kind='key',keycode=code('F12'),modifiers=['control'])['running']
 key('keydown','Control_L');key('keydown','F12')
 assert h.request('listen-start',listenId=41,kind='key',keycode=code('F11'),modifiers=['control'])['running']
 key('keyup','F12');key('keyup','Control_L');time.sleep(.15)
 key('keydown','Control_L');key('keydown','F11');key('keyup','F11');key('keyup','Control_L')
 assert phases(40)==['down'] and phases(41)==['down','up'],(phases(40),phases(41))
 assert h.request('record-key',recordingId=50,timeoutMs=500)['recording']
 h.request('listen-start',listenId=42,kind='none');h.request('ping')
 assert any(e.get('event')=='record-cancelled' and e.get('recordingId')==50 for e in h.events)
 assert h.request('record-key',recordingId=51,timeoutMs=40)['recording'];time.sleep(.1);h.request('ping')
 assert any(e.get('event')=='record-timeout' and e.get('recordingId')==51 for e in h.events)
 assert h.request('record-key',recordingId=52,timeoutMs=1000)['recording']
 key('keydown','Control_R');key('keydown','F12');key('keyup','F12');key('keyup','Control_R');h.request('ping')
 recorded=wait_record(52)
 assert len(recorded)==1 and recorded[0]['keycode']==code('F12') and recorded[0]['modifiers']==['control'],h.events
 assert h.request('record-key',recordingId=53,timeoutMs=1000)['recording']
 key('keydown','Shift_R');key('keyup','Shift_R');h.request('ping')
 recorded=wait_record(53)
 assert len(recorded)==1 and recorded[0]['keycodes']==[code('Shift_R')],h.events
 print(json.dumps({'modifierIdentity':True,'lockMasks':4,'repeatIgnored':True,'grabConflict':True,'generationReplacement':True,'recordCancelTimeoutAndNamespaces':True,'session':'isolated Xvfb X11 controlled input' if unmanaged else 'actual X11 owned GTK target; no physical loss/lock/suspend claim'}))
finally:
 key('keyup','F12','F11','Control_L','Control_R','Shift_R')
 for name,symbol in [('Caps Lock','Caps_Lock'),('Num Lock','Num_Lock')]:
  if locks()[name]!=initial[name]:key('key',symbol)
 h.close();fixture.close();x.XCloseDisplay.argtypes=[ctypes.c_void_p];x.XCloseDisplay(display)
 if original:d.xdo('windowactivate',original)
