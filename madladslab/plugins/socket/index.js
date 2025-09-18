// /plugins/socket/index.js
import { Server } from "socket.io";
import registerContest from "./contest.js";

export default function initSockets(server) {
  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  // register namespaces
  registerContest(io);

  return io;
}
