// Reads the resumes folder and pulls the plain text out of each file, so the
// matcher can compare a job posting with what each resume actually says.
// PDF (pdf.js), DOCX (built-in zip reader) and TXT/MD are supported. Text is
// cached by file size and modified time, so a folder of resumes reads once.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readJson, writeJson } from './config.mjs';

export const RESUME_EXT = /\.(pdf|docx|txt|md)$/i;

/** Minimal zip reader: returns the inflated bytes of one entry, or null. */
export function readZipEntry(buf, wanted) {
  // find the End Of Central Directory record (last 64k of the file)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

export function docxText(buf) {
  const xml = readZipEntry(buf, 'word/document.xml');
  if (!xml) return '';
  return xml.toString('utf8')
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export async function pdfText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
  }
  await doc.destroy();
  return parts.join('\n').replace(/[ \t]+/g, ' ').trim();
}

export async function extractText(file) {
  const buf = fs.readFileSync(file);
  if (/\.pdf$/i.test(file)) return pdfText(buf);
  if (/\.docx$/i.test(file)) return docxText(buf);
  return buf.toString('utf8');
}

/**
 * Every resume in the folder with its text. Rules from resumes/resumes.json
 * (optional) add role tags, extra keywords and the default resume.
 */
export async function listResumes(ws, { log = () => {} } = {}) {
  if (!fs.existsSync(ws.resumes)) return [];
  const rules = readJson(ws.resumeRules, {});
  const cache = readJson(ws.resumeCache, {});
  const files = fs.readdirSync(ws.resumes).filter((f) => RESUME_EXT.test(f) && !f.startsWith('.')).sort();
  const out = [];
  let dirty = false;
  for (const file of files) {
    const full = path.join(ws.resumes, file);
    const st = fs.statSync(full);
    const stamp = `${st.size}:${Math.floor(st.mtimeMs)}`;
    let text = cache[file]?.stamp === stamp ? cache[file].text : null;
    if (text == null) {
      try { text = await extractText(full); }
      catch (e) { log(`could not read ${file}: ${e.message}`); text = ''; }
      cache[file] = { stamp, text };
      dirty = true;
    }
    const rule = (rules.resumes || {})[file] || {};
    out.push({
      file,
      path: full,
      name: file.replace(RESUME_EXT, ''),
      text,
      tags: rule.tags || null,
      keywords: rule.keywords || [],
      isDefault: rules.default === file,
    });
  }
  for (const k of Object.keys(cache)) if (!files.includes(k)) { delete cache[k]; dirty = true; }
  if (dirty) writeJson(ws.resumeCache, cache);
  return out;
}
