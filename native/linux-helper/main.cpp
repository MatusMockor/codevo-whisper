#include "internal.hpp"
#include <csignal>
#include <glib-unix.h>
namespace cw { GMainLoop* loop = nullptr; }
int main(int argc, char** argv) {
  std::signal(SIGPIPE, SIG_IGN);
  gtk_init_check(&argc, &argv);
  cw::loop = g_main_loop_new(nullptr, FALSE);
  cw::desktopInit();
  cw::keysInit();
  g_unix_signal_add(SIGTERM, +[](gpointer) -> gboolean { g_main_loop_quit(cw::loop); return G_SOURCE_REMOVE; }, nullptr);
  cw::serve();
  g_main_loop_run(cw::loop);
  cw::keysShutdown();
  cw::selectionShutdown();
  cw::shutdownDesktop();
  g_main_loop_unref(cw::loop);
  return 0;
}
