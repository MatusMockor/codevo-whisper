#pragma once
#include <gtk/gtk.h>
#include <gdk/gdkx.h>
#include <json-glib/json-glib.h>
#include <X11/Xlib.h>
#include <cstdint>
#include <string>
#include <vector>

namespace cw {
JsonObject* object();
void text(JsonObject*, const char*, const std::string&);
void boolean(JsonObject*, const char*, bool);
void number(JsonObject*, const char*, int64_t);
std::string string(JsonObject*, const char*);
int64_t integer(JsonObject*, const char*, int64_t fallback = 0);
bool truth(JsonObject*, const char*);
JsonObject* child(JsonObject*, const char*);
JsonArray* array(JsonObject*, const char*);
void emit(JsonObject*);
void event(const char*);
struct Target { Window window = 0; long pid = 0; std::string name; };
struct Field { std::string identity; std::string role; bool known = false; bool editable = false; bool protectedInput = false; };
struct Operation { std::string id; Target target; Field field; std::string shortcut; int64_t generation = 0; int64_t expires = 0; bool pasted = false; };
extern Display* display;
extern bool wayland;
extern GMainLoop* loop;
void desktopInit();
Target frontmost();
Field focused(const Target&);
bool seatActive();
void describeTarget(JsonObject*, const Target&);
JsonObject* checkDelivery(JsonObject*);
bool post(JsonObject*, bool submit);
void invalidateDelivery();
bool usesPrimary();
void shutdownDesktop();
void selectionSave();
bool selectionWrite(const std::string&);
bool selectionRestore(const std::string&, bool force);
bool selectionRestorable();
void selectionShutdown();
void keysInit(const std::string& controlledDevice);
int inputDeviceCount();
bool controlledInput();
void keysShutdown();
bool canListen();
int64_t modifierFlags();
JsonObject* listen(JsonObject*);
JsonObject* record(JsonObject*);
void fence(bool);
void resetInput();
JsonObject* command(const std::string&, JsonObject*);
void serve();
}
