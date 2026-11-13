import argparse, json, os, pathlib, select, subprocess, sys, time

def send(value):
 print(json.dumps(value),flush=True)

def target():
 import gi
 gi.require_version('Gtk','3.0'); gi.require_version('GdkX11','3.0')
 from gi.repository import Gtk, Gdk, GdkX11, GLib
 window=Gtk.Window(title='Codevo controlled native target')
 window.set_wmclass('codevo-fixture','CodevoFixture');window.set_default_size(520,220)
 box=Gtk.Box(orientation=Gtk.Orientation.VERTICAL);window.add(box)
 fields=[];activations=[];keys=[]
 for secret in [False,False,True]:
  entry=Gtk.Entry();entry.connect('activate',lambda entry:activations.append(entry.get_text()));entry.connect('key-press-event',lambda entry,event:keys.append(event.hardware_keycode));entry.set_visibility(not secret);box.pack_start(entry,True,True,0);fields.append(entry)
 if '--compatible-target' in sys.argv:
  def paste_variant(entry,event):
   if event.keyval in [Gdk.KEY_v,Gdk.KEY_V] and event.state&Gdk.ModifierType.CONTROL_MASK and event.state&Gdk.ModifierType.SHIFT_MASK:
    entry.paste_clipboard();return True
   return False
  for entry in fields:entry.connect('key-press-event',paste_variant)
 window.show_all();fields[0].grab_focus()
 backend=Gdk.Display.get_default().__gtype__.name
 send({'windowId':window.get_window().get_xid() if backend=='GdkX11Display' else None,'pid':os.getpid(),'nativeWayland':backend=='GdkWaylandDisplay'})
 def command(source,condition):
  line=sys.stdin.readline()
  if not line: Gtk.main_quit();return False
  r=json.loads(line);cmd=r['cmd']
  if cmd=='focus': fields[r['index']].grab_focus();send({'ok':True})
  elif cmd=='text': send({'texts':[f.get_text() for f in fields]})
  elif cmd=='activations': send({'values':activations})
  elif cmd=='keys': send({'values':keys})
  elif cmd=='clear':
   for f in fields:f.set_text('')
   send({'ok':True})
  elif cmd=='copy': Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text(r['text'],-1);send({'ok':True})
  elif cmd=='primary-copy': Gtk.Clipboard.get(Gdk.SELECTION_PRIMARY).set_text(r['text'],-1);send({'ok':True})
  elif cmd=='primary': send({'text':Gtk.Clipboard.get(Gdk.SELECTION_PRIMARY).wait_for_text()})
  elif cmd=='clipboard': send({'text':Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text()})
  elif cmd=='set': fields[r['index']].set_text(r['text']);fields[r['index']].set_position(r['caret']);send({'ok':True})
  elif cmd=='select': fields[r['index']].select_region(r['start'],r['end']);send({'ok':True})
  elif cmd=='caret': e=fields[r['index']];send({'position':e.get_position(),'selection':list(e.get_selection_bounds())})
  elif cmd=='focused': send({'values':[f.has_focus() for f in fields]})
  elif cmd=='destroy-field': fields.pop(r['index']).destroy();send({'ok':True})
  elif cmd=='set-sensitive': fields[r['index']].set_sensitive(r['value']);send({'ok':True})
  elif cmd=='close-window': window.destroy();send({'ok':True})
  elif cmd=='quit': Gtk.main_quit();return False
  return True
 GLib.io_add_watch(sys.stdin,GLib.IO_IN|GLib.IO_HUP,command);Gtk.main()

