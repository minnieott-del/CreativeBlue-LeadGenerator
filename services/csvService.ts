
import { Company } from '../types';

export const downloadCSV = (companies: Company[]) => {
  const headers = [
    'Company Name',
    'Description',
    'Website',
    'Industry',
    'Headquarters State',
    'Contact Name',
    'Contact Title',
    'Contact Email',
    'Founder Name',
    'Founder Email',
    'Latest News',
    'LinkedIn',
    'Email Draft Subject',
    'Email Draft Body'
  ];

  const escapeField = (field: string | undefined | null): string => {
    if (!field) return '';
    const stringField = String(field);
    // Escape double quotes by doubling them, and wrap fields containing commas, quotes, or newlines in quotes
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n') || stringField.includes('\r')) {
      return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
  };

  const csvRows = [headers.join(',')];

  const isValidUrl = (url: string | undefined | null) => {
      if (!url) return false;
      const lower = url.toLowerCase().trim();
      return lower.length > 0 && !['n/a', 'none', 'unavailable', 'not found', 'null', '-'].includes(lower) && !url.includes('404');
  };

  for (const company of companies) {
    const row = [
      company.companyName,
      company.companyDescription,
      company.websiteUrl,
      company.industry,
      company.headquartersState,
      company.contactName,
      company.contactTitle,
      company.emailAddress,
      company.founderName,
      company.founderEmail,
      company.latestNews,
      isValidUrl(company.linkedinUrl) ? company.linkedinUrl : '',
      company.emailDraft?.subject || '',
      company.emailDraft?.body || ''
    ].map(escapeField).join(',');
    csvRows.push(row);
  }

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `creative_blue_leads_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};
