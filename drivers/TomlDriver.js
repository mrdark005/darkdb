const fsp = require("fs/promises");
const fs = require("fs");
const toml = require("@iarna/toml");

class TomlDriver {
  async read(filePath) {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const fileData = await fsp.readFile(filePath, "utf8");
    return toml.parse(fileData);
  }

  async write(filePath, data) {
    const fileBody = toml.stringify(data);
    await fsp.writeFile(filePath, fileBody, "utf8");
  }
}

module.exports = TomlDriver;
