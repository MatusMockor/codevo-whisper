import fcntl, importlib.util, json, os, pathlib, struct, sys, time
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('desktop',pathlib.Path(__file__).with_name('desktop.py'));desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)
helper=str(pathlib.Path(sys.argv[1]).resolve())
name=f'Codevo controlled keyboard {os.getpid()}'
fd=os.open('/dev/uinput',os.O_WRONLY|os.O_NONBLOCK)
client=None
try:
 fcntl.ioctl(fd,0x40045564,1)
 for key in list(range(1,89))+[97,100,125,126,194]:fcntl.ioctl(fd,0x40045565,key)
 fcntl.ioctl(fd,0x405c5503,struct.pack('HHHH80sI',3,0x1234,0x5678,1,name.encode(),0));fcntl.ioctl(fd,0x5501)
 node=None
 for _ in range(50):
  for path in pathlib.Path('/sys/class/input').glob('event*/device/name'):
   if path.read_text().strip()==name:node='/dev/input/'+path.parents[1].name
  if node:
   try:probe=os.open(node,os.O_RDONLY|os.O_NONBLOCK);os.close(probe);break
   except PermissionError:pass
  time.sleep(.1)
 assert node,'controlled keyboard access unavailable'
 os.environ['XDG_SESSION_TYPE']='wayland'
 client=desktop.Client([helper,'--input-device',node]);assert client.read()['event']=='ready'
 capability=client.request('permissions');assert capability.get('inputDeviceCount')==1 and capability.get('controlledInput') is True,capability
 result=client.request('listen-start',listenId=17,kind='key',keycode=0x20000+194,modifiers=['control']);assert result.get('running'),result
 def key(code,value):
  os.write(fd,struct.pack('llHHi',0,0,1,code,value)+struct.pack('llHHi',0,0,0,0,0));time.sleep(.04)
 key(29,1);key(194,1);key(194,2);key(194,0);key(29,0);time.sleep(.1)
 client.request('ping');edges=[e['phase'] for e in client.events if e.get('event')=='hotkey'];assert edges==['down','up'],edges
 assert client.request('record-key',recordingId=4,timeoutMs=1000)['recording']
 key(97,1);key(194,1);key(194,0);key(97,0);client.request('ping')
 recorded=[e for e in client.events if e.get('event')=='recorded'];assert len(recorded)==1 and recorded[0]['keycode']==0x20000+194,recorded
 client.request('listen-start',listenId=18,kind='modifiers',keycodes=[0x20000+97]);key(97,1);key(97,0);client.request('ping')
 assert [e['phase'] for e in client.events if e.get('event')=='hotkey' and e.get('listenId')==18]==['down','up']
 synthetic='--synthetic-sync' in sys.argv
 if synthetic:
  before=len([e for e in client.events if e.get('event')=='hotkey' and e.get('listenId')==18])
  key(97,1)
  os.write(fd,struct.pack('llHHi',0,0,0,3,0)+struct.pack('llHHi',0,0,0,0,0));time.sleep(.1)
  key(97,0);time.sleep(.3);client.request('ping')
  edges=[e['phase'] for e in client.events if e.get('event')=='hotkey' and e.get('listenId')==18]
  assert edges[before:]==['down'],('lost release must cancel without a phantom edge',edges)
  key(97,1);key(97,0);client.request('ping')
  assert [e['phase'] for e in client.events if e.get('event')=='hotkey' and e.get('listenId')==18][-2:]==['down','up']
 if '--read-error' in sys.argv:
  client.request('listen-start',listenId=19,kind='modifiers',keycodes=[0x20000+97])
  key(97,1);key(97,0);time.sleep(1.2)
  capability=client.request('permissions')
  print({'sameNode':node,'afterReadError':capability},flush=True)
  assert capability.get('inputDeviceCount')==1, 'failed descriptor must retire and same node reopen without physical remove'
  client.request('ping');edges=[e['phase'] for e in client.events if e.get('event')=='hotkey' and e.get('listenId')==19]
  assert edges==['down'],('read loss cancels without phantom up',edges)
  assert any(e.get('event')=='tap-error' for e in client.events)
  assert any(e.get('event')=='tap-reenabled' for e in client.events)
  key(97,1);key(97,0);client.request('ping')
  assert [e['phase'] for e in client.events if e.get('event')=='hotkey' and e.get('listenId')==19]==['down','down','up'],client.events
 fcntl.ioctl(fd,0x5502);time.sleep(.3);client.request('ping');assert any(e.get('event')=='tap-error' for e in client.events),'unplug must cancel'
 print(json.dumps({'controlledDevice':node,'unrelatedDevicesRead':False,'repeatIgnored':True,'keyAndModifierEdges':True,'recordingNamespace':True,'unplugCancelled':True,'synDropped':'synthetic libevdev sync cancelled and rearmed' if synthetic else 'kernel SYN_DROPPED unexecuted','session':'Wayland-path fixture on X11, not actual Wayland'}))
finally:
 if client:client.close()
 try:fcntl.ioctl(fd,0x5502)
 except OSError:pass
 os.close(fd)
