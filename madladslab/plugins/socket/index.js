// /plugins/socket/index.js
import { Server } from "socket.io";
import registerContest from "./contest.js";
import { registerAgents } from "./agents.js";
import { registerPepe } from "./pepe.js";
import { registerForwardChat } from "./forwardchat.js";

export default function initSockets(server) {
  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  // register namespaces
  registerContest(io);
  registerAgents(io);
  registerPepe(io);
  registerForwardChat(io);

  return io;
}
