const fsp = require("fs/promises");
const fs = require("fs");
const msgpack = require("msgpack-lite");

class BinaryDriver {
  async read(filePath) {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const fileData = await fsp.readFile(filePath);
    return msgpack.decode(fileData);
  }

  async write(filePath, data) {
    const fileBody = msgpack.encode(data);
    await fsp.writeFile(filePath, fileBody);
  }
}

module.exports = BinaryDriver;