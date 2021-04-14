"use strict";

const fs = require("fs");
const Jimp = require("jimp");
const axios = require("axios");
const Ajv = require("ajv");

const INVALID_COVERS = ["", "https://music.youtube.com/"];

const schema = require("./config.schema");
const config = require("./config");

const validate = new Ajv().compile(schema);
const isConfigValid = validate(config);

if (!isConfigValid) {
  console.error("config.json is not valid. The errors below need to be fixed.");
  console.error(validate.errors);
  process.exit(1);
}

const {
  ytmdRemoteUrl,
  outputPattern,
  albumArtWidth,
  albumArtHeight,
  trackFilePath,
  albumArtFilePath,
  pollIntervalMs,
} = config;

const albumArtTmpFilePath = `${albumArtFilePath}.tmp`;

// Compute multiple outputs safely; limit to the min number of specified files between outputPattern and trackFilePath
const getFilePatterns = () => {
  const effectiveTrackFilePaths = Array.isArray(trackFilePath)
    ? trackFilePath
    : [trackFilePath];
  const effectiveOutputPatterns = Array.isArray(outputPattern)
    ? outputPattern
    : [outputPattern];
  const filePatterns = [];
  for (
    let i = 0;
    i <
    Math.min(effectiveTrackFilePaths.length, effectiveOutputPatterns.length);
    i++
  ) {
    filePatterns.push({
      path: effectiveTrackFilePaths[i],
      pattern: effectiveOutputPatterns[i],
    });
  }

  return filePatterns;
};

const filePatterns = getFilePatterns();

console.log(
  `ytmd-obs-output started. Polling interval is ${pollIntervalMs}ms.`
);

let currentTrack = {};

const hasTrackChanged = ({ author, title, album, cover }) =>
  currentTrack.author !== author ||
  currentTrack.title !== title ||
  currentTrack.album !== album ||
  currentTrack.cover !== cover;

const isTrackNonEmpty = ({ author, title, album }) =>
  author !== "" || title !== "" || album !== "";

const removeFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (error) => {
      if (error) {
        console.error(
          `Error: Could not delete ${filePath}. Check permissions and disk space.`,
          error
        );
      }
    });
  }
};

const writeTrackFile = ({ author, title, album }) => {
  filePatterns.forEach(({ path, pattern }) => {
    const outputText = pattern
      .replace(/%author%/gi, author)
      .replace(/%title%/gi, title)
      .replace(/%album%/gi, album);

    fs.writeFile(path, outputText, (error) => {
      if (error) {
        console.error(
          `Error: Could not write ${path}. Check permissions and disk space.`,
          error
        );
      } else {
        console.log(`- Track written to ${path}.`);
      }
    });
  });
};

const resizeAlbumCover = () => {
  Jimp.read(albumArtTmpFilePath, (error, image) => {
    if (error) {
      console.error(
        `- Error: Could not read ${albumArtTmpFilePath} when resizing. Removing cover file.`,
        error
      );
      removeFile(albumArtTmpFilePath);
      removeFile(albumArtFilePath);
    } else if (image) {
      image.contain(albumArtWidth, albumArtHeight).write(albumArtFilePath);
      console.log(`- Cover resized to ${albumArtFilePath}.`);
    }
  });
};

const downloadAlbumCover = async ({ cover }) => {
  try {
    const response = await axios.get(cover, { responseType: "stream" });
    // Non-null album art: download and convert to png
    response.data
      .pipe(fs.createWriteStream(albumArtTmpFilePath))
      .on("error", (error) => {
        if (error) {
          console.error(
            `Error: Could not write ${albumArtTmpFilePath} when downloading.`,
            error
          );
        }
      })
      .on("finish", () => {
        console.log(`- Cover downloaded to ${albumArtTmpFilePath}.`);
        resizeAlbumCover();
      });
  } catch (error) {
    console.error(`Error: Could not download ${cover}.`, error);
  }
};

const outputTrackInfo = ({ author, title, album, cover }) => {
  console.log("New track detected. Changing track information.");

  currentTrack = { author, title, album, cover };
  console.log(currentTrack);

  if (isTrackNonEmpty(currentTrack)) {
    writeTrackFile(currentTrack);
  } else {
    removeFile(trackFilePath);
  }

  if (!INVALID_COVERS.includes(currentTrack.cover)) {
    console.log("- Downloading cover...");
    downloadAlbumCover(currentTrack);
  } else {
    console.log("- Invalid cover. Removing cover file.");
    removeFile(albumArtTmpFilePath);
    removeFile(albumArtFilePath);
  }
};

setInterval(async () => {
  try {
    const {
      data: { track },
    } = await axios.get(ytmdRemoteUrl);

    if (hasTrackChanged(track)) {
      outputTrackInfo(track);
    }
  } catch (error) {
    console.error(
      `Error ${error.code}: ${error.message}. Check that YTMDesktop Remote API is running and your firewall is configured properly.`
    );
  }
}, pollIntervalMs);
