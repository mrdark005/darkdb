const fsp = require("fs/promises");
const fs = require("fs");
const yaml = require("js-yaml");

class YamlDriver {
  async read(filePath) {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const fileData = await fsp.readFile(filePath, "utf8");
    return yaml.load(fileData);
  }

  async write(filePath, data) {
    const fileBody = yaml.dump(data);
    await fsp.writeFile(filePath, fileBody, "utf8");
  }
}

module.exports = YamlDriver;