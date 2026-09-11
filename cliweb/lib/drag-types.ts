/**
 * The HTML5 drag payload types the app uses.
 *
 * A drag source and its drop targets live in different components, and a
 * mismatch between them fails silently: the browser never offers the drop, so
 * the drag simply appears to do nothing. One definition per type means the
 * two sides cannot drift apart.
 */
export const TERMINAL_DRAG_TYPE = "application/x-cliweb-terminal";
export const PANE_DRAG_TYPE = "application/x-cliweb-monitor-pane";
