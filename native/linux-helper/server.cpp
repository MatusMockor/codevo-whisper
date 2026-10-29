#include "internal.hpp"
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <glib-unix.h>
namespace cw {
JsonObject* object() { return json_object_new(); }
void text(JsonObject* o, const char* k, const std::string& s) { json_object_set_string_member(o, k, s.c_str()); }
void boolean(JsonObject* o, const char* k, bool b) { json_object_set_boolean_member(o, k, b); }
void number(JsonObject* o, const char* k, int64_t n) { json_object_set_int_member(o, k, n); }
std::string string(JsonObject* o, const char* k) {
  auto n = o ? json_object_get_member(o,k) : nullptr;
  return n && JSON_NODE_HOLDS_VALUE(n) && json_node_get_value_type(n)==G_TYPE_STRING ? json_node_get_string(n) : "";
}
int64_t integer(JsonObject* o, const char* k, int64_t fallback) {
  auto n = o ? json_object_get_member(o,k) : nullptr;
  return n && JSON_NODE_HOLDS_VALUE(n) && json_node_get_value_type(n)==G_TYPE_INT64 ? json_node_get_int(n) : fallback;
}
bool truth(JsonObject* o, const char* k) {
  auto n = o ? json_object_get_member(o,k) : nullptr;
  return n && JSON_NODE_HOLDS_VALUE(n) && json_node_get_value_type(n)==G_TYPE_BOOLEAN && json_node_get_boolean(n);
}
JsonObject* child(JsonObject* o, const char* k) { auto n=o ? json_object_get_member(o,k):nullptr; return n && JSON_NODE_HOLDS_OBJECT(n) ? json_node_get_object(n) : nullptr; }
JsonArray* array(JsonObject* o, const char* k) { auto n=o ? json_object_get_member(o,k):nullptr; return n && JSON_NODE_HOLDS_ARRAY(n) ? json_node_get_array(n) : nullptr; }
void emit(JsonObject* o) {
  auto node=json_node_new(JSON_NODE_OBJECT);json_node_take_object(node,o);
  auto gen=json_generator_new();json_generator_set_root(gen,node);
  auto data=json_generator_to_data(gen,nullptr);
  std::fputs(data,stdout);std::fputc('\n',stdout);std::fflush(stdout);
  g_free(data);g_object_unref(gen);json_node_free(node);
}
void event(const char* name) { auto o=object();text(o,"event",name);number(o,"ts",g_get_real_time()/1000);emit(o); }
JsonObject* command(const std::string& cmd, JsonObject* args) {
  auto o=object();
  if(cmd=="ping") { boolean(o,"pong",true);number(o,"pid",getpid()); }
  else if(cmd=="permissions" || cmd=="request-permission") {
    boolean(o,"listenEvent",canListen());boolean(o,"postEvent",display && !wayland && seatActive());
    auto t=frontmost(); auto f=focused(t);boolean(o,"accessibility",f.known);
  }
  else if(cmd=="frontmost") describeTarget(o,frontmost());
  else if(cmd=="focused-element") { auto f=focused(frontmost()); if(f.known) boolean(o,"editable",f.editable && !f.protectedInput);else json_object_set_null_member(o,"editable");text(o,"role",f.role); }
  else if(cmd=="secure-input") { auto f=focused(frontmost());boolean(o,"enabled",!f.known || f.protectedInput); }
  else if(cmd=="modifier-flags") number(o,"flags",modifierFlags());
  else if(cmd=="check-delivery") { json_object_unref(o);return checkDelivery(args); }
  else if(cmd=="clipboard-save") { selectionSave();boolean(o,"saved",true); }
  else if(cmd=="clipboard-write") {
    auto n=args ? json_object_get_member(args,"text"):nullptr;
    boolean(o,"written",n && json_node_get_value_type(n)==G_TYPE_STRING && selectionWrite(string(args,"text")));
  }
  else if(cmd=="clipboard-restore") boolean(o,"restored",selectionRestore(string(args,"expectedText"),truth(args,"force")));
  else if(cmd=="paste" || cmd=="submit") boolean(o,"posted",post(args,cmd=="submit"));
  else if(cmd=="type-text") { boolean(o,"posted",false);text(o,"reason","unsupported-output"); }
  else if(cmd=="listen-start") { json_object_unref(o);return listen(args); }
  else if(cmd=="listen-stop") { auto empty=object();text(empty,"kind","none");json_object_unref(o);o=listen(empty);json_object_unref(empty); }
  else if(cmd=="record-key") { json_object_unref(o);return record(args); }
  else if(cmd=="output-audio") { text(o,"kind","unavailable");text(o,"reason","platform"); }
  else if(cmd=="recording-audio-begin" || cmd=="recording-audio-end") { boolean(o,cmd=="recording-audio-begin"?"begun":"ended",false);text(o,"reason","platform-unavailable"); }
  else text(o,"error","unknown-command");
  return o;
}
static void line(const std::string& data) {
  auto parser=json_parser_new();GError* error=nullptr;
  if(!json_parser_load_from_data(parser,data.data(),data.size(),&error)) { g_clear_error(&error);g_object_unref(parser);return; }
  auto root=json_parser_get_root(parser);
  if(JSON_NODE_HOLDS_OBJECT(root)) {
    auto req=json_node_get_object(root);auto id=integer(req,"id",-1);auto cmd=string(req,"cmd");
    if(id>0 && id<=9007199254740991LL && !cmd.empty()) {
      auto response=command(cmd,child(req,"args"));number(response,"id",id);text(response,"cmd",cmd);emit(response);
    }
  }
  g_object_unref(parser);
}
void serve() {
  fcntl(STDIN_FILENO,F_SETFL,fcntl(STDIN_FILENO,F_GETFL)|O_NONBLOCK);
  g_unix_fd_add(STDIN_FILENO,GIOCondition(G_IO_IN|G_IO_HUP|G_IO_ERR),+[](gint fd,GIOCondition,gpointer)->gboolean {
    static std::string pending; char bytes[4096];
    while(true) {
      auto n=read(fd,bytes,sizeof(bytes));
      if(n==0) {g_main_loop_quit(loop);return G_SOURCE_REMOVE;}
      if(n<0) {if(errno==EAGAIN || errno==EINTR)return G_SOURCE_CONTINUE;g_main_loop_quit(loop);return G_SOURCE_REMOVE;}
      pending.append(bytes,n);
      size_t end;
      while((end=pending.find('\n'))!=std::string::npos) {if(end>1048576){g_main_loop_quit(loop);return G_SOURCE_REMOVE;}line(pending.substr(0,end));pending.erase(0,end+1);}
      if(pending.size()>1048576) {g_main_loop_quit(loop);return G_SOURCE_REMOVE;}
    }
  },nullptr);
  event("ready");
}
}
