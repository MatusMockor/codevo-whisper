#include "internal.hpp"
#include <X11/extensions/Xfixes.h>
#include <algorithm>
#include <memory>
#include <optional>
namespace cw {
struct Format { std::string target; GdkAtom type; int bits; std::vector<guchar> bytes; };
struct Selection;
struct Offer { Selection* selection; std::vector<Format> formats; };
struct Selection {
  explicit Selection(GdkAtom value):atom(value) {}
  GdkAtom atom;GtkClipboard* clipboard=nullptr;
  Offer* offer=nullptr;uint64_t generation=0;Time timestamp=CurrentTime;
};
struct Snapshot {
  size_t index;std::vector<Format> saved;bool complete=false;bool hadOwner=false;
  Window owner=None;uint64_t generation=0;Time timestamp=CurrentTime;Offer* offer=nullptr;uint64_t lease=0;Time leaseTimestamp=CurrentTime;
};
enum class Purpose { Copy, Paste };
enum class Policy { Restore, Leave };
enum class Phase { Prepared, Written, Posted, Retired };
struct ClipboardTransaction {
  std::string id,operationId,expected;Purpose purpose;Policy policy;Phase phase=Phase::Prepared;
  std::vector<Snapshot> selections;
};
static Selection selections[]={Selection(GDK_SELECTION_CLIPBOARD),Selection(GDK_SELECTION_PRIMARY)};
static std::optional<ClipboardTransaction> transaction;
static Window watchWindow=None;
static int fixesEvent=0;
static Atom xatom(GdkAtom a) { return gdk_x11_atom_to_xatom_for_display(gdk_display_get_default(),a); }
static bool ownerEvent(XEvent* event) {return watchWindow && event->type==fixesEvent+XFixesSelectionNotify && reinterpret_cast<XFixesSelectionNotifyEvent*>(event)->window==watchWindow;}
static void changed(XEvent* event) {
  auto notification=reinterpret_cast<XFixesSelectionNotifyEvent*>(event);
  for(auto& selection:selections)if(notification->selection==xatom(selection.atom)){++selection.generation;selection.timestamp=notification->selection_timestamp;}
}
static void syncOwners() {
  XSync(display,False);XEvent event;
  while(XCheckIfEvent(display,&event,+[](Display*,XEvent* event,XPointer)->Bool {return ownerEvent(event);},nullptr))changed(&event);
}
static bool initialize() {
  if(!display)return false;
  if(watchWindow)return true;
  int error;if(!XFixesQueryExtension(display,&fixesEvent,&error))return false;
  watchWindow=XCreateSimpleWindow(display,DefaultRootWindow(display),0,0,1,1,0,0,0);
  for(auto& selection:selections) {
    selection.clipboard=gtk_clipboard_get(selection.atom);
    XFixesSelectSelectionInput(display,watchWindow,xatom(selection.atom),XFixesSetSelectionOwnerNotifyMask|XFixesSelectionWindowDestroyNotifyMask|XFixesSelectionClientCloseNotifyMask);
  }
  gdk_window_add_filter(nullptr,+[](GdkXEvent* raw,GdkEvent*,gpointer)->GdkFilterReturn {
    auto event=static_cast<XEvent*>(raw);if(!ownerEvent(event))return GDK_FILTER_CONTINUE;
    changed(event);return GDK_FILTER_REMOVE;
  },nullptr);
  syncOwners();return true;
}
struct Reply { bool done=false;bool valid=false;std::vector<Format> formats; };
static bool wait(const std::shared_ptr<Reply>& reply,int64_t deadline) {
  while(!reply->done && g_get_monotonic_time()<deadline) {while(g_main_context_iteration(nullptr,FALSE)) {}g_usleep(1000);}
  return reply->done && reply->valid;
}
static void snapshot(Snapshot& s) {
  auto& selection=selections[s.index];
  s.saved.clear();s.complete=false;s.hadOwner=false;
  if(!display)return;
  syncOwners();
  auto generation=selection.generation;
  auto before=XGetSelectionOwner(display,xatom(selection.atom));s.owner=before;s.generation=generation;s.timestamp=selection.timestamp;s.hadOwner=before!=None;
  if(!s.hadOwner) {s.complete=true;return;}
  auto reply=std::make_shared<Reply>();auto holder=new std::shared_ptr<Reply>(reply);
  gtk_clipboard_request_targets(selection.clipboard,+[](GtkClipboard*,GdkAtom* targets,gint count,gpointer data) {
    std::unique_ptr<std::shared_ptr<Reply>> ref(static_cast<std::shared_ptr<Reply>*>(data));auto r=*ref;
    r->valid=targets && count>=0 && count<=128;
    if(r->valid)for(int i=0;i<count;++i) {auto name=gdk_atom_name(targets[i]);if(name){r->formats.push_back({name,GDK_NONE,0,{}});g_free(name);}}
    r->done=true;
  },holder);
  auto deadline=g_get_monotonic_time()+1200000;
  if(!wait(reply,deadline))return;
  size_t total=0;
  for(auto& target:reply->formats) {
    if(target.target=="TARGETS" || target.target=="MULTIPLE" || target.target=="TIMESTAMP" || target.target=="SAVE_TARGETS")continue;
    auto part=std::make_shared<Reply>();auto context=new std::pair<std::shared_ptr<Reply>,std::string>(part,target.target);
    gtk_clipboard_request_contents(selection.clipboard,gdk_atom_intern(target.target.c_str(),FALSE),+[](GtkClipboard*,GtkSelectionData* data,gpointer raw) {
      std::unique_ptr<std::pair<std::shared_ptr<Reply>,std::string>> ref(static_cast<std::pair<std::shared_ptr<Reply>,std::string>*>(raw));auto r=ref->first;
      auto size=gtk_selection_data_get_length(data);auto bits=gtk_selection_data_get_format(data);auto type=gtk_selection_data_get_data_type(data);
      r->valid=size>=0 && size<=16777216 && (bits==8 || bits==16 || bits==32) && type!=GDK_NONE;
      if(r->valid) {auto bytes=gtk_selection_data_get_data(data);Format f{ref->second,type,bits,{}};if(size)f.bytes.assign(bytes,bytes+size);r->formats.push_back(std::move(f));}
      r->done=true;
    },context);
    if(!wait(part,deadline))return;
    total+=part->formats[0].bytes.size();if(total>33554432)return;
    s.saved.push_back(std::move(part->formats[0]));
  }
  syncOwners();
  s.complete=!s.saved.empty() && selection.generation==generation && XGetSelectionOwner(display,xatom(selection.atom))==before;
}
static bool offer(Selection& s,std::vector<Format> formats) {
  auto data=new Offer{&s,std::move(formats)};
  std::vector<GtkTargetEntry> entries;
  for(size_t i=0;i<data->formats.size();++i)entries.push_back({const_cast<gchar*>(data->formats[i].target.c_str()),0,static_cast<guint>(i)});
  if(entries.empty()) {delete data;gtk_clipboard_clear(s.clipboard);return true;}
  bool success=gtk_clipboard_set_with_data(s.clipboard,entries.data(),entries.size(),+[](GtkClipboard*,GtkSelectionData* selection,guint info,gpointer raw) {
    auto data=static_cast<Offer*>(raw);if(info>=data->formats.size())return;
    auto& f=data->formats[info];gtk_selection_data_set(selection,f.type,f.bits,f.bytes.data(),f.bytes.size());
  },+[](GtkClipboard*,gpointer raw) {
    auto data=static_cast<Offer*>(raw);if(data->selection->offer==data) {data->selection->offer=nullptr;++data->selection->generation;}delete data;
  },data);
  if(!success) {delete data;return false;}
  s.offer=data;syncOwners();return XGetSelectionOwner(display,xatom(s.atom))!=None;
}
static bool matches(const Snapshot& saved,bool written) {
  auto& selection=selections[saved.index];
  return selection.generation==(written?saved.lease:saved.generation) && selection.timestamp==(written?saved.leaseTimestamp:saved.timestamp) && XGetSelectionOwner(display,xatom(selection.atom))==saved.owner && (!written || (selection.offer && selection.offer==saved.offer));
}
void selectionRetire() {if(transaction && transaction->purpose==Purpose::Paste)transaction->phase=Phase::Retired;}
JsonObject* selectionSave(JsonObject* args) {
  transaction.reset();auto reply=object();boolean(reply,"saved",false);
  if(!initialize())return reply;
  auto purpose=string(args,"purpose"),policy=string(args,"policy");
  if((purpose!="copy" && purpose!="paste") || (policy!="restore" && policy!="leave"))return reply;
  ClipboardTransaction next;next.purpose=purpose=="copy"?Purpose::Copy:Purpose::Paste;next.policy=policy=="restore"?Policy::Restore:Policy::Leave;
  if(next.purpose==Purpose::Copy)invalidateDelivery();
  next.operationId=string(args,"operationId");
  auto shortcut=selectionShortcut(next.operationId);
  if(next.purpose==Purpose::Paste && shortcut.empty())return reply;
  size_t count=next.purpose==Purpose::Paste && shortcut=="shift-insert"?2:1;
  for(size_t index=0;index<count;++index) {
    Snapshot saved{};saved.index=index;
    if(next.policy==Policy::Restore) {snapshot(saved);if(!saved.complete)return reply;}
    else {syncOwners();saved.owner=XGetSelectionOwner(display,xatom(selections[index].atom));saved.generation=selections[index].generation;saved.timestamp=selections[index].timestamp;}
    next.selections.push_back(std::move(saved));
  }
  if(next.purpose==Purpose::Paste && selectionShortcut(next.operationId)!=shortcut)return reply;
  gchar* id=g_uuid_string_random();next.id=id;g_free(id);transaction=std::move(next);
  boolean(reply,"saved",true);text(reply,"transactionId",transaction->id);return reply;
}
bool selectionWrite(JsonObject* args) {
  if(!transaction || string(args,"transactionId")!=transaction->id || transaction->phase!=Phase::Prepared)return false;
  auto& tx=*transaction;
  if(tx.purpose==Purpose::Paste && selectionShortcut(tx.operationId).empty())return false;
  auto value=string(args,"text");
  auto formats=[&]() {std::vector<Format> list;for(auto name:{"UTF8_STRING","text/plain;charset=utf-8","text/plain"})list.push_back({name,gdk_atom_intern("UTF8_STRING",FALSE),8,{value.begin(),value.end()}});return list;};
  XGrabServer(display);syncOwners();bool success=true;
  for(auto& saved:tx.selections)if(!matches(saved,false))success=false;
  if(success) {
    for(auto& saved:tx.selections) {
      auto& selection=selections[saved.index];
      if(!offer(selection,formats())) {success=false;break;}
      saved.owner=XGetSelectionOwner(display,xatom(selection.atom));saved.offer=selection.offer;saved.lease=selection.generation;saved.leaseTimestamp=selection.timestamp;
    }
    tx.expected=value;tx.phase=Phase::Written;
    if(!success)for(auto& saved:tx.selections)if(saved.complete && saved.offer && matches(saved,true))offer(selections[saved.index],saved.saved);
  }
  XUngrabServer(display);XFlush(display);
  if(!success)tx.phase=Phase::Retired;
  return success;
}
bool selectionCanPost(const std::string& operationId,const std::string& transactionId) {
  if(!transaction || transaction->purpose!=Purpose::Paste || transaction->phase!=Phase::Written || transaction->operationId!=operationId || transaction->id!=transactionId)return false;
  syncOwners();for(auto& saved:transaction->selections)if(!matches(saved,true))return false;
  return true;
}
void selectionPosted() {if(transaction)transaction->phase=Phase::Posted;}
bool selectionRestore(JsonObject* args) {
  if(!display || !transaction || string(args,"transactionId")!=transaction->id || transaction->policy!=Policy::Restore || transaction->phase==Phase::Prepared || (!truth(args,"force") && string(args,"expectedText")!=transaction->expected))return false;
  bool restored=false;XGrabServer(display);syncOwners();
  for(auto& saved:transaction->selections)if(saved.complete && saved.offer && matches(saved,true)) {restored=offer(selections[saved.index],std::move(saved.saved)) || restored;saved.offer=nullptr;}
  XUngrabServer(display);XFlush(display);transaction.reset();return restored;
}
void selectionShutdown() {
  for(auto& s:selections)if(s.clipboard && s.offer)gtk_clipboard_store(s.clipboard);
  if(watchWindow)XDestroyWindow(display,watchWindow);
}
}
