
export interface Company {
  companyName: string;
  companyDescription: string;
  websiteUrl: string;
  industry: string;
  headquartersState: string;
  contactTitle: string;
  contactName: string;
  emailAddress: string;
  latestNews: string;
  founderName: string;
  founderEmail: string;
  linkedinUrl: string;
  emailDraft?: EmailContent;
}

export interface EmailContent {
  subject: string;
  body: string;
}

export interface SenderProfile {
  companyName: string;
  websiteUrl: string;
  description: string;
  valueProposition: string;
  services: string[];
  contactUrl?: string;
  suggestedIcp?: string;
}
