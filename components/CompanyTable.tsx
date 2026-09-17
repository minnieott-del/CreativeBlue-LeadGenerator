
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Company } from '../types';

interface CompanyTableProps {
  companies: Company[];
  selectedCompanyNames: Set<string>;
  onToggleSelection: (companyName: string) => void;
  onBulkSelection: (companyNames: string[], shouldSelect: boolean) => void;
  onViewEmail?: (company: Company) => void;
}

const CompanyTable: React.FC<CompanyTableProps> = ({ 
  companies, 
  selectedCompanyNames,
  onToggleSelection,
  onBulkSelection,
  onViewEmail
}) => {
  const [founderFilter, setFounderFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const headers = [
    'Select',
    'Company Name',
    'Description',
    'Latest News',
    'Website',
    'LinkedIn',
    'Industry',
    'Headquarters State',
    'Contact Title',
    'Contact Name',
    'Email Address',
    'Founder Name',
    'Founder Email',
    'Email Subject',
    'Email Body',
  ];

  // Helper function to ensure URL has protocol
  const getSafeUrl = (url: string) => {
    if (!url) return '#';
    const trimmedUrl = url.trim();
    if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
      return trimmedUrl;
    }
    return `https://${trimmedUrl}`;
  };

  const isValidUrl = (url: string) => {
      if (!url) return false;
      const lower = url.toLowerCase().trim();
      return lower.length > 0 && !['n/a', 'none', 'unavailable', 'not found', 'null', '-'].includes(lower);
  };

  // Extract unique values for dropdowns
  const uniqueIndustries = useMemo(() => {
    const industries = new Set(companies.map(c => c.industry).filter(Boolean));
    return Array.from(industries).sort();
  }, [companies]);

  const uniqueStates = useMemo(() => {
    const states = new Set(companies.map(c => c.headquartersState).filter(Boolean));
    return Array.from(states).sort();
  }, [companies]);

  // Filter logic
  const filteredCompanies = useMemo(() => {
    return companies.filter(company => {
      const matchesFounder = company.founderName.toLowerCase().includes(founderFilter.toLowerCase());
      const matchesIndustry = industryFilter === '' || company.industry === industryFilter;
      const matchesState = stateFilter === '' || company.headquartersState === stateFilter;

      return matchesFounder && matchesIndustry && matchesState;
    });
  }, [companies, founderFilter, industryFilter, stateFilter]);

  // Selection logic
  const allFilteredSelected = filteredCompanies.length > 0 && filteredCompanies.every(c => selectedCompanyNames.has(c.companyName));
  const isIndeterminate = filteredCompanies.some(c => selectedCompanyNames.has(c.companyName)) && !allFilteredSelected;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleHeaderCheckboxChange = () => {
    const names = filteredCompanies.map(c => c.companyName);
    // If all currently filtered are selected, unselect them. Otherwise, select them all.
    onBulkSelection(names, !allFilteredSelected);
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Filter Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex flex-col">
          <label htmlFor="founderFilter" className="text-xs font-semibold text-slate-500 uppercase mb-1">Filter by Founder</label>
          <input
            id="founderFilter"
            type="text"
            placeholder="Search founder name..."
            value={founderFilter}
            onChange={(e) => setFounderFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 placeholder-slate-400"
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="industryFilter" className="text-xs font-semibold text-slate-500 uppercase mb-1">Filter by Industry</label>
          <select
            id="industryFilter"
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
          >
            <option value="">All Industries</option>
            {uniqueIndustries.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label htmlFor="stateFilter" className="text-xs font-semibold text-slate-500 uppercase mb-1">Filter by State</label>
          <select
            id="stateFilter"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
          >
            <option value="">All States</option>
            {uniqueStates.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="w-full overflow-hidden rounded-lg shadow-sm border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full leading-normal bg-white text-slate-900">
            <thead>
              <tr>
                <th className="px-5 py-3 border-b border-slate-200 bg-slate-50 text-left">
                  <input
                    type="checkbox"
                    ref={headerCheckboxRef}
                    checked={allFilteredSelected}
                    onChange={handleHeaderCheckboxChange}
                    className="w-4 h-4 text-blue-600 bg-white border-slate-300 rounded focus:ring-blue-600 focus:ring-2"
                    disabled={filteredCompanies.length === 0}
                  />
                </th>
                {headers.slice(1).map((header) => (
                  <th
                    key={header}
                    className="px-5 py-3 border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.length > 0 ? (
                filteredCompanies.map((company, index) => {
                  const isSelected = selectedCompanyNames.has(company.companyName);
                  
                  return (
                    <tr key={index} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isSelected ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-5 py-4 text-sm">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelection(company.companyName)}
                          className="w-4 h-4 text-blue-600 bg-white border-slate-300 rounded focus:ring-blue-600 focus:ring-2"
                        />
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <p className="whitespace-no-wrap font-semibold text-slate-900">{company.companyName}</p>
                      </td>
                      <td className="px-5 py-4 text-sm min-w-[200px]">
                        <p className="text-slate-600 whitespace-normal text-xs">{company.companyDescription}</p>
                      </td>
                      <td className="px-5 py-4 text-sm min-w-[200px]">
                        <p className="text-slate-600 whitespace-normal text-xs">{company.latestNews}</p>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        {isValidUrl(company.websiteUrl) ? (
                            <div className="max-w-[200px] truncate" title={company.websiteUrl}>
                              <a 
                                href={getSafeUrl(company.websiteUrl)} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-blue-600 hover:text-blue-800 underline decoration-blue-200 underline-offset-4"
                              >
                                {company.websiteUrl}
                              </a>
                            </div>
                        ) : (
                            <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm">
                        {isValidUrl(company.linkedinUrl) ? (
                          <div className="max-w-[200px] truncate" title={company.linkedinUrl}>
                            <a 
                              href={getSafeUrl(company.linkedinUrl)} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-blue-600 hover:text-blue-800 underline decoration-blue-200 underline-offset-4"
                            >
                              {company.linkedinUrl}
                            </a>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <p className="whitespace-no-wrap text-slate-600">{company.industry}</p>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <p className="whitespace-no-wrap text-slate-600">{company.headquartersState}</p>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <p className="whitespace-no-wrap text-slate-600">{company.contactTitle}</p>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <p className="whitespace-no-wrap text-slate-600">{company.contactName}</p>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        {company.emailAddress ? (
                          <a href={`mailto:${company.emailAddress}`} className="text-blue-600 hover:text-blue-800">
                            {company.emailAddress}
                          </a>
                        ) : (
                            <span className="text-slate-400 italic text-xs">Unverified</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <p className="whitespace-no-wrap text-slate-600">{company.founderName}</p>
                      </td>
                      <td className="px-5 py-4 text-sm">
                         {company.founderEmail ? (
                            <a href={`mailto:${company.founderEmail}`} className="text-blue-600 hover:text-blue-800">
                              {company.founderEmail}
                            </a>
                         ) : (
                            <span className="text-slate-400 italic text-xs">Unverified</span>
                         )}
                      </td>
                      <td className="px-5 py-4 text-sm min-w-[160px]">
                        {company.emailDraft ? (
                           <div className="flex flex-col gap-1">
                             <p className="text-xs text-slate-800 font-medium whitespace-normal">{company.emailDraft.subject}</p>
                             {onViewEmail && (
                               <button 
                                 onClick={() => onViewEmail(company)}
                                 className="self-start text-[11px] text-blue-600 hover:text-blue-800 font-semibold underline decoration-blue-300 underline-offset-2"
                               >
                                 View Draft &rarr;
                               </button>
                             )}
                           </div>
                        ) : (
                           <span className="text-slate-400 text-xs italic">{company.emailAddress ? 'Generating...' : '-'}</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm min-w-[300px]">
                         {company.emailDraft ? (
                             <div className="max-h-32 overflow-y-auto text-xs text-slate-600 whitespace-pre-wrap border border-slate-200 p-2.5 rounded bg-slate-50 relative group">
                                {company.emailDraft.body}
                             </div>
                         ) : (
                             <span className="text-slate-400 text-xs italic">{company.emailAddress ? 'Generating...' : '-'}</span>
                         )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={headers.length} className="px-5 py-8 text-center text-slate-400">
                    No companies match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CompanyTable;