class Client:
 def __init__(self,argv):
  self.p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=sys.stderr,bufsize=0)
  self.pending=b'';self.events=[];self.id=0
 def read(self,timeout=4):
  end=time.monotonic()+timeout
  while b'\n' not in self.pending:
   assert select.select([self.p.stdout],[],[],max(0,end-time.monotonic()))[0], 'native protocol timeout'
   chunk=os.read(self.p.stdout.fileno(),65536);assert chunk,'native process closed'
   self.pending+=chunk
  line,self.pending=self.pending.split(b'\n',1);return json.loads(line)
 def request(self,cmd,**args):
  self.id+=1;self.p.stdin.write((json.dumps({'id':self.id,'cmd':cmd,'args':args,**args})+'\n').encode())
  while True:
   r=self.read()
   if 'event' in r:self.events.append(r);continue
   return r
 def close(self):
  self.p.stdin.close();assert self.p.wait(timeout=4)==0

def xdo(*args):subprocess.run(['xdotool',*map(str,args)],check=True,stdout=subprocess.DEVNULL)
def verify_session_shortcuts(helper,fixture):
 shortcut={'id':'cancel','keycode':1,'modifiers':[]}
 def sessions():
  time.sleep(.1);helper.request('ping');return [e for e in helper.events if e.get('event')=='session-shortcut']
 result=helper.request('session-shortcuts',shortcuts=[shortcut]);assert result.get('armed') is True,result
 result=helper.request('listen-start',listenId=2,kind='none')
 assert result.get('running') or result.get('reason')=='shortcut-in-use',result
 bindingAvailable=result.get('running') is True
 before=fixture.request('keys')['values'].count(9)
 xdo('keydown','Escape');time.sleep(.8);xdo('keyup','Escape')
 assert [e['id'] for e in sessions()]==['cancel'],'repeat must emit once'
 xdo('keydown','Control_L');xdo('keydown','Super_L');xdo('key','Escape');xdo('keyup','Super_L');xdo('keyup','Control_L')
 assert [e['id'] for e in sessions()]==['cancel','cancel']
 assert fixture.request('keys')['values'].count(9)==before,'armed Escape must be consumed'
 result=helper.request('listen-start',listenId=3,kind='key',keycode=0x10000+9,modifiers=['control'])
 assert result.get('running')==bindingAvailable,result
 if bindingAvailable:
  assert helper.request('session-shortcuts',shortcuts=[])['armed']
  xdo('keydown','Control_L');xdo('key','Escape');xdo('keyup','Control_L')
  assert len(sessions())==2
  assert [e['phase'] for e in helper.events if e.get('event')=='hotkey' and e.get('listenId')==3]==['down','up'],'session disarm must preserve overlapping binding grabs'
  assert fixture.request('keys')['values'].count(9)==before
  assert helper.request('session-shortcuts',shortcuts=[shortcut])['armed']
 result=helper.request('listen-stop');assert result.get('running')==bindingAvailable,result
 xdo('keydown','Control_L');xdo('key','Escape');xdo('keyup','Control_L')
 assert len(sessions())==3,'listen-stop must preserve overlapping session grabs'
 assert helper.request('session-shortcuts',shortcuts=[])['armed']
 xdo('key','Escape');assert len(sessions())==3
 assert fixture.request('keys')['values'].count(9)==before+1,'disarm must release Escape'
 assert helper.request('session-shortcuts',shortcuts=[shortcut])['armed']
 rival=Client(helper.p.args);assert rival.read()['event']=='ready'
 try:
  conflict={'id':'conflict','keycode':68,'modifiers':['control','shift','alt','meta']}
  result=rival.request('session-shortcuts',shortcuts=[conflict]);assert result.get('armed') is True,result
  result=helper.request('session-shortcuts',shortcuts=[shortcut,conflict])
  assert result.get('armed') is False and result.get('reason')=='shortcut-in-use',result
  xdo('key','Escape');assert len(sessions())==3
  assert fixture.request('keys')['values'].count(9)==before+2,'failed grab must release partial grabs'
 finally:rival.close()
 assert helper.request('session-shortcuts',shortcuts=[shortcut,conflict])['armed'],'shutdown must release session grabs'
 assert helper.request('session-shortcuts',shortcuts=[])['armed']
 print('PASS X11 session shortcuts: repeat, extra modifiers, consumption, listen reconfiguration, disarm, conflict rollback and shutdown; overlapping binding grabs '+('verified' if bindingAvailable else 'unavailable (existing paste-last grab)'),flush=True)

