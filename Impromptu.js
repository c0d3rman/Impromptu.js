class Room {
  constructor(roomName, debugLevel) {
    this.roomName = roomName;
    this.debugLevel = debugLevel;

    this.serverID = "impromptu-" + roomName;
    this.isServer = false;
    this.serverPeer = null;
    this.clientPeer = null;
    this.clientConn = null;

    let self = this;
    this._internalStorage = {};
    this.storage = new Proxy(
      {},
      {
        get: function (_, prop) {
          return self._internalStorage[prop];
        },
        set: function (_, prop, value) {
          self.clientConn.send({
            type: "storageSet",
            prop: prop,
            value: value,
          });
        },
      }
    );

    this.debug("Created room with name " + roomName);
  }

  tryBecomeServer() {
    let self = this;

    return new Promise((resolve) => {
      self.serverPeer = new Peer(self.serverID);
      self.debug("Attempting to become server...");
      var haveFailed = false;
      let failFn = function () {
        if (!haveFailed) {
          self.debug("I am not server (anymore)");
          self.isServer = false;
          self.serverPeer = null;
          haveFailed = true;
          resolve();
        }
      };
      self.serverPeer.on("disconnected", failFn);
      self.serverPeer.on("close", failFn);
      self.serverPeer.on("error", failFn);
      self.serverPeer.on("open", function (id) {
        self.debug("I am server! ID: " + id);
        self.isServer = true;

        self.serverPeer.on("connection", function (serverConn) {
          self.debug("New connection to server from ID: " + serverConn.peer);

          serverConn.on("data", function (data) {
            if (data === null || typeof data !== "object") {
              return;
            }

            if (data.type == "message") {
              self.debug("Received message to server (forwarding): ");
              self.debug(data);

              self.serverPeer._connections.forEach((connections) => {
                connections.forEach((conn) => {
                  conn.send({
                    type: "message",
                    sender: serverConn.peer,
                    message: data.message,
                  });
                });
              });
              return;
            }

            if (data.type == "storageSet") {
              self._internalStorage[data.prop] = data.value;
              self.serverPeer._connections.forEach((connections) => {
                connections.forEach((conn) => {
                  conn.send({
                    type: "storage",
                    storage: self._internalStorage,
                  });
                });
              });
            }
          });
        });

        resolve();
      });
    });
  }

  connectClient() {
    let self = this;
    return new Promise((resolve) => {
      self.clientPeer = new Peer();
      self.clientPeer.on("open", function (id) {
        self.debug("Client peer open. ID: " + id);
        self.clientConn = self.clientPeer.connect(self.serverID);
        self.clientConn.on("open", function () {
          self.debug("Client connected to server.");

          // Handle storage updates
          self.clientConn.on("data", function (data) {
            self.debug("Received data to client: ");
            self.debug(data);

            if (data === null || typeof data !== "object") {
              return;
            }

            if (data.type !== "storage") {
              return;
            }

            if (!self.isServer) {
              self._internalStorage = data.storage;
            }
          });
          resolve();
        });
      });
    });
  }

  connect(resolve) {
    let self = this;
    self.tryBecomeServer().then(function () {
      self.connectClient().then(function () {
        resolve();
      });
    });
  }

  send(message) {
    this.debug("Client sending message: ");
    this.debug(message);
    this.clientConn.send({ type: "message", message: message });
  }

  onReceive(callback) {
    let self = this;
    self.clientConn.on("data", function (data) {
      if (data === null || typeof data !== "object") {
        return;
      }

      if (data.type !== "message") {
        return;
      }

      self.debug("Client received message: ");
      self.debug(data.message);
      callback(data.message);
    });
  }

  debug(message) {
    if (this.debugLevel) {
      console.log(message);
    }
  }
}

p5.prototype.createRoom = function (roomName, debugLevel = false) {
  let room = new Room(roomName, debugLevel);
  new Promise((resolve) => {
    room.connect(resolve);
  }).then(function (data) {
    this._decrementPreload();
  });
  return room;
};

p5.prototype.registerPreloadMethod("createRoom", p5.prototype);
