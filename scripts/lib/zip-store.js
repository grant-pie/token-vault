// A minimal ZIP writer, STORE method only (no compression). Used by
// build-set-zips.js instead of a library like archiver because the source images
// are already compressed (PNG/WebP) — re-deflating them buys negligible size
// savings for real CPU cost, so a plain "concatenate the bytes" zip is both
// simpler and faster to build. Uses Node's built-in zlib.crc32 (Node >= 21.4),
// so this has zero npm dependencies.
//
// Standard (non-Zip64) format only: fine here since a single zip stays well
// under the 4GB/65535-entry ceiling that would require it.

const fs = require("fs");
const zlib = require("zlib");

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const UTF8_NAME_FLAG = 0x0800; // general-purpose bit 11: filename is UTF-8

// Packs a JS Date into MS-DOS date/time fields (2-second granularity), as
// used by the zip local/central file headers.
function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, dosDate };
}

// Writes `entries` (array of { name, path }) as a STORE-method zip to
// `outPath`. `name` is the path recorded inside the zip (use forward
// slashes); `path` is the absolute source file to read. Returns the total
// byte size written.
function writeZip(entries, outPath) {
  const fd = fs.openSync(outPath, "w");
  let offset = 0;
  const central = [];

  try {
    for (const { name, path: srcPath } of entries) {
      const data = fs.readFileSync(srcPath);
      const crc = zlib.crc32(data);
      const { time, dosDate } = dosDateTime(fs.statSync(srcPath).mtime);
      const nameBuf = Buffer.from(name, "utf8");

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
      localHeader.writeUInt16LE(20, 4); // version needed to extract
      localHeader.writeUInt16LE(UTF8_NAME_FLAG, 6);
      localHeader.writeUInt16LE(0, 8); // compression method: 0 = STORE
      localHeader.writeUInt16LE(time, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(data.length, 18); // compressed size
      localHeader.writeUInt32LE(data.length, 22); // uncompressed size
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28); // extra field length

      fs.writeSync(fd, localHeader);
      fs.writeSync(fd, nameBuf);
      fs.writeSync(fd, data);

      central.push({ nameBuf, crc, size: data.length, time, dosDate, offset });
      offset += localHeader.length + nameBuf.length + data.length;
    }

    const centralStart = offset;
    for (const e of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
      header.writeUInt16LE(20, 4); // version made by
      header.writeUInt16LE(20, 6); // version needed to extract
      header.writeUInt16LE(UTF8_NAME_FLAG, 8);
      header.writeUInt16LE(0, 10); // compression method: STORE
      header.writeUInt16LE(e.time, 12);
      header.writeUInt16LE(e.dosDate, 14);
      header.writeUInt32LE(e.crc, 16);
      header.writeUInt32LE(e.size, 20); // compressed size
      header.writeUInt32LE(e.size, 24); // uncompressed size
      header.writeUInt16LE(e.nameBuf.length, 28);
      header.writeUInt16LE(0, 30); // extra field length
      header.writeUInt16LE(0, 32); // comment length
      header.writeUInt16LE(0, 34); // disk number start
      header.writeUInt16LE(0, 36); // internal attributes
      header.writeUInt32LE(0, 38); // external attributes
      header.writeUInt32LE(e.offset, 42); // local header offset

      fs.writeSync(fd, header);
      fs.writeSync(fd, e.nameBuf);
      offset += header.length + e.nameBuf.length;
    }
    const centralSize = offset - centralStart;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
    end.writeUInt16LE(0, 4); // this disk number
    end.writeUInt16LE(0, 6); // disk where central dir starts
    end.writeUInt16LE(central.length, 8); // central dir records on this disk
    end.writeUInt16LE(central.length, 10); // total central dir records
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralStart, 16);
    end.writeUInt16LE(0, 20); // comment length

    fs.writeSync(fd, end);
    offset += end.length;
  } finally {
    fs.closeSync(fd);
  }

  return offset;
}

// Reads the entry count out of a zip's end-of-central-directory record
// (its last 22 bytes, since writeZip() never adds a zip comment). Used by
// generate-set-zips-data.js to report image counts without re-scanning the
// source image folders.
function readEntryCount(zipPath) {
  const size = fs.statSync(zipPath).size;
  const fd = fs.openSync(zipPath, "r");
  try {
    const buf = Buffer.alloc(22);
    fs.readSync(fd, buf, 0, 22, size - 22);
    if (buf.readUInt32LE(0) !== END_OF_CENTRAL_DIR_SIG) {
      throw new Error(`${zipPath}: end-of-central-directory record not found where expected`);
    }
    return buf.readUInt16LE(10);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { writeZip, readEntryCount };
