/**
 * dsh-omnisearch — the remote-screen page for visible platform login.
 *
 * Served at GET /omnisearch/api/vnc/page?platform=<p>&token=<t>. Pure static
 * HTML+JS: it polls `vnc/frame` for JPEG frames, maps taps/clicks into
 * `vnc/input` events, and shows the login state once the cookie jar is
 * satisfied. No framework, no build step — the string is returned as-is.
 *
 * The token is minted by `vnc/start` and only exists in the URL the operator
 * opens, so the stream is not world-readable even though the fenced route
 * plane itself is loopback-trusted.
 *
 * @module
 */
/** Build the remote-screen page HTML. */
export declare function renderVncPage(platform: string, token: string, title: string): string;
