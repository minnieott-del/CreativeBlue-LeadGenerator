
import React, { useState, useCallback, useEffect } from 'react';
import { Company, EmailContent, SenderProfile } from './types';
import { getSeriesALeads, generateEmailForCompany, getSenderProfile } from './services/geminiService';
import { filterVerifiedLeads } from './services/verificationService';
import { downloadCSV } from './services/csvService';
import CompanyTable from './components/CompanyTable';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorDisplay from './components/ErrorDisplay';
import InfoDisplay from './components/InfoDisplay';
import SuccessDisplay from './components/SuccessDisplay';
import EmailModal from './components/EmailModal';

// Using the direct content URL via Google's specialized delivery endpoint for Drive files
const LOGO_URL = "https://lh3.googleusercontent.com/d/14hb8xzArdGvTcACJIB2F85CJby3yNUtq";

const MAX_LEADS = parseInt((import.meta as any).env.VITE_MAX_LEADS || '5', 10);
const MAX_DAILY_RUNS = 5;

const getDailyUsage = () => {
  const today = new Date().toDateString();
  const savedDate = localStorage.getItem('lead_gen_date');
  if (savedDate !== today) {
    return { date: today, count: 0 };
  }
  const count = parseInt(localStorage.getItem('lead_gen_daily_count') || '0', 10);
  return { date: today, count: isNaN(count) ? 0 : count };
};

