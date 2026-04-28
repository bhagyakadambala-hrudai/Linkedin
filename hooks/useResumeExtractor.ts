// Client-side PDF/DOCX text extraction with lazy-loaded libraries

import { useState, useCallback } from 'react';

export function useResumeExtractor() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractText = useCallback(async (file: File): Promise<string> => {
    setIsExtracting(true);
    setError(null);

    try {
      const fileType = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';

      if (fileType === 'pdf') {
        return await extractFromPDF(file);
      } else {
        return await extractFromDOCX(file);
      }
    } catch (err: any) {
      const message = err.message || 'Failed to extract text from file.';
      setError(message);
      throw new Error(message);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  return { extractText, isExtracting, error };
}

async function extractFromPDF(file: File): Promise<string> {
  // Dynamically import pdf.js
  const pdfjsLib = await import('pdfjs-dist');
  
  // Use unpkg CDN for the worker - more reliable than cdnjs
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ');
    textParts.push(pageText);
  }

  const fullText = textParts.join('\n\n');
  if (fullText.trim().length < 50) {
    throw new Error('Could not extract meaningful text from this PDF. It may be scanned or image-based.');
  }

  return fullText;
}

async function extractFromDOCX(file: File): Promise<string> {
  // Dynamically import mammoth
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });

  if (result.value.trim().length < 50) {
    throw new Error('Could not extract meaningful text from this DOCX file.');
  }

  return result.value;
}
