
import React, { useState } from 'react';
import { Company, EmailContent, SenderProfile } from '../types';
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';

interface EmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  company: Company | null;
  emailContent: EmailContent | null;
  isLoading: boolean;
  error: string | null;
  senderProfile?: SenderProfile | null;
}

const LOGO_URL = "https://lh3.googleusercontent.com/d/14hb8xzArdGvTcACJIB2F85CJby3yNUtq";

const EmailModal: React.FC<EmailModalProps> = ({ 
  isOpen, 
  onClose, 
  company, 
  emailContent, 
  isLoading, 
  error,
  senderProfile 
}) => {
  const [subjectCopied, setSubjectCopied] = useState(false);
  const [bodyCopied, setBodyCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = (text: string, type: 'subject' | 'body') => {
    navigator.clipboard.writeText(text);
    if (type === 'subject') {
      setSubjectCopied(true);
      setTimeout(() => setSubjectCopied(false), 2000);
    } else {
      setBodyCopied(true);
      setTimeout(() => setBodyCopied(false), 2000);
    }
  };

  const senderFromText = senderProfile?.companyName 
    ? `${senderProfile.companyName} Outreach Team`
    : 'minnie.ott@thinkcreativeblue.com';

  return (
    <div 
        className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4"
        onClick={onClose}
        aria-modal="true"
        role="dialog"
    >
      <div 
        className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex justify-between items-center p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
             <img 
                src={LOGO_URL} 
                alt="Creative Blue" 
                className="h-10 w-auto object-contain"
                style={{ display: 'block' }}
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (!img.dataset.retried) {
                    img.dataset.retried = 'true';
                    img.src = `${LOGO_URL}?t=${Date.now()}`;
                  }
                }}
             />
             <h2 className="text-lg font-semibold text-slate-900">Draft Email for {company?.companyName}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl" aria-label="Close modal">&times;</button>
        </header>
        <div className="p-6 overflow-y-auto">
          {isLoading && <LoadingSpinner />}
          {error && <ErrorDisplay message={error} />}
          {emailContent && !isLoading && (
            <div className="space-y-4 text-slate-600">
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase">From</label>
                <p className="p-2 bg-slate-50 rounded-md border border-slate-200">{senderFromText}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase">To</label>
                <p className="p-2 bg-slate-50 rounded-md border border-slate-200">{company?.emailAddress || 'N/A'}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase flex justify-between items-center">
                    <span>Subject</span>
                    <button 
                        onClick={() => handleCopy(emailContent.subject, 'subject')} 
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors border border-slate-200"
                    >
                        {subjectCopied ? 'Copied!' : 'Copy'}
                    </button>
                </label>
                <p className="p-2 bg-slate-50 rounded-md font-medium border border-slate-200">{emailContent.subject}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase flex justify-between items-center">
                    <span>Body</span>
                    <button 
                        onClick={() => handleCopy(emailContent.body, 'body')}
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors border border-slate-200"
                    >
                        {bodyCopied ? 'Copied!' : 'Copy'}
                    </button>
                </label>
                <div className="p-3 bg-slate-50 rounded-md mt-1 text-sm leading-relaxed whitespace-pre-wrap border border-slate-200 h-64 overflow-y-auto">
                    {emailContent.body}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailModal;