def verify_target_lock(helper):
 def fixture():
  client=Client([sys.executable,__file__,'--target']);return client,client.read()
 def activate(window):xdo('windowactivate','--sync',window);time.sleep(.3)
 def active():return int(subprocess.check_output(['xdotool','getactivewindow'],text=True))
 def prepare(client,window,index=0):
  activate(window);client.request('focus',index=index);time.sleep(.2);client.request('set',index=index,text='abcdef',caret=3);time.sleep(.2)
 def failed(capture,reasons):
  result=helper.request('target-refocus',captureId=capture['captureId'])
  assert result.get('result')=='failed' and result.get('reason') in reasons,result
  return result['reason']
 other,o=fixture();f,t=fixture();evidence={}
 def unchanged(label,target=True):
  assert other.request('text')['texts'][0]=='other app',label+': other app content must not change'
  if target:assert f.request('text')['texts'][0]=='abcdef',label+': target content must not change'
 try:
  other.request('focus',index=0);other.request('set',index=0,text='other app',caret=9)
  other.request('copy',text='prior clipboard')
  def moved_round(round):
   prepare(f,t['windowId']);f.request('set',index=1,text='second',caret=0)
   capture=helper.request('target-capture')
   assert capture.get('captured') is True and capture['pid']==t['pid'] and capture['windowId']==t['windowId'] and capture['captureId'],capture
   activate(o['windowId']);assert active()==o['windowId']
   expected={'pid':capture['pid'],'windowId':capture['windowId']}
   result=helper.request('target-refocus',captureId=capture['captureId'])
   allowed=helper.request('check-delivery',expected=expected,intent='automatic',shortcut='ctrl-v',captureId=capture['captureId'])
   saved=helper.request('clipboard-save',purpose='paste',policy='restore',operationId=allowed.get('operationId',''))
   assert result.get('result')=='moved',(round,result)
   assert allowed.get('kind')=='allowed',(round,allowed)
   assert saved.get('saved') is True,(round,'locked moved delivery must save the clipboard',saved)
   assert active()==t['windowId'],'refocus must activate the captured window'
   assert f.request('focused')['values']==[True,False,False],'captured field must hold focus'
   caret=f.request('caret',index=0);assert caret['position']==3 and caret['selection']==[],caret
   tx=saved['transactionId']
   assert helper.request('clipboard-write',text='XY',transactionId=tx)['written']
   assert helper.request('paste',operationId=allowed['operationId'],transactionId=tx)['posted'];time.sleep(.5)
   texts=f.request('text')['texts'];assert texts[:2]==['abcXYdef','second'],(round,texts)
   assert helper.request('clipboard-restore',expectedText='XY',transactionId=tx)['restored'],(round,'clipboard must restore')
   assert other.request('clipboard')['text']=='prior clipboard',(round,'clipboard content must survive')
   back=helper.request('target-return',captureId=capture['captureId']);assert back.get('returned') is True,back
   assert active()==o['windowId'],'return must reactivate the previous window'
   return {'result':result['result'],'caret':caret['position'],'texts':texts,'returned':back['returned']}
  evidence['moved']=moved_round(1)
  evidence['movedAgain']=moved_round(2)
  activate(t['windowId']);f.request('focus',index=0);time.sleep(.2)
  capture=helper.request('target-capture')
  evidence['inPlace']=helper.request('target-refocus',captureId=capture['captureId'])['result'];assert evidence['inPlace']=='in-place'
  f.request('focus',index=1);time.sleep(.2);current=helper.request('frontmost')
  moved=helper.request('check-delivery',expected=current,intent='automatic',shortcut='ctrl-v',captureId=capture['captureId'])
  assert moved.get('kind')=='blocked' and moved.get('reason')=='focus-changed',moved
  stale=helper.request('check-delivery',expected=current,intent='automatic',shortcut='ctrl-v',captureId='not-the-capture')
  assert stale.get('kind')=='copy' and stale.get('reason')=='unverified-target',stale
  plain=helper.request('check-delivery',expected=current,intent='automatic',shortcut='ctrl-v');assert plain.get('kind')=='allowed',plain
  evidence['checkDelivery']={'focusChanged':moved['reason'],'mismatchedCapture':stale['reason'],'withoutCapture':plain['kind']}
  prepare(f,t['windowId']);first=helper.request('target-capture')
  f.request('focus',index=1);time.sleep(.2);second=helper.request('target-capture')
  assert first.get('captured') is True and second.get('captured') is True,(first,second)
  activate(o['windowId'])
  assert helper.request('target-refocus',captureId=first['captureId']).get('result')=='moved','first capture must survive a second capture'
  assert f.request('focused')['values']==[True,False,False],'first capture refocuses its own field'
  activate(o['windowId'])
  assert helper.request('target-refocus',captureId=second['captureId']).get('result')=='moved','second capture must refocus'
  assert f.request('focused')['values']==[False,True,False],'second capture refocuses its own field'
  assert helper.request('target-release',captureId=first['captureId'])=={'released':True,'id':helper.id,'cmd':'target-release'}
  assert helper.request('target-release',captureId=first['captureId'])['released'] is False,'release is single use'
  evidence['released']=failed(first,['stale-capture'])
  assert helper.request('target-return',captureId=first['captureId'])['returned'] is False
  assert helper.request('target-refocus',captureId=second['captureId']).get('result')=='in-place','releasing one capture keeps the other'
  oldest=helper.request('target-capture')
  for _ in range(16):helper.request('target-capture')
  evidence['evicted']=failed(oldest,['stale-capture'])
  evidence['coexist']=True
  prepare(f,t['windowId']);capture=helper.request('target-capture')
  f.request('select',index=0,start=6,end=6);time.sleep(.2);assert f.request('caret',index=0)['position']==6
  result=helper.request('target-refocus',captureId=capture['captureId']);assert result.get('result')=='in-place',result
  caret=f.request('caret',index=0);assert caret['position']==3 and caret['selection']==[],('in-place must restore the captured caret',caret)
  allowed=helper.request('check-delivery',expected={'pid':capture['pid'],'windowId':capture['windowId']},intent='automatic',shortcut='ctrl-v',captureId=capture['captureId']);assert allowed.get('kind')=='allowed',allowed
  saved=helper.request('clipboard-save',purpose='paste',policy='restore',operationId=allowed['operationId']);tx=saved['transactionId']
  assert helper.request('clipboard-write',text='XY',transactionId=tx)['written']
  assert helper.request('paste',operationId=allowed['operationId'],transactionId=tx)['posted'];time.sleep(.5)
  assert f.request('text')['texts'][0]=='abcXYdef','in-place paste lands at the captured caret'
  helper.request('clipboard-restore',expectedText='XY',transactionId=tx)
  evidence['inPlaceCaret']=caret['position']
  prepare(f,t['windowId']);f.request('select',index=0,start=1,end=4);time.sleep(.2);capture=helper.request('target-capture')
  f.request('select',index=0,start=4,end=4);time.sleep(.2)
  result=helper.request('target-refocus',captureId=capture['captureId']);assert result.get('result')=='in-place',result
  caret=f.request('caret',index=0);assert caret['selection']==[1,4],('in-place must restore the captured selection',caret)
  evidence['inPlaceSelection']=caret['selection']
  prepare(f,t['windowId']);f.request('set',index=1,text='second',caret=0);capture=helper.request('target-capture');lock=capture['captureId']
  expected={'pid':capture['pid'],'windowId':capture['windowId']};other.request('copy',text='guard clipboard')
  f.request('focus',index=1);time.sleep(.3);submits=len(f.request('activations')['values'])
  allowed=helper.request('check-delivery',expected=expected,intent='automatic',shortcut='ctrl-v');assert allowed.get('kind')=='allowed',allowed
  saved=helper.request('clipboard-save',purpose='paste',policy='restore',operationId=allowed['operationId']);tx=saved['transactionId']
  write=helper.request('clipboard-write',text='XY',transactionId=tx,captureId=lock)
  assert write.get('written') is False and write.get('reason')=='focus-changed',write
  assert other.request('clipboard')['text']=='guard clipboard','a refused write leaves the clipboard unchanged'
  assert helper.request('clipboard-write',text='XY',transactionId=tx)['written']
  paste=helper.request('paste',operationId=allowed['operationId'],transactionId=tx,captureId=lock)
  assert paste.get('posted') is False and paste.get('reason')=='focus-changed',paste
  time.sleep(.3);assert f.request('text')['texts'][:2]==['abcdef','second'],'a refused paste types nowhere'
  assert helper.request('paste',operationId=allowed['operationId'],transactionId=tx)['posted'];time.sleep(.3)
  submit=helper.request('submit',operationId=allowed['operationId'],mode='enter',captureId=lock)
  assert submit.get('posted') is False and submit.get('reason')=='focus-changed',submit
  typed=helper.request('type-text',text='XY',captureId=lock)
  assert typed.get('posted') is False and typed.get('reason')=='focus-changed',typed
  time.sleep(.3);assert len(f.request('activations')['values'])==submits,'a refused submit sends no Enter'
  helper.request('clipboard-restore',expectedText='XY',transactionId=tx)
  f.request('focus',index=0);time.sleep(.3);f.request('set',index=0,text='abcdef',caret=3);time.sleep(.2)
  allowed=helper.request('check-delivery',expected=expected,intent='automatic',shortcut='ctrl-v',captureId=lock);assert allowed.get('kind')=='allowed',allowed
  saved=helper.request('clipboard-save',purpose='paste',policy='restore',operationId=allowed['operationId']);tx=saved['transactionId']
  assert helper.request('clipboard-write',text='XY',transactionId=tx,captureId=lock)['written'],'the captured field may receive the clipboard write'
  assert helper.request('paste',operationId=allowed['operationId'],transactionId=tx,captureId=lock)['posted'],'the captured field may receive the paste';time.sleep(.3)
  assert helper.request('submit',operationId=allowed['operationId'],mode='enter',captureId=lock)['posted'],'the captured field may receive the submit';time.sleep(.3)
  assert f.request('text')['texts'][0]=='abcXYdef' and f.request('activations')['values'][submits:]==['abcXYdef'],'guarded delivery lands in the captured field only'
  helper.request('clipboard-restore',expectedText='XY',transactionId=tx)
  evidence['guard']={'write':write['reason'],'paste':paste['reason'],'submit':submit['reason'],'typeText':typed['reason'],'captured':'abcXYdef'}
  def read(capture,expected,label,index=0):
   field=f.request('caret',index=index);texts=f.request('text')['texts']
   result=helper.request('target-context',captureId=capture if isinstance(capture,str) else capture['captureId'])
   assert {k:result[k] for k in result if k not in ['id','cmd']}==expected,(label,result)
   assert f.request('caret',index=index)==field and f.request('text')['texts']==texts,label+': a context read must not change the field text, caret or selection'
   return result
  prepare(f,t['windowId']);caret=helper.request('target-capture')
  read(caret,{'readable':True,'before':'abc','after':'def'},'caret')
  f.request('focus',index=1);time.sleep(.2);activate(o['windowId'])
  read(caret,{'readable':True,'before':'abc','after':'def'},'focus moved away')
  prepare(f,t['windowId']);f.request('select',index=0,start=1,end=4);time.sleep(.2);selection=helper.request('target-capture')
  read(selection,{'readable':True,'before':'a','after':'ef'},'selection')
  prepare(f,t['windowId']);f.request('set',index=0,text='ž'*700+'b'*700,caret=700);time.sleep(.2);long=helper.request('target-capture')
  read(long,{'readable':True,'before':'ž'*512,'after':'b'*512},'bounded multibyte')
  f.request('set',index=0,text='abc',caret=1);time.sleep(.2)
  read(long,{'readable':True,'before':'abc','after':''},'anchors clamp to a shorter text')
  f.request('focus',index=2);time.sleep(.2);f.request('set',index=2,text='hunter2',caret=3);time.sleep(.2);secret=helper.request('target-capture')
  assert secret.get('captured') is True,secret
  read(secret,{'readable':False,'reason':'protected'},'password field',2)
  assert helper.request('target-release',captureId=caret['captureId'])['released']
  read(caret,{'readable':False,'reason':'stale-capture'},'released capture')
  read('not-a-capture',{'readable':False,'reason':'stale-capture'},'unknown capture')
  f.request('set',index=2,text='',caret=0);f.request('focus',index=0);time.sleep(.2)
  evidence['context']={'caret':'abc|def','focusMoved':'abc|def','selection':'a|ef','bounded':512,'clamped':'abc|','password':'protected','released':'stale-capture'}
  print('PASS X11 target context: caret and selection anchors from the capture, captured field read after focus moved, 512-character multibyte bound, clamp to shorter text, password field protected, released and unknown captures stale, field text caret and selection unchanged by every read',flush=True)
  f.request('set',index=1,text='second',caret=0)
  prepare(f,t['windowId']);capture=helper.request('target-capture');activate(o['windowId'])
  f.request('set-sensitive',index=0,value=False);time.sleep(.2)
  evidence['insensitive']=failed(capture,['focus-refused','element-gone']);unchanged('insensitive')
  assert helper.request('target-return',captureId=capture['captureId'])['returned'] is True and active()==o['windowId'],'return after failure must restore the other app'
  f.request('set-sensitive',index=0,value=True)
  prepare(f,t['windowId']);capture=helper.request('target-capture');activate(o['windowId'])
  f.request('destroy-field',index=0);time.sleep(.2)
  evidence['destroyed']=failed(capture,['element-gone','focus-refused']);unchanged('destroyed',False)
  assert active()==o['windowId'],'a gone element must not move the user'
  assert f.request('text')['texts'][0]=='second','remaining fields must not be typed into'
  prepare(f,t['windowId']);capture=helper.request('target-capture');activate(o['windowId'])
  f.request('close-window');time.sleep(.3)
  evidence['windowClosed']=failed(capture,['window-gone','app-gone']);unchanged('window closed',False)
  assert active()==o['windowId']
  f.close();f,t=fixture()
  prepare(f,t['windowId']);capture=helper.request('target-capture');activate(o['windowId'])
  f.close()
  evidence['appQuit']=failed(capture,['app-gone']);unchanged('app quit',False)
  assert active()==o['windowId']
  print(json.dumps({'targetLock':evidence}),flush=True)
  print('PASS X11 target lock: coexisting and released captures, verified caret and selection restore in place and moved, repeated locked delivery, output guard on write/paste/submit/type, return, stale and gone targets never typed into',flush=True)
 finally:
  if f.p.poll() is None:f.close()
  other.close()

