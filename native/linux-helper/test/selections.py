import importlib.util, pathlib, sys, time
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('desktop',pathlib.Path(__file__).with_name('desktop.py'));desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)

def owner():
 import gi
 gi.require_version('Gtk','3.0')
 from gi.repository import Gtk, Gdk, GLib
 widget=Gtk.Invisible();widget.realize();value='original';reject=False;delay=0
 targets=['UTF8_STRING','application/x-codevo-fixture']
 for index,name in enumerate(targets):Gtk.selection_add_target(widget,Gdk.SELECTION_CLIPBOARD,Gdk.Atom.intern(name,False),index)
 def selection_get(widget,data,info,timestamp):
  if info==1 and delay:time.sleep(delay)
  if info==1 and reject:return
  payload=value.encode() if info==0 else b'\x00\xff\x12\x00fixture'
  data.set(Gdk.Atom.intern(targets[info],False),8,payload)
 widget.connect('selection-get',selection_get)
 clipboard=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
 def command(source,condition):
  nonlocal value,reject,delay
  import json
  line=sys.stdin.readline()
  if not line:Gtk.main_quit();return False
  request=json.loads(line)
  if request['cmd']=='own':
   value=request['text'];reject=request.get('reject',False);delay=request.get('delay',0);assert Gtk.selection_owner_set(widget,Gdk.SELECTION_CLIPBOARD,Gdk.CURRENT_TIME);desktop.send({'owned':True})
  elif request['cmd']=='read':
   data=clipboard.wait_for_contents(Gdk.Atom.intern(targets[1],False));desktop.send({'text':clipboard.wait_for_text(),'raw':list(data.get_data()) if data else None})
  return True
 GLib.io_add_watch(sys.stdin,GLib.IO_IN|GLib.IO_HUP,command);desktop.send({'ready':True});Gtk.main()

def verify():
 fixture=desktop.Client([sys.executable,__file__,'--owner']);assert fixture.read()['ready']
 helper=desktop.Client([str(pathlib.Path(sys.argv[1]).resolve())]);assert helper.read()['event']=='ready'
 try:
  fixture.request('own',text='original');time.sleep(.1)
  if '--incomplete' in sys.argv:
   fixture.request('own',text='irreplaceable original',reject=True);time.sleep(.1)
   saved=helper.request('clipboard-save',purpose='copy',policy='restore')
   written=helper.request('clipboard-write',text='must not replace',transactionId=saved.get('transactionId',''))
   actual=fixture.request('read')['text'];print({'prepared':saved,'written':written,'clipboard':actual},flush=True)
   assert not saved.get('saved',False) and not written['written'] and actual=='irreplaceable original','incomplete restore snapshot must refuse before ownership mutation'
   return

  prepared=helper.request('clipboard-save',purpose='copy',policy='restore');tx=prepared.get('transactionId','');assert helper.request('clipboard-write',text='dictated',transactionId=tx)['written']
  assert fixture.request('read')['text']=='dictated'
  time.sleep(.5);assert helper.request('clipboard-restore',expectedText='dictated',transactionId=tx)['restored']
  assert fixture.request('read')=={'text':'original','raw':[0,255,18,0,102,105,120,116,117,114,101]}
  for force in [False,True]:
   prepared=helper.request('clipboard-save',purpose='copy',policy='restore');tx=prepared.get('transactionId','');assert helper.request('clipboard-write',text='same text',transactionId=tx)['written']
   fixture.request('own',text='same text');time.sleep(.1)
   assert not helper.request('clipboard-restore',expectedText='same text',force=force,transactionId=tx)['restored'],'later equal-text owner must survive'
   assert fixture.request('read')=={'text':'same text','raw':[0,255,18,0,102,105,120,116,117,114,101]}
  print('PASS real X11 native complete text+binary selection restoration and later equal-text owner preservation, including force rollback')
 finally:helper.close();fixture.close()
if '--owner' in sys.argv:owner()
else:verify()
