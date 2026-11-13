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

def verify(args):
 assert args.controlled_only and args.session=='x11' and os.environ.get('DISPLAY'), 'requires controlled X11 display'
 original=subprocess.check_output(['xdotool',*(['getwindowfocus','-f'] if args.session_shortcuts_only else ['getactivewindow'])],text=True).strip()
 fixture=Client([sys.executable,__file__,'--target']);t=fixture.read()
 helper=Client([str(pathlib.Path(args.helper).resolve())]);assert helper.read()['event']=='ready'
 try:
  xdo('windowfocus' if args.session_shortcuts_only else 'windowactivate','--sync',t['windowId']);time.sleep(.3)
  if args.session_shortcuts_only:
   verify_session_shortcuts(helper,fixture);return
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
  print('PASS native focus safety, opaque authorization, Unicode consumption and consumed X11 hotkey edges',flush=True)
 finally:
  helper.close();fixture.close()
  if original and original not in ['0','1']:xdo('windowfocus' if args.session_shortcuts_only else 'windowactivate',original)

if __name__=='__main__':
 if '--target' in sys.argv:target()
 else:
  parser=argparse.ArgumentParser();parser.add_argument('--session',choices=['x11'],required=True);parser.add_argument('--helper',required=True);parser.add_argument('--controlled-only',action='store_true');parser.add_argument('--session-shortcuts-only',action='store_true');verify(parser.parse_args())
