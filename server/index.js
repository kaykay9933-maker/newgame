const express = require("express");
const cors = require("cors");
const http = require("http");
const colyseus = require("colyseus");
const { MyRoom } = require("./MyRoom");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("My Multiplayer Game Server is running.");
});

const server = http.createServer(app);

const gameServer = new colyseus.Server({
  server: server,
});

gameServer.define("custom_room", MyRoom);

const PORT = process.env.PORT || 2567;

server.listen(PORT, () => {
  console.log(`Server listening on ws://localhost:${PORT}`);
});
