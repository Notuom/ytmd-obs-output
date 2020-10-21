"use strict";

const fs = require("fs");
const Jimp = require("jimp");
const axios = require("axios");

const {
  ytmdRemoteUrl,
  outputPattern,
  albumArtWidth,
  albumArtHeight,
  trackFilePath,
  albumArtFilePath,
  pollIntervalMs,
} = require("./config");

const albumArtTmpFilePath = `${albumArtFilePath}.tmp`;

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
  const outputText = outputPattern
    .replace(/%author%/gi, author)
    .replace(/%title%/gi, title)
    .replace(/%album%/gi, album);

  fs.writeFile(trackFilePath, outputText, (error) => {
    if (error) {
      console.error(
        `Error: Could not write ${trackFilePath}. Check permissions and disk space.`,
        error
      );
    } else {
      console.log(`- Track written to ${trackFilePath}.`);
    }
  });
};

const resizeAlbumCover = () => {
  Jimp.read(albumArtTmpFilePath, (error, image) => {
    if (error)
      console.error(
        `Error: Could not read ${albumArtTmpFilePath} when resizing.`,
        error
      );
    image.contain(albumArtWidth, albumArtHeight).write(albumArtFilePath);
    console.log(`- Cover resized to ${albumArtFilePath}.`);
  });
};

const downloadAlbumCover = async ({ cover }) => {
  try {
    const response = await axios.get(cover, { responseType: "stream" });
    // Non-null album art: download and convert to png
    response.data
      .pipe(fs.createWriteStream(albumArtTmpFilePath))
      .on("error", (error) => {
        if (error)
          console.error(
            `Error: Could not write ${albumArtTmpFilePath} when downloading.`,
            error
          );
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

  if (currentTrack.cover !== "") {
    downloadAlbumCover(currentTrack);
  } else {
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
      `Error ${error.code}: ${error.message}. Check that YTMDesktop Remote API is running and your firewall is configured properly.`,
      error
    );
  }
}, pollIntervalMs);
