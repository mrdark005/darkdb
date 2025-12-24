const fsp = require("fs/promises");
const fs = require("fs");

class JsonDriver {
  constructor(options = {}) {
    this.jsonSpaces = options.jsonSpaces ?? 2;
  }

  async read(filePath) {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const fileData = await fsp.readFile(filePath, "utf8");
    return JSON.parse(fileData);
  }

  async write(filePath, data) {
    const fileBody = JSON.stringify(data, null, this.jsonSpaces);
    await fsp.writeFile(filePath, fileBody, "utf8");
  }
}

module.exports = JsonDriver;