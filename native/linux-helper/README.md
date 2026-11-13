# Linux input helper

`session-shortcuts` replaces the shortcuts armed for an active dictation session.
An empty `shortcuts` array disarms them. Keycodes use evdev values on both backends.

X11 grabs consume armed shortcut keys, including when extra modifiers are held.
Wayland reads evdev devices passively: shortcuts emit events but the key also
reaches the focused application.
