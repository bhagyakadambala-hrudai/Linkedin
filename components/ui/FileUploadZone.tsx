import React, { useRef, useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle2, Loader2, ExternalLink } from 'lucide-react';
import { Button } from './Button';

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  progress: number;
  status: 'idle' | 'uploading' | 'analyzing' | 'complete' | 'error';
  statusText?: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
}

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  onFileSelect,
  accept = '.pdf,.docx',
  progress,
  status,
  statusText,
  fileName,
  fileUrl,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localFileName, setLocalFileName] = useState('');

  const handleClick = () => {
    if (!disabled && status !== 'uploading' && status !== 'analyzing') {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLocalFileName(file.name);
      onFileSelect(file);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setLocalFileName(file.name);
      onFileSelect(file);
    }
  }, [disabled, onFileSelect]);

  const isProcessing = status === 'uploading' || status === 'analyzing';
  const displayName = fileName || localFileName;

  return (
    <div className="text-center">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept={accept}
        onChange={handleFileChange}
      />

      <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${
        status === 'complete' ? 'bg-green-50' : 'bg-indigo-50'
      }`}>
        {isProcessing ? (
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        ) : status === 'complete' ? (
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        ) : (
          <Upload className="w-8 h-8 text-indigo-600" />
        )}
      </div>

      <h3 className="text-lg font-bold text-gray-900 mb-1">Resume Context</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
        Our AI agents analyze your resume to auto-fill your profile and suggest trending topics.
      </p>

      <div
        className={`border-2 border-dashed rounded-2xl p-8 transition-all ${
          status === 'complete'
            ? 'border-green-500 bg-green-50/30'
            : isDragOver
            ? 'border-indigo-500 bg-indigo-50/30'
            : status === 'error'
            ? 'border-red-300 bg-red-50/30'
            : 'border-gray-300 hover:border-indigo-400'
        } ${status !== 'complete' ? 'cursor-pointer' : ''}`}
        onClick={status !== 'complete' ? handleClick : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center">
            {displayName && (
              <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100">
                <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="text-xs font-medium text-indigo-700 truncate max-w-xs">
                  {displayName}
                </span>
              </div>
            )}
            <span className="text-sm font-medium text-indigo-600 mb-3">
              {statusText || 'Processing...'}
            </span>
            <div className="w-full max-w-xs bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 mt-2">{progress}%</span>
          </div>
        ) : status === 'complete' ? (
          <div className="flex flex-col items-center text-green-700">
            <FileText className="w-8 h-8 mb-3 text-green-600" />

            {/* Clickable filename — opens file in new tab */}
            {fileUrl ? (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 font-semibold text-sm text-green-700 hover:text-green-800 underline underline-offset-2 transition-colors"
              >
                <span className="truncate max-w-xs">
                  {displayName || 'Resume Analyzed & Data Extracted'}
                </span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              </a>
            ) : (
              <span className="font-semibold text-sm">
                {displayName || 'Resume Analyzed & Data Extracted'}
              </span>
            )}

            <p className="text-xs mt-2 text-green-600 opacity-70">
              Profile pre-filled from your resume.{' '}
              <button
                type="button"
                onClick={handleClick}
                className="underline hover:opacity-100 opacity-80 transition-opacity"
              >
                Upload a different file
              </button>
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-gray-400">
            {displayName && status === 'error' ? (
              <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-red-50 rounded-lg border border-red-100">
                <FileText className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-xs font-medium text-red-600 truncate max-w-xs">
                  {displayName}
                </span>
              </div>
            ) : null}
            <p className="font-medium mb-1 text-gray-700">
              {status === 'error'
                ? 'Upload failed — try again'
                : 'Drag & drop your resume, or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mb-3">PDF or DOCX up to 10MB</p>
            <Button variant="outline" size="sm" type="button">
              Choose File
            </Button>
          </div>
        )}
      </div>

      {status === 'complete' && (
        <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-gray-400">
          <span>Powered by Google Gemini AI</span>
        </div>
      )}
    </div>
  );
};
