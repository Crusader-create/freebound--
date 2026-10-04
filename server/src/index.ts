import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173" } // vite's default dev port
});

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("ping_test", () => {
    socket.emit("pong_test", { message: "Server says hello", time: Date.now() });
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(3001, () => {
  console.log("Server listening on http://localhost:3001");
});