def verify(args):
 assert args.controlled_only and args.session=='x11' and os.environ.get('DISPLAY'), 'requires controlled X11 display'
 original=subprocess.check_output(['xdotool',*(['getwindowfocus','-f'] if args.session_shortcuts_only else ['getactivewindow'])],text=True).strip()
 fixture=Client([sys.executable,__file__,'--target']);t=fixture.read()
 helper=Client([str(pathlib.Path(args.helper).resolve())]);assert helper.read()['event']=='ready'
 try:
  xdo('windowfocus' if args.session_shortcuts_only else 'windowactivate','--sync',t['windowId']);time.sleep(.3)
  if args.session_shortcuts_only:
   verify_session_shortcuts(helper,fixture);return
  if args.target_lock_only:
   verify_target_lock(helper);return
  for _ in range(30):
   current=helper.request('frontmost');element=helper.request('focused-element')
   if current.get('pid')==t['pid'] and element.get('editable') is True:break
   time.sleep(.1)
  assert current.get('pid')==t['pid'] and element.get('editable') is True,(current,element)
  for chord in ['ctrl-v','ctrl-shift-v','shift-insert']:
   fixture.request('clear');fixture.request('focus',index=0);time.sleep(.15)
   allowed=helper.request('check-delivery',expected=current,intent='automatic',shortcut=chord)
   assert allowed.get('kind')=='allowed',allowed
   prior=fixture.request('clipboard')['text']
   saved=helper.request('clipboard-save',purpose='paste',policy='restore',operationId=allowed['operationId']);assert saved['saved'],saved;tx=saved['transactionId'];assert helper.request('clipboard-write',text='Žilina 🚀',transactionId=tx)['written']
   posted=helper.request('paste',operationId=allowed['operationId'],transactionId=tx);assert posted['posted'],posted
   time.sleep(.5)
   consumed=fixture.request('text')['texts'][0]
   if chord!='ctrl-shift-v':assert consumed=='Žilina 🚀',(chord,consumed)
   else:assert fixture.request('clipboard')['text']=='Žilina 🚀'
   assert helper.request('clipboard-restore',expectedText='Žilina 🚀',transactionId=tx)['restored'],'complete clipboard snapshot must restore'
   assert fixture.request('clipboard')['text']==prior,'original clipboard text must survive'
   print(json.dumps({'chord':chord,'posted':True,'targetConsumed':consumed=='Žilina 🚀','fixture':'GTK Entry'}),flush=True)
   assert not helper.request('paste',operationId=allowed['operationId'])['posted'],'operation must be single use'
  fixture.request('focus',index=0);time.sleep(.2)
  allowed=helper.request('check-delivery',expected=current,intent='automatic',shortcut='ctrl-v');assert allowed['kind']=='allowed',allowed
  fixture.request('focus',index=1);time.sleep(.2)
  assert not helper.request('paste',operationId=allowed['operationId'])['posted'],'changed field must revoke authorization'
  fixture.request('focus',index=2);time.sleep(.2)
  protected=helper.request('check-delivery',expected=current,intent='automatic',shortcut='ctrl-v');assert protected['kind']=='blocked' and protected['reason']=='protected-input',protected
  null=helper.request('check-delivery',expected=None,intent='automatic',shortcut='ctrl-v');assert null['kind']=='copy',null
  fixture.request('focus',index=0);time.sleep(.2)
  replay=helper.request('check-delivery',expected=None,intent='replay',shortcut='ctrl-v');assert replay['kind']=='allowed',replay
  assert helper.request('listen-start',listenId=1,kind='key',keycode=0x10000+96,modifiers=['control'])['running']
  xdo('keydown','Control_L');xdo('keydown','F12');time.sleep(.08);xdo('keyup','F12');xdo('keyup','Control_L');time.sleep(.15)
  helper.request('ping');edges=[e['phase'] for e in helper.events if e.get('event')=='hotkey'];assert edges==['down','up'],edges
  verify_session_shortcuts(helper,fixture)
  verify_target_lock(helper)
  print('PASS native focus safety, opaque authorization, Unicode consumption and consumed X11 hotkey edges',flush=True)
 finally:
  helper.close();fixture.close()
  if original and original not in ['0','1']:xdo('windowfocus' if args.session_shortcuts_only else 'windowactivate',original)

if __name__=='__main__':
 if '--target' in sys.argv:target()
 else:
  parser=argparse.ArgumentParser();parser.add_argument('--session',choices=['x11'],required=True);parser.add_argument('--helper',required=True);parser.add_argument('--controlled-only',action='store_true');parser.add_argument('--session-shortcuts-only',action='store_true');parser.add_argument('--target-lock-only',action='store_true');verify(parser.parse_args())
