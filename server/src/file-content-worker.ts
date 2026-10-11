// Static worker program: user input is passed via workerData, never interpolated.
// Keeping the program as JS lets both the TS test runner and compiled production
// server start the same isolated parser without a runtime TS loader.
export const FILE_INSPECTOR_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { readFile, stat } = require('node:fs/promises');
const CFB = require('cfb');
const yauzl = require('yauzl');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseXml(buffer, root, namespaces) {
  const text = buffer.toString('utf8');
  // No DTD/entity expansion, even for internal entities.
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) return undefined;
  const tree = new XMLParser({ ignoreAttributes: false,
    processEntities: false, parseAttributeValue: false }).parse(text);
  const keys = Object.keys(tree).filter(key => key.split(':').pop() === root);
  if (keys.length !== 1) return undefined;
  const key = keys[0], value = tree[key];
  const namespace = key.includes(':') ? value['@_xmlns:' + key.split(':')[0]] : value['@_xmlns'];
  return namespaces.includes(namespace) ? value : undefined;
}

function array(value) { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function children(value, name) {
  return Object.entries(value).filter(([key]) => key.split(':').pop() === name).flatMap(([, value]) => array(value));
}

async function officeZip(path, extension) {
  const zip = await new Promise((resolve, reject) => yauzl.open(path,
    { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true },
    (error, zip) => error ? reject(error) : resolve(zip)));
  try {
    const entries = await new Promise((resolve, reject) => {
      const result = new Map();
      let expanded = 0;
      zip.on('error', reject);
      zip.on('entry', entry => {
        expanded += entry.uncompressedSize;
        if (result.has(entry.fileName) || result.size >= 4096 || expanded > 200 * 1024 * 1024 ||
            (entry.generalPurposeBitFlag & 1) || ![0, 8].includes(entry.compressionMethod)) {
          reject(new Error('unsupported_zip')); return;
        }
        result.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on('end', () => resolve(result));
      zip.readEntry();
    });
    const readEntry = async (name, limit) => {
      const entry = entries.get(name);
      if (!entry || entry.uncompressedSize === 0 || entry.uncompressedSize > limit) throw new Error('invalid_part');
      const stream = await new Promise((resolve, reject) => zip.openReadStream(entry,
        (error, stream) => error ? reject(error) : resolve(stream)));
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > limit) throw new Error('part_too_large');
          chunks.push(chunk);
        }
      } finally { stream.destroy(); }
      const buffer = Buffer.concat(chunks);
      if (crc32(buffer) !== entry.crc32) throw new Error('invalid_crc');
      return buffer;
    };
    const types = parseXml(await readEntry('[Content_Types].xml', 1024 * 1024), 'Types',
      ['http://schemas.openxmlformats.org/package/2006/content-types']);
    const rels = parseXml(await readEntry('_rels/.rels', 1024 * 1024), 'Relationships',
      ['http://schemas.openxmlformats.org/package/2006/relationships']);
    if (!types || !rels) return false;
    const main = extension === '.docx' ? 'word/document.xml' : 'xl/workbook.xml';
    const mime = extension === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
    if (!children(types, 'Override').some(x => x['@_PartName'] === '/' + main && x['@_ContentType'] === mime)) return false;
    if (!children(rels, 'Relationship').some(x =>
      /^https?:\/\/(schemas.openxmlformats.org\/officeDocument\/2006|purl.oclc.org\/ooxml\/officeDocument)\/relationships\/officeDocument$/.test(x['@_Type']) &&
      !x['@_TargetMode'] && [main, '/' + main].includes(x['@_Target']))) return false;
    // A ZIP with a folder named word/ or xl/ is not enough. Its declared main
    // part must exist and contain well-formed XML with the expected root.
    const word = extension === '.docx';
    return parseXml(await readEntry(main, 16 * 1024 * 1024), word ? 'document' : 'workbook', word
      ? ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']
      : ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']) !== undefined;
  } finally { zip.close(); }
}

function validFat(buffer, shift, sectors) {
  const size = 2 ** shift, fats = [], difats = new Set();
  const add = value => { if (value !== -1) fats.push(value); };
  for (let offset = 76; offset < 512; offset += 4) add(buffer.readInt32LE(offset));
  let next = buffer.readInt32LE(68);
  const count = buffer.readUInt32LE(72);
  if (fats.length > buffer.readUInt32LE(44)) return false;
  for (let i = 0; i < count; i++) {
    if (next < 0 || next >= sectors || difats.has(next)) return false;
    difats.add(next);
    const start = (next + 1) * size;
    for (let offset = 0; offset < size - 4; offset += 4) add(buffer.readInt32LE(start + offset));
    if (fats.length > buffer.readUInt32LE(44)) return false;
    next = buffer.readInt32LE(start + size - 4);
  }
  if (next !== -2 || fats.length !== buffer.readUInt32LE(44) || new Set(fats).size !== fats.length ||
      fats.some(x => x < 0 || x >= sectors) || fats.length * (size / 4) < sectors) return false;
  const values = new Int32Array(sectors), color = new Uint8Array(sectors);
  for (let sector = 0; sector < sectors; sector++) {
    const index = Math.floor(sector / (size / 4));
    values[sector] = buffer.readInt32LE((fats[index] + 1) * size + (sector % (size / 4)) * 4);
    if (values[sector] >= sectors || values[sector] < -4) return false;
  }
  if (fats.some(x => values[x] !== -3) || [...difats].some(x => values[x] !== -4)) return false;
  // Every sector graph must terminate; do not rely on permissive Office parsing
  // to reject corrupt/cyclic chains. Iterative traversal is linear and bounded.
  for (let sector = 0; sector < sectors; sector++) {
    let cursor = sector;
    const trail = [];
    while (cursor >= 0 && color[cursor] === 0) {
      color[cursor] = 1;
      trail.push(cursor);
      cursor = values[cursor];
    }
    if (cursor >= 0 && color[cursor] === 1) return false;
    for (const visited of trail) color[visited] = 2;
  }
  return true;
}

function legacyOffice(buffer, extension) {
  if (buffer.length < 512 || buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') return false;
  const shift = buffer.readUInt16LE(30);
  if (![9, 12].includes(shift) || buffer.readUInt16LE(28) !== 0xfffe) return false;
  const sectors = Math.floor(buffer.length / (2 ** shift)) - 1;
  if (buffer.readUInt32LE(44) > sectors || buffer.readUInt32LE(48) >= sectors ||
      buffer.readUInt32LE(64) > sectors || buffer.readUInt32LE(72) > sectors) return false;
  if (!validFat(buffer, shift, sectors)) return false;
  const container = CFB.parse(buffer);
  const stream = name => container.FileIndex.find(x => x.type === 2 && x.name === name)?.content;
  if (extension === '.doc') {
    const word = stream('WordDocument');
    if (!word || word.length < 32 || word.readUInt16LE(0) !== 0xa5ec) return false;
    // Encrypted documents cannot be inspected. Modern binary Word also has a table stream.
    if (word.readUInt16LE(10) & 0x0100) return false;
    return word.readUInt16LE(2) < 0x00c1 || Boolean(stream(word.readUInt16LE(10) & 0x0200 ? '1Table' : '0Table'));
  }
  const book = stream('Workbook') ?? stream('Book');
  return Boolean(book && book.length >= 8 && [0x0809, 0x0409, 0x0209, 0x0009].includes(book.readUInt16LE(0)) &&
    book.readUInt16LE(2) >= 4 && book.readUInt16LE(2) <= book.length - 4 && book.readUInt16LE(6) === 0x0005);
}

function png(buffer) {
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false;
  let offset = 8, data = false, header = false;
  while (offset + 12 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    if (size > buffer.length - offset - 12) return false;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + size)) !== buffer.readUInt32BE(offset + 8 + size)) return false;
    if (!header) {
      if (type !== 'IHDR' || size !== 13 || !buffer.readUInt32BE(offset + 8) || !buffer.readUInt32BE(offset + 12)) return false;
      header = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') data = true;
    offset += size + 12;
    if (type === 'IEND') return size === 0 && data && offset === buffer.length;
  }
  return false;
}

