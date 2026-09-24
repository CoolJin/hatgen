// Entry. The stylesheet is imported statically so the build emits a render-blocking
// <link> in <head> (no unstyled first paint); the 3D modules are loaded lazily by app.js.
import './styles/main.css';
import './app.js';
