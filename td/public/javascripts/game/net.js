/**
 * Single shared Socket.IO connection.
 * `io` is the global provided by /socket.io/socket.io.js (loaded in play.ejs).
 */
/* global io */
export const socket = io();