const App: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dailyRunsUsed, setDailyRunsUsed] = useState<number>(() => getDailyUsage().count);

  // Sender company website & profile state
  const [senderWebsite, setSenderWebsite] = useState<string>(() => {
    return localStorage.getItem('sender_company_website') || 'https://www.creativeblue.agency/';
  });
  const [senderProfile, setSenderProfile] = useState<SenderProfile | null>(null);
  const [isGeneratingIcp, setIsGeneratingIcp] = useState<boolean>(false);
  const [lastAnalyzedUrl, setLastAnalyzedUrl] = useState<string | null>(null);
  const [icpGeneratedForCompany, setIcpGeneratedForCompany] = useState<string | null>(null);

  const defaultIcp = "Startup companies in the United States that have either obtained or are seeking Series A round of funding.";
  const [icp, setIcp] = useState<string>(defaultIcp);
  const [isListening, setIsListening] = useState<boolean>(false);
  
  // Selection state
  const [selectedCompanyNames, setSelectedCompanyNames] = useState<Set<string>>(new Set());

  // Email generation queue state
  const [emailGenProgress, setEmailGenProgress] = useState<{ current: number; total: number } | null>(null);

  // Email modal preview state
  const [modalCompany, setModalCompany] = useState<Company | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Automatically generate Ideal Client Profile from website
  const generateIcpFromWebsite = useCallback(async (url: string, force = false) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!force && trimmed === lastAnalyzedUrl) return;

    const isLikelyUrl = trimmed.includes('.') && trimmed.length >= 4;
    if (!isLikelyUrl) return;

    setIsGeneratingIcp(true);
    try {
      const profile = await getSenderProfile(trimmed);
      setSenderProfile(profile);
      setLastAnalyzedUrl(trimmed);
      localStorage.setItem('sender_company_website', trimmed);

      if (profile.suggestedIcp && profile.suggestedIcp.trim()) {
        setIcp(profile.suggestedIcp.trim());
        setIcpGeneratedForCompany(profile.companyName || trimmed);
      }
    } catch (err) {
      console.warn("Could not automatically generate ICP from website:", err);
    } finally {
      setIsGeneratingIcp(false);
    }
  }, [lastAnalyzedUrl]);

  // Debounced auto-generation when website URL changes
  useEffect(() => {
    const trimmed = senderWebsite.trim();
    if (!trimmed || trimmed === lastAnalyzedUrl) return;

    const isLikelyUrl = trimmed.includes('.') && trimmed.length >= 4;
    if (!isLikelyUrl) return;

    const timer = setTimeout(() => {
      generateIcpFromWebsite(trimmed);
    }, 1100);

    return () => clearTimeout(timer);
  }, [senderWebsite, lastAnalyzedUrl, generateIcpFromWebsite]);

  const processEmailGeneration = useCallback(async (leadList: Company[], profile?: SenderProfile) => {
    let completed = 0;
    const total = leadList.length;
    setEmailGenProgress({ current: 0, total });

    for (const company of leadList) {
        if (company.emailDraft) {
            completed++;
            setEmailGenProgress({ current: completed, total });
            continue;
        }

        try {
            const draft = await generateEmailForCompany(company, profile);
            
            // Update state immediately
            setCompanies(prevCompanies => 
                prevCompanies.map(c => 
                    c.companyName === company.companyName 
                        ? { ...c, emailDraft: draft } 
                        : c
                )
            );
        } catch (e) {
            console.warn(`Failed to auto-generate email for ${company.companyName}`, e);
        }

        completed++;
        setEmailGenProgress({ current: completed, total });
    }

    setEmailGenProgress(null);
  }, []);


  const fetchCompanies = useCallback(async () => {
    if (!senderWebsite || !senderWebsite.trim()) {
      setError("Please enter the company website for whom the leads and emails are being generated.");
      return;
    }

    const usage = getDailyUsage();
    if (usage.count >= MAX_DAILY_RUNS) {
      setError(`You have reached your daily limit of ${MAX_DAILY_RUNS} research runs. Please try again tomorrow.`);
      return;
    }

    setIsLoading(true);
    setError(null);
    setInfo(null);
    setSuccessMessage(null);
    setCompanies([]);
    setSelectedCompanyNames(new Set());
    setEmailGenProgress(null);
    
    try {
      // 1. Ensure Sender Company Profile is loaded
      let profile = senderProfile;
      if (!profile || profile.websiteUrl !== senderWebsite.trim()) {
        setInfo(`Analyzing company profile from ${senderWebsite.trim()} to customize email copy...`);
        profile = await getSenderProfile(senderWebsite.trim());
        setSenderProfile(profile);
        localStorage.setItem('sender_company_website', senderWebsite.trim());
      }

      // 2. Research Phase (Gemini)
      setInfo(`Researching market prospects matching your Ideal Client Profile...`);
      const data = await getSeriesALeads(icp, [], MAX_LEADS);
      
      if (data.length > 0) {
        const nextCount = usage.count + 1;
        localStorage.setItem('lead_gen_date', usage.date);
        localStorage.setItem('lead_gen_daily_count', String(nextCount));
        localStorage.setItem('last_lead_gen_date', usage.date);
        setDailyRunsUsed(nextCount);
      }
      
      // 3. Verification Phase (Check Domains/MX/Parking)
      setInfo(`Verifying ${data.length} newly found leads...`);
      const verifiedLeads = await filterVerifiedLeads(data);

      const filteredCount = data.length - verifiedLeads.length;

      if (data.length > 0 && filteredCount > 0) {
          setInfo(`Market Research complete: Found ${data.length} potential leads. Verified ${verifiedLeads.length} valid companies (removed ${filteredCount} with invalid websites or emails). Customizing emails for ${profile.companyName}...`);
      } else if (data.length > 0) {
          setInfo(`Market Research complete: Found and verified ${data.length} leads. Customizing emails for ${profile.companyName}...`);
      }

      setCompanies(verifiedLeads);
      setSelectedCompanyNames(new Set(verifiedLeads.map(c => c.companyName)));
      
      // 4. Email Marketing Phase with Company Customization (Gemini)
      if (verifiedLeads.length > 0) {
          processEmailGeneration(verifiedLeads, profile);
      } else {
          setInfo("No new unique leads found that match your criteria.");
      }

    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'AUTH_TIMEOUT') {
             setError('Duplicate check timed out. Please ensure you allow the Google login popup or configure your Client ID correctly.');
        } else {
             setError(err.message);
        }
      } else {
        setError('An unknown error occurred.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [senderWebsite, senderProfile, icp, processEmailGeneration]);

  const handleToggleSelection = useCallback((companyName: string) => {
    setSelectedCompanyNames(prev => {
      const newSet = new Set(prev);
      if (newSet.has(companyName)) {
        newSet.delete(companyName);
      } else {
        newSet.add(companyName);
      }
      return newSet;
    });
  }, []);

  const handleBulkSelection = useCallback((companyNames: string[], shouldSelect: boolean) => {
    setSelectedCompanyNames(prev => {
      const newSet = new Set(prev);
      companyNames.forEach(name => {
        if (shouldSelect) {
          newSet.add(name);
        } else {
          newSet.delete(name);
        }
      });
      return newSet;
    });
  }, []);

  const handleDownloadCSV = useCallback(() => {
    const companiesToExport = companies.filter(c => selectedCompanyNames.has(c.companyName));
    
    if (companiesToExport.length === 0) {
        setInfo("No companies selected to export.");
        return;
    }

    try {
        downloadCSV(companiesToExport);
        setSuccessMessage(`Successfully downloaded CSV with ${companiesToExport.length} leads.`);
    } catch (err: any) {
        console.error("CSV Export error:", err);
        setError("Failed to download CSV.");
    }
  }, [companies, selectedCompanyNames]);

  const toggleVoiceRecognition = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError("Voice recognition is not supported in this browser.");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setIcp(prev => prev ? `${prev} ${transcript}` : transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setError(`Voice recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  }, [isListening]);


  return (
    <>
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col items-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-7xl mx-auto">
        <header className="flex flex-col items-center text-center mb-10">
          <div className="mb-6 h-24 sm:h-32 flex items-center justify-center">
            <img 
              src={LOGO_URL} 
              alt="Creative Blue Logo" 
              className="max-h-full w-auto object-contain"
              style={{ display: 'block' }}
              onError={(e) => {
                console.error("Logo failed to load");
                const img = e.target as HTMLImageElement;
                if (!img.dataset.retried) {
                    img.dataset.retried = 'true';
                    img.src = `${LOGO_URL}?t=${Date.now()}`;
                }
              }}
            />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-blue-800">
            Lead Generator
          </h1>
          <p className="mt-2 text-lg text-slate-500">
            AI-Powered Market Research & Customized Outreach Automation
          </p>
        </header>

        <main className="flex flex-col items-center">
          <div className="w-full max-w-2xl bg-white p-6 rounded-lg border border-slate-200 shadow-sm mb-8">
             
             {/* 1. Prompt for Company Website */}
             <div className="mb-6">
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="senderWebsite" className="block text-sm font-semibold text-slate-800">
                      Your Company Website (Lead Generation Beneficiary)
                  </label>
                  {isGeneratingIcp ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 animate-pulse">
                      <svg className="animate-spin h-3.5 w-3.5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing Website & Generating ICP...
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => generateIcpFromWebsite(senderWebsite, true)}
                      disabled={isGeneratingIcp || !senderWebsite.trim()}
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Analyze website and automatically generate the Ideal Client Profile"
                    >
                      <span>✨ Auto-Generate ICP</span>
                    </button>
                  )}
                </div>
                
                <div className="relative">
                  <input
                      id="senderWebsite"
                      type="url"
                      value={senderWebsite}
                      onChange={(e) => setSenderWebsite(e.target.value)}
                      onBlur={() => generateIcpFromWebsite(senderWebsite, false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          generateIcpFromWebsite(senderWebsite, true);
                        }
                      }}
                      placeholder="https://www.creativeblue.agency/ or https://yourcompany.com"
                      className="w-full p-3 pr-28 bg-white border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-slate-800 placeholder-slate-400 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => generateIcpFromWebsite(senderWebsite, true)}
                    disabled={isGeneratingIcp || !senderWebsite.trim()}
                    className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded border border-blue-200 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeneratingIcp ? 'Analyzing...' : 'Generate ICP'}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                    Enter any company website to automatically synthesize the Ideal Client Profile (ICP) and customize cold email outreach.
                </p>

                {senderProfile && (
                  <div className="mt-3 p-3 bg-blue-50/80 border border-blue-200 rounded-md text-xs text-blue-900 flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-semibold text-blue-900">Analyzed Company: {senderProfile.companyName}</span>
                      <span className="text-blue-600 font-mono text-[11px]">{senderProfile.websiteUrl}</span>
                    </div>
                    <p className="text-slate-600 text-xs">{senderProfile.description}</p>
                    {senderProfile.services && senderProfile.services.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {senderProfile.services.map((svc, idx) => (
                          <span key={idx} className="bg-blue-100/90 text-blue-800 px-2 py-0.5 rounded text-[11px] font-medium border border-blue-200">
                            {svc}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
             </div>

             {/* 2. Ideal Client Profile Query */}
             <div>
                <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor="icp" className="block text-sm font-semibold text-slate-800">
                          Ideal Client Profile & Target Criteria
                      </label>
                      {icpGeneratedForCompany && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                          ✨ Auto-Generated for {icpGeneratedForCompany}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={toggleVoiceRecognition}
                        className={`p-1.5 rounded-full transition-colors ${isListening ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        title={isListening ? "Stop Listening" : "Start Voice Recognition"}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </button>
                    </div>
                </div>
                <div className="relative">
                  <textarea
                      id="icp"
                      value={icp}
                      onChange={(e) => setIcp(e.target.value)}
                      placeholder="e.g., B2B SaaS companies in the fintech space that recently raised Series A..."
                      className={`w-full h-24 p-3 bg-white border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-slate-800 placeholder-slate-400 text-sm ${
                        isGeneratingIcp ? 'border-blue-400 bg-blue-50/30 animate-pulse' : 'border-slate-300'
                      }`}
                  />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-slate-400">
                    Target criteria used by the AI Researcher. Will generate up to {MAX_LEADS} leads.
                  </p>
                  {icp !== defaultIcp && (
                    <button
                      type="button"
                      onClick={() => {
                        setIcp(defaultIcp);
                        setIcpGeneratedForCompany(null);
                      }}
                      className="text-[11px] text-slate-400 hover:text-slate-600 underline"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
             </div>
          </div>
        
          <div className="w-full flex flex-col items-center gap-2 mb-8">
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button
                onClick={fetchCompanies}
                disabled={isLoading || (emailGenProgress !== null) || dailyRunsUsed >= MAX_DAILY_RUNS}
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-lg hover:bg-blue-700 disabled:bg-blue-900 disabled:cursor-not-allowed disabled:text-gray-400 transition-all duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
              >
                {isLoading ? 'Researching Market...' : (emailGenProgress ? `Drafting Customized Emails (${emailGenProgress.current}/${emailGenProgress.total})...` : 'Start Research & Generate Leads')}
              </button>
              
              {companies.length > 0 && (
                  <div className="flex gap-2">
                      <button
                          onClick={handleDownloadCSV}
                          disabled={selectedCompanyNames.size === 0}
                          className="px-8 py-3 bg-green-600 text-white font-bold rounded-lg shadow-lg hover:bg-green-700 disabled:bg-green-900 disabled:cursor-not-allowed disabled:text-gray-400 transition-all duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 flex items-center gap-2"
                      >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          {selectedCompanyNames.size > 0 
                              ? `Download CSV (${selectedCompanyNames.size})` 
                              : 'Download CSV'}
                      </button>
                  </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
              <span>Daily Usage:</span>
              <span className={`font-semibold ${dailyRunsUsed >= MAX_DAILY_RUNS ? 'text-amber-600' : 'text-slate-700'}`}>
                {dailyRunsUsed} / {MAX_DAILY_RUNS} runs used today
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-500">
                {Math.max(0, MAX_DAILY_RUNS - dailyRunsUsed)} runs remaining
              </span>
            </div>
          </div>
          
          <div className="w-full">
            {isLoading && <LoadingSpinner />}
            {emailGenProgress && (
                <div className="mb-4 w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${(emailGenProgress.current / emailGenProgress.total) * 100}%` }}></div>
                    <p className="text-center text-xs text-slate-500 mt-1">Automatically generating customized email drafts: {emailGenProgress.current} / {emailGenProgress.total}</p>
                </div>
            )}
            {error && <ErrorDisplay message={error} />}
            {info && <InfoDisplay message={info} />}
            {successMessage && <SuccessDisplay message={successMessage} />}
            {companies.length > 0 && !isLoading && (
              <CompanyTable 
                companies={companies} 
                selectedCompanyNames={selectedCompanyNames}
                onToggleSelection={handleToggleSelection}
                onBulkSelection={handleBulkSelection}
                onViewEmail={(comp) => {
                  setModalCompany(comp);
                  setIsModalOpen(true);
                }}
              />
            )}
            {!isLoading && !error && companies.length === 0 && (
                 <div className="text-center p-8 bg-white rounded-lg border border-slate-200 shadow-sm">
                    <p className="text-slate-500">Provide your company website and refine your Ideal Client Profile above, then click the button to start the AI research process.</p>
                </div>
            )}
          </div>
        </main>
      </div>

      {/* Email Preview Modal */}
      <EmailModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setModalCompany(null);
        }}
        company={modalCompany}
        emailContent={modalCompany?.emailDraft || null}
        isLoading={false}
        error={null}
        senderProfile={senderProfile}
      />
    </div>
    </>
  );
};

export default App;