function jpeg(buffer) {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8 || buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) return false;
  let offset = 2, frame = false;
  while (offset < buffer.length - 2) {
    if (buffer[offset++] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (offset + 2 > buffer.length) return false;
    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > buffer.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 8 || !buffer.readUInt16BE(offset + 3) || !buffer.readUInt16BE(offset + 5)) return false;
      frame = true;
    }
    if (marker === 0xda) return frame && size >= 6 && offset + size < buffer.length - 2;
    offset += size;
  }
  return false;
}

(async () => {
  const { diskPath, extension } = workerData;
  const info = await stat(diskPath);
  if (!info.isFile() || !info.size || info.size > 50 * 1024 * 1024) return false;
  if (['.docx', '.xlsx'].includes(extension)) return officeZip(diskPath, extension);
  const { fileTypeFromFile } = await import('file-type');
  const detected = await fileTypeFromFile(diskPath);
  const expected = { '.pdf': 'pdf', '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.doc': 'cfb', '.xls': 'cfb' }[extension];
  if (detected?.ext !== expected) return false;
  const buffer = await readFile(diskPath);
  if (extension === '.pdf') {
    if (!/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(buffer.subarray(0, 16).toString('ascii')) ||
        !/%%EOF[\x00\t\n\f\r ]*$/.test(buffer.subarray(-1024).toString('latin1'))) return false;
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    return pdf.getPageCount() > 0;
  }
  if (extension === '.png') return png(buffer);
  if (['.jpg', '.jpeg'].includes(extension)) return jpeg(buffer);
  return legacyOffice(buffer, extension);
})().then(result => parentPort.postMessage(result === true)).catch(() => parentPort.postMessage(false));
`;
