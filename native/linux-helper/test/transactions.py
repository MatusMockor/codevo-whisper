import importlib.util,pathlib,sys,time,os,hashlib
sys.dont_write_bytecode=True
source=pathlib.Path.cwd()/"native/linux-helper/test/desktop.py"
spec=importlib.util.spec_from_file_location("desktop",source);d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
helper=pathlib.Path(sys.argv[1]).resolve()
print({"helper":str(helper),"sha256":hashlib.sha256(helper.read_bytes()).hexdigest()},flush=True)
original=os.popen("xdotool getactivewindow").read().strip()
f=d.Client(["/usr/bin/python3",str(source),"--target"]);target=f.read();h=d.Client([str(helper)]);assert h.read()["event"]=="ready"
try:
 d.xdo("windowactivate","--sync",target["windowId"]);time.sleep(.4)
 current=h.request("frontmost")
 case=sys.argv[2] if len(sys.argv)>2 else "lease"
 def prepare(chord="ctrl-v",policy="restore"):
  op=h.request("check-delivery",expected=current,intent="automatic",shortcut=chord);assert op.get("kind")=="allowed",op
  saved=h.request("clipboard-save",purpose="paste",policy=policy,operationId=op["operationId"])
  return op,saved.get("transactionId","")
 def write(tx,text):return h.request("clipboard-write",text=text,transactionId=tx)
 def post(op,tx):return h.request("paste",operationId=op["operationId"],transactionId=tx)
 if case=="lease":
  op,tx=prepare();assert write(tx,"intended transcript")["written"]
  f.request("copy",text="UNRELATED USER COPY");time.sleep(.15)
  posted=post(op,tx);time.sleep(.3);texts=f.request("text")["texts"]
  print({"posted":posted,"targetTexts":texts},flush=True)
  assert not posted["posted"] and texts[0]=="", "clipboard lease loss must refuse paste and preserve target"
 elif case=="copy-primary":
  op,tx=prepare("shift-insert","leave");assert write(tx,"first paste")["written"];assert post(op,tx)["posted"];time.sleep(.2)
  f.request("primary-copy",text="later user selection");time.sleep(.1)
  saved=h.request("clipboard-save",purpose="copy",policy="leave");assert write(saved.get("transactionId",""),"Copy Last")["written"]
  primary=f.request("primary")["text"];clipboard=f.request("clipboard")["text"]
  print({"primary":primary,"clipboard":clipboard},flush=True)
  assert primary=="later user selection" and clipboard=="Copy Last", "Copy Last must preserve PRIMARY after ShiftInsert"
 elif case=="phases":
  for chord in ["ctrl-v","shift-insert"]:
   f.request("clear");f.request("focus",index=0);time.sleep(.15)
   op,tx=prepare(chord);assert write(tx,"Žilina 🚀")["written"]
   f.request("focus",index=1);time.sleep(.15)
   assert not post(op,tx)["posted"];assert f.request("text")["texts"]==["","",""]
   h.request("clipboard-restore",transactionId=tx,expectedText="Žilina 🚀",force=True)
   f.request("focus",index=0);time.sleep(.15)
   op,tx=prepare(chord);assert write(tx,"Žilina 🚀")["written"];assert post(op,tx)["posted"];time.sleep(.2)
   assert f.request("text")["texts"][0]=="Žilina 🚀"
   h.request("clipboard-restore",transactionId=tx,expectedText="Žilina 🚀")
   assert h.request("submit",operationId=op["operationId"],mode="enter")["posted"];time.sleep(.1)
   assert f.request("activations")["values"][-1]=="Žilina 🚀"
   assert not h.request("submit",operationId=op["operationId"],mode="enter")["posted"]
  f.request("clear");op,tx=prepare();assert write(tx,"pending")["written"]
  replacement=h.request("check-delivery",expected=current,intent="automatic",shortcut="ctrl-v");assert replacement["kind"]=="allowed"
  assert not post(op,tx)["posted"] and f.request("text")["texts"]==["","",""]
  h.request("clipboard-restore",transactionId=tx,expectedText="pending",force=True)
  print({"fieldRaceNoInjection":True,"positivePasteSubmit":True,"duplicateSubmitRefused":True,"replacementRefused":True},flush=True)
 elif case=="selection-leases":
  f.request("primary-copy",text="original PRIMARY");f.request("copy",text="original CLIPBOARD");time.sleep(.1)
  op,tx=prepare("shift-insert");assert write(tx,"same text")["written"];assert post(op,tx)["posted"];time.sleep(.2)
  f.request("primary-copy",text="same text");time.sleep(.1)
  assert h.request("clipboard-restore",transactionId=tx,expectedText="same text")["restored"]
  assert f.request("primary")["text"]=="same text" and f.request("clipboard")["text"]=="original CLIPBOARD"
  print({"PRIMARYLaterEqualTextPreserved":True,"CLIPBOARDRestoredIndependently":True},flush=True)
 elif case=="incomplete":
  owner=d.Client(["/usr/bin/python3",str(source.with_name("selections.py")),"--owner"]);assert owner.read()["ready"]
  try:
   owner.request("own",text="irreplaceable original",reject=True);time.sleep(.1)
   op=h.request("check-delivery",expected=current,intent="automatic",shortcut="ctrl-v");assert op.get("kind")=="allowed",op
   saved=h.request("clipboard-save",purpose="paste",policy="restore",operationId=op["operationId"])
   written=write(saved.get("transactionId",""),"must not replace");actual=owner.request("read")["text"]
   print({"prepared":saved,"written":written,"clipboard":actual},flush=True)
   assert not saved.get("saved",False) and not written["written"] and actual=="irreplaceable original", "incomplete paste preparation must preserve all original data"
   copied=h.request("clipboard-save",purpose="copy",policy="leave");assert write(copied["transactionId"],"explicit Copy")["written"]
   assert f.request("clipboard")["text"]=="explicit Copy", "explicit Copy must work despite non-restorable old formats"
  finally:owner.close()
 elif case=="snapshot-owner":
  f.request("copy",text="original");time.sleep(.1);op,tx=prepare()
  f.request("copy",text="later copy");time.sleep(.1)
  written=write(tx,"must not replace");actual=f.request("clipboard")["text"]
  print({"written":written,"clipboard":actual},flush=True)
  assert not written["written"] and actual=="later copy", "copy between snapshot and write must survive"
finally:
 h.close();f.close()
 if original:d.xdo("windowactivate",original)
