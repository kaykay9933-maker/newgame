const colyseus = require("colyseus");
const schema = require("@colyseus/schema");

const { Schema, MapSchema, type } = schema;

class Player extends Schema {
  constructor(x, z, rotationY, avatarUrl) {
    super();
    this.x = x || 0;
    this.z = z || 0;
    this.rotationY = rotationY || 0;
    this.avatarUrl = avatarUrl || "";
  }
}

schema.defineTypes(Player, {
  x: "number",
  z: "number",
  rotationY: "number",
  avatarUrl: "string",
});

class State extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
  }
}

schema.defineTypes(State, {
  players: { map: Player },
});

class MyRoom extends colyseus.Room {
  onCreate(options) {
    this.setState(new State());

    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (data.x !== undefined) player.x = data.x;
      if (data.z !== undefined) player.z = data.z;
      if (data.rotationY !== undefined) player.rotationY = data.rotationY;
    });

    this.onMessage("chat", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const message = data.message || "";
      if (message.trim().length === 0) return;

      this.broadcast("chat", {
        sessionId: client.sessionId,
        message: message,
      });
    });

    console.log("Room created:", this.roomId);
  }

  onJoin(client, options) {
    const spawnX = Math.random() * 20 - 10;
    const spawnZ = Math.random() * 20 - 10;
    const avatarUrl =
      options.avatarUrl ||
      "https://models.readyplayer.me/67a8b2a0a1b2c3d4e5f6a7b8.glb";

    const player = new Player(spawnX, spawnZ, 0, avatarUrl);
    this.state.players.set(client.sessionId, player);

    console.log(`Player joined: ${client.sessionId} at (${spawnX}, ${spawnZ})`);
  }

  onLeave(client, consented) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.state.players.delete(client.sessionId);
      console.log(`Player left: ${client.sessionId}`);
    }
  }

  onDispose() {
    console.log("Room disposed:", this.roomId);
  }
}

module.exports = { MyRoom, Player, State };
