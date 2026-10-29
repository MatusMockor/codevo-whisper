#include "internal.hpp"
#include <algorithm>
#include <memory>
namespace cw {
struct Format { std::string target; GdkAtom type; int bits; std::vector<guchar> bytes; };
struct Selection;
struct Offer { Selection* selection; std::vector<Format> formats; };
struct Selection {
  explicit Selection(GdkAtom value):atom(value) {}
  GdkAtom atom;GtkClipboard* clipboard=nullptr;
  std::vector<Format> saved;bool complete=false;bool hadOwner=false;
  Offer* offer=nullptr;Window owner=0;uint64_t generation=0;uint64_t lease=0;std::string expected;
  guint32 timestamp=0;
};
static Selection selections[]={Selection(GDK_SELECTION_CLIPBOARD),Selection(GDK_SELECTION_PRIMARY)};
static bool touchedPrimary=false;
static Atom xatom(GdkAtom a) { return gdk_x11_atom_to_xatom_for_display(gdk_display_get_default(),a); }
struct Reply { bool done=false;bool valid=false;std::vector<Format> formats; };
static bool wait(const std::shared_ptr<Reply>& reply,int64_t deadline) {
  while(!reply->done && g_get_monotonic_time()<deadline) {while(g_main_context_iteration(nullptr,FALSE)) {}g_usleep(1000);}
  return reply->done && reply->valid;
}
static void snapshot(Selection& s) {
  s.saved.clear();s.complete=false;s.hadOwner=false;
  if(!display)return;
  s.clipboard=gtk_clipboard_get(s.atom);
  if(!g_object_get_data(G_OBJECT(s.clipboard),"codevo-owner-watch")) {
    g_signal_connect(s.clipboard,"owner-change",G_CALLBACK(+[](GtkClipboard*,GdkEventOwnerChange* event,gpointer data) {
      auto s=static_cast<Selection*>(data);
      auto owner=event->owner?GDK_WINDOW_XID(event->owner):None;
      if(owner!=s->owner)++s->generation;
      s->timestamp=event->selection_time;
    }),&s);
    g_object_set_data(G_OBJECT(s.clipboard),"codevo-owner-watch",GINT_TO_POINTER(1));
  }
  while(g_main_context_iteration(nullptr,FALSE)) {}
  auto generation=s.generation;auto timestamp=s.timestamp;
  auto before=XGetSelectionOwner(display,xatom(s.atom));s.hadOwner=before!=None;
  if(!s.hadOwner) {s.complete=true;return;}
  auto reply=std::make_shared<Reply>();auto holder=new std::shared_ptr<Reply>(reply);
  gtk_clipboard_request_targets(s.clipboard,+[](GtkClipboard*,GdkAtom* targets,gint count,gpointer data) {
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
    gtk_clipboard_request_contents(s.clipboard,gdk_atom_intern(target.target.c_str(),FALSE),+[](GtkClipboard*,GtkSelectionData* data,gpointer raw) {
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
  XSync(display,False);
  s.complete=!s.saved.empty() && s.generation==generation && s.timestamp==timestamp && XGetSelectionOwner(display,xatom(s.atom))==before;
}
static bool offer(Selection& s,std::vector<Format> formats) {
  auto data=new Offer{&s,std::move(formats)};
  std::vector<GtkTargetEntry> entries;
  for(size_t i=0;i<data->formats.size();++i)entries.push_back({const_cast<gchar*>(data->formats[i].target.c_str()),0,static_cast<guint>(i)});
  if(entries.empty()) {gtk_clipboard_clear(s.clipboard);return true;}
  bool success=gtk_clipboard_set_with_data(s.clipboard,entries.data(),entries.size(),+[](GtkClipboard*,GtkSelectionData* selection,guint info,gpointer raw) {
    auto data=static_cast<Offer*>(raw);if(info>=data->formats.size())return;
    auto& f=data->formats[info];gtk_selection_data_set(selection,f.type,f.bits,f.bytes.data(),f.bytes.size());
  },+[](GtkClipboard*,gpointer raw) {
    auto data=static_cast<Offer*>(raw);if(data->selection->offer==data) {data->selection->offer=nullptr;++data->selection->generation;}delete data;
  },data);
  if(!success) {delete data;return false;}
  s.offer=data;++s.generation;s.lease=s.generation;XSync(display,False);s.owner=XGetSelectionOwner(display,xatom(s.atom));return s.owner!=None;
}
void selectionSave() {
  touchedPrimary=usesPrimary();
  snapshot(selections[0]);
  if(touchedPrimary)snapshot(selections[1]);
}
bool selectionRestorable() {return selections[0].complete && (!touchedPrimary || selections[1].complete);}
bool selectionWrite(const std::string& value) {
  if(!display)return false;
  auto formats=[&]() {std::vector<Format> list;for(auto name:{"UTF8_STRING","text/plain;charset=utf-8","text/plain"})list.push_back({name,gdk_atom_intern("UTF8_STRING",FALSE),8,{value.begin(),value.end()}});return list;};
  for(size_t i=0;i<(touchedPrimary?2u:1u);++i) {auto& s=selections[i];s.clipboard=gtk_clipboard_get(s.atom);s.expected=value;if(!offer(s,formats()))return false;}
  return true;
}
bool selectionRestore(const std::string& expected,bool force) {
  if(!display)return false;
  bool restored=false;
  for(size_t i=0;i<(touchedPrimary?2u:1u);++i) {
    auto& s=selections[i];
    if(!s.complete || !s.offer || s.generation!=s.lease || (!force && expected!=s.expected))continue;
    XGrabServer(display);
    bool owns=XGetSelectionOwner(display,xatom(s.atom))==s.owner;
    if(owns) {auto saved=s.saved;restored=offer(s,std::move(saved)) || restored;}
    XUngrabServer(display);XFlush(display);
    s.saved.clear();s.complete=false;
  }
  return restored;
}
void selectionShutdown() {
  for(auto& s:selections)if(s.clipboard && s.offer)gtk_clipboard_store(s.clipboard);
}
}
