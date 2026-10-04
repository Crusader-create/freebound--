import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:3001");

export default function App() {
  const [status, setStatus] = useState("connecting...");

  useEffect(() => {
    socket.on("connect", () => setStatus("connected: " + socket.id));
    socket.on("pong_test", (data) => setStatus("got reply: " + data.message));
    return () => { socket.off("connect"); socket.off("pong_test"); };
  }, []);

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Freebound</h1>
      <p>Status: {status}</p>
      <button onClick={() => socket.emit("ping_test")}>Ping server</button>
    </div>
  );
}