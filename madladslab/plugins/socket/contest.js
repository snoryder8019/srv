// /plugins/socket/contest.js
export default function registerContest(io) {
  const nsp = io.of("/contest");

  nsp.on("connection", (socket) => {
    console.log("Contest socket connected:", socket.id);

    socket.emit("connected", { ns: "/contest" });

    socket.on("disconnect", () => {
      console.log("Contest socket disconnected:", socket.id);
    });
  });
}

// helpers to emit from your EPs
export function emitScoreUpdate(io, payload) {
  io.of("/contest").emit("score:update", payload);
}

export function emitActionSubmitted(io, payload) {
  io.of("/contest").emit("action:submitted", payload);
}
