import React, { useRef, useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from './Button';

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  progress: number;
  status: 'idle' | 'uploading' | 'analyzing' | 'complete' | 'error';
  statusText?: string;
  fileName?: string;
  disabled?: boolean;
}

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  onFileSelect,
  accept = '.pdf,.docx',
  progress,
  status,
  statusText,
  fileName,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = () => {
    if (!disabled && status !== 'uploading' && status !== 'analyzing') {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
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
    if (file) onFileSelect(file);
  }, [disabled, onFileSelect]);

  const isProcessing = status === 'uploading' || status === 'analyzing';

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
        className={`border-2 border-dashed rounded-2xl p-8 cursor-pointer transition-all ${
          status === 'complete'
            ? 'border-green-500 bg-green-50/30'
            : isDragOver
            ? 'border-indigo-500 bg-indigo-50/30'
            : status === 'error'
            ? 'border-red-300 bg-red-50/30'
            : 'border-gray-300 hover:border-indigo-400'
        }`}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center">
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
            <FileText className="w-8 h-8 mb-2" />
            <span className="font-semibold text-sm">
              {fileName || 'Resume Analyzed & Data Extracted'}
            </span>
            <p className="text-xs mt-1 text-green-600 opacity-70">
              We've pre-filled your profile. Click to upload a different file.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-gray-400">
            <p className="font-medium mb-1 text-gray-700">
              Drag & drop your resume, or click to browse
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
