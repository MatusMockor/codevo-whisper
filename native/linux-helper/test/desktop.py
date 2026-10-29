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
 fields=[]
 for secret in [False,False,True]:
  entry=Gtk.Entry();entry.set_visibility(not secret);box.pack_start(entry,True,True,0);fields.append(entry)
 window.show_all();fields[0].grab_focus()
 backend=Gdk.Display.get_default().__gtype__.name
 send({'windowId':window.get_window().get_xid() if backend=='GdkX11Display' else None,'pid':os.getpid(),'nativeWayland':backend=='GdkWaylandDisplay'})
 def command(source,condition):
  line=sys.stdin.readline()
  if not line: Gtk.main_quit();return False
  r=json.loads(line);cmd=r['cmd']
  if cmd=='focus': fields[r['index']].grab_focus();send({'ok':True})
  elif cmd=='text': send({'texts':[f.get_text() for f in fields]})
  elif cmd=='clear':
   for f in fields:f.set_text('')
   send({'ok':True})
  elif cmd=='copy': Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text(r['text'],-1);send({'ok':True})
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
def verify(args):
 assert args.controlled_only and args.session=='x11' and os.environ.get('DISPLAY'), 'requires controlled X11 display'
 original=subprocess.check_output(['xdotool','getactivewindow'],text=True).strip()
 fixture=Client([sys.executable,__file__,'--target']);t=fixture.read()
 helper=Client([str(pathlib.Path(args.helper).resolve())]);assert helper.read()['event']=='ready'
 try:
  xdo('windowactivate','--sync',t['windowId']);time.sleep(.3)
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
   helper.request('clipboard-save');assert helper.request('clipboard-write',text='Žilina 🚀')['written']
   posted=helper.request('paste',operationId=allowed['operationId']);assert posted['posted'],posted
   time.sleep(.5)
   consumed=fixture.request('text')['texts'][0]
   if chord!='ctrl-shift-v':assert consumed=='Žilina 🚀',(chord,consumed)
   else:assert fixture.request('clipboard')['text']=='Žilina 🚀'
   assert helper.request('clipboard-restore',expectedText='Žilina 🚀')['restored'],'complete clipboard snapshot must restore'
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
  print('PASS native focus safety, opaque authorization, Unicode consumption and consumed X11 hotkey edges',flush=True)
 finally:
  helper.close();fixture.close()
  if original:xdo('windowactivate',original)

if __name__=='__main__':
 if '--target' in sys.argv:target()
 else:
  parser=argparse.ArgumentParser();parser.add_argument('--session',choices=['x11'],required=True);parser.add_argument('--helper',required=True);parser.add_argument('--controlled-only',action='store_true');verify(parser.parse_args())
