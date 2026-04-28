'use strict';

const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { assertAllowedStorageUrl } = require('./storageUrlAllowlist.cjs');
const { generateProfileFromText } = require('./generateProfileFromText.cjs');

function detectKindFromUrl(fileUrl) {
  const lower = fileUrl.split('?')[0].toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return 'unknown';
}

async function fetchAndExtractText(fileUrl) {
  assertAllowedStorageUrl(fileUrl);
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to download resume (${res.status}). Is the storage bucket public?`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const kind = detectKindFromUrl(fileUrl);
  const ct = (res.headers.get('content-type') || '').toLowerCase();

  if (kind === 'pdf' || ct.includes('pdf')) {
    const parser = new PDFParse({ data: buf });
    let data;
    try {
      data = await parser.getText();
    } finally {
      await parser.destroy();
    }
    const text = String(data.text || '').trim();
    if (text.length < 50) {
      throw new Error(
        'Could not extract meaningful text from this PDF. It may be scanned or image-based.'
      );
    }
    return text;
  }

  if (
    kind === 'docx' ||
    ct.includes('wordprocessingml') ||
    ct.includes('officedocument')
  ) {
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = String(result.value || '').trim();
    if (text.length < 50) {
      throw new Error('Could not extract meaningful text from this DOCX file.');
    }
    return text;
  }

  throw new Error('Unsupported file type. Please upload a PDF or DOCX file.');
}

module.exports = {
  assertAllowedStorageUrl,
  fetchAndExtractText,
  generateProfileFromText,
};
