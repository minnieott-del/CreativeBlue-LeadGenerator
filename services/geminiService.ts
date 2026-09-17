import { GoogleGenAI, Type } from "@google/genai";
import { Company, EmailContent, SenderProfile } from '../types';

function cleanJsonString(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return cleaned;
}

function parseJsonArray<T>(text: string): T[] {
  const cleaned = cleanJsonString(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw err;
  }
}

function parseJsonObject<T>(text: string): T {
  const cleaned = cleanJsonString(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw err;
  }
}

// Strictly supported Gemini models (deprecated gemini-2.5-flash / gemini-2.0 / gemini-1.5 removed)
const CANDIDATE_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

async function callWithModelFallback(
  ai: GoogleGenAI,
  prompt: string,
  responseSchema: any,
  temperature: number = 0.7
) {
  let lastError: any = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature,
        },
      });
      return response;
    } catch (err) {
      console.warn(`Model ${model} request failed, trying next candidate:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("All candidate Gemini models failed to generate content.");
}

export const getSenderProfile = async (websiteUrl: string): Promise<SenderProfile> => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Please ensure GEMINI_API_KEY is provided.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    Analyze the company whose website is: "${websiteUrl}".
    Extract and generate the following details about this company to be used for personalized B2B lead generation cold outreach emails and prospect targeting:
    1. Company Name (e.g., "Creative Blue")
    2. Website URL (formatted properly with https://)
    3. Company Description (A concise summary of what this company does)
    4. Core Value Proposition (Why clients hire or choose them)
    5. Key Offerings / Services (List 3 to 6 specific core products, services, or solutions they provide)
    6. Suggested Contact / Action URL (e.g., contact page or booking URL)
    7. Suggested Ideal Client Profile (ICP) Query: Synthesize a clear, focused, 1-3 sentence search and targeting query defining the exact companies that would be the best high-intent clients for this business. It should specify the target industry/niche, company stage or funding, geography (e.g. United States), and business needs or pain points that align with this company's services.

    Provide the result in a valid JSON object matching the requested schema.
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      companyName: {
        type: Type.STRING,
        description: "The name of the company.",
      },
      websiteUrl: {
        type: Type.STRING,
        description: "The official website URL.",
      },
      description: {
        type: Type.STRING,
        description: "A concise summary of what the company does.",
      },
      valueProposition: {
        type: Type.STRING,
        description: "The core value proposition or main benefit for clients.",
      },
      services: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "List of key services, solutions, or products offered.",
      },
      contactUrl: {
        type: Type.STRING,
        description: "Direct contact, schedule, or consultation URL.",
      },
      suggestedIcp: {
        type: Type.STRING,
        description: "A synthesized Ideal Client Profile query targeting high-intent prospect companies.",
      },
    },
    required: ["companyName", "websiteUrl", "description", "valueProposition", "services", "suggestedIcp"],
  };

  try {
    const response = await callWithModelFallback(ai, prompt, responseSchema, 0.2);
    const rawText = response.text || "{}";
    const profile: SenderProfile = parseJsonObject(rawText);
    return profile;
  } catch (error) {
    console.warn("Failed to get deep sender profile from Gemini, using fallback:", error);
    const domain = websiteUrl.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
    const cleanName = domain.split('.')[0];
    const capitalizedName = cleanName ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1) : "Our Company";
    return {
      companyName: capitalizedName,
      websiteUrl: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
      description: `Tailored strategic solutions and execution provided by ${capitalizedName}.`,
      valueProposition: "Accelerating business growth and delivering measurable industry results.",
      services: ["Strategy & Consulting", "Growth Acceleration", "Custom Solutions", "Brand & Marketing"],
      contactUrl: websiteUrl.startsWith('http') ? `${websiteUrl.replace(/\/+$/, '')}/contact` : `https://${websiteUrl}/contact`,
      suggestedIcp: `High-growth startup and mid-market companies in the United States that are seeking ${capitalizedName}'s specialized services to scale operations, acquire customers, and expand market share.`,
    };
  }
};

export const getSeriesALeads = async (icp: string, excludedCompanies: string[] = [], leadCount: number = 10): Promise<Company[]> => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Please verify that GEMINI_API_KEY is set.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const exclusionPrompt = excludedCompanies.length > 0 
    ? `\n\n**IMPORTANT - DUPLICATE PREVENTION**: Do not include any of the following companies as they already exist in our database: ${excludedCompanies.join(', ')}.`
    : '';

  const prompt = `
    You are an expert market researcher and prospect researcher. Your task is to find real or high-confidence companies matching the following Ideal Client Profile:
    "${icp || 'Companies seeking or obtained Series A funding in the United States'}"
    ${exclusionPrompt}

    **Research Strategy:**
    1. Identify **${leadCount}** companies matching this target profile.
    2. Gather comprehensive, accurate data for each:
        - **Company Name**
        - **Description**: Concise summary of what they do.
        - **Latest News**: Recent funding, product launch, executive hire, or company milestone.
        - **Website**: Format with https://
        - **LinkedIn**: LinkedIn company or contact page URL.
        - **Industry**
        - **Headquarters State**: US State (e.g. CA, NY, TX, etc.)
        - **Contact Person**: Name and executive role (e.g. Founder, CEO, COO, CMO, VP).
        - **Contact Email**: Professional business email.
        - **Founder**: Founder name and contact/founder email.

    Provide the output as a valid JSON array matching the schema.
  `;

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        companyName: {
          type: Type.STRING,
          description: "The name of the company.",
        },
        companyDescription: {
          type: Type.STRING,
          description: "A brief description of the company.",
        },
        websiteUrl: {
          type: Type.STRING,
          description: "The official website URL.",
        },
        linkedinUrl: {
          type: Type.STRING,
          description: "The LinkedIn profile URL for the company or contact.",
        },
        industry: {
          type: Type.STRING,
          description: "The industry.",
        },
        headquartersState: {
          type: Type.STRING,
          description: "The US state headquarters.",
        },
        contactTitle: {
          type: Type.STRING,
          description: "Job title (COO, CMO, VP, etc).",
        },
        contactName: {
          type: Type.STRING,
          description: "Full name of the contact person.",
        },
        emailAddress: {
          type: Type.STRING,
          description: "Email address of the contact person.",
        },
        latestNews: {
            type: Type.STRING,
            description: "Summary of recent good news or milestone.",
        },
        founderName: {
          type: Type.STRING,
          description: "Name of the founder.",
        },
        founderEmail: {
          type: Type.STRING,
          description: "Email address of the founder.",
        },
      },
      required: [
        "companyName", 
        "companyDescription", 
        "websiteUrl", 
        "linkedinUrl", 
        "industry", 
        "headquartersState", 
        "contactTitle", 
        "contactName", 
        "emailAddress", 
        "latestNews", 
        "founderName", 
        "founderEmail"
      ],
    },
  };

  try {
    const response = await callWithModelFallback(ai, prompt, responseSchema, 0.7);
    const rawText = response.text || "[]";
    const companies: Company[] = parseJsonArray(rawText);
    return companies;
  } catch (error) {
    console.error("Error generating leads from Gemini API:", error);
    const detailMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to generate company leads: ${detailMsg}`);
  }
};

export const generateEmailForCompany = async (company: Company, senderProfile?: SenderProfile): Promise<EmailContent> => {
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("Gemini API key is not configured.");
    }

    const ai = new GoogleGenAI({ apiKey });

    const senderName = senderProfile?.companyName || "Creative Blue";
    const senderWeb = senderProfile?.websiteUrl || "https://www.creativeblue.agency/";
    const senderDesc = senderProfile?.description || "A premier agency specializing in branding, digital growth, and strategic marketing.";
    const senderServices = senderProfile?.services && senderProfile.services.length > 0
      ? senderProfile.services.join(", ")
      : "creative branding, web design, high-converting digital campaigns, and strategic advisory";
    const senderValueProp = senderProfile?.valueProposition || "helping fast-growing companies amplify their market presence and drive sustainable customer acquisition";
    const senderContact = senderProfile?.contactUrl || senderWeb;

    const prompt = `
        You are a top-tier B2B sales copywriter crafting a personalized, high-converting cold email on behalf of **"${senderName}"** (${senderWeb}).
        
        **Sender Profile:**
        - Company: ${senderName}
        - Website: ${senderWeb}
        - Overview: ${senderDesc}
        - Value Proposition: ${senderValueProp}
        - Core Services & Offerings: ${senderServices}
        - Contact / Action Link: ${senderContact}

        **Target Prospect:**
        - Contact Name: ${company.contactName}
        - Title: ${company.contactTitle}
        - Company: ${company.companyName}
        - Industry: ${company.industry}
        - Location: ${company.headquartersState}
        - Latest News & Milestone: "${company.latestNews}"
        - Company Overview: "${company.companyDescription}"

        **Task:**
        Draft a concise, tailored email body and subject line with these requirements:
        1. **Subject Line**: Natural, intriguing, and relevant to their recent milestone (e.g. referencing their news or company name).
        2. **Opening**: Congratulate ${company.contactName} sincerely on their specific milestone ("${company.latestNews}").
        3. **Bridge to Value**: Explicitly connect their milestone and industry (${company.industry}) to how ${senderName}'s specific capabilities (${senderServices}) provide immediate leverage or solve relevant scaling challenges.
        4. **Tone**: Human, professional, peer-to-peer, and consultative. Avoid aggressive sales clichés, buzzword salad, or robotic phrasing.
        5. **Call to Action**: Low-pressure, conversational call to action directing them to explore or connect (referencing ${senderContact} or proposing a quick conversation).
        
        **Output Format:**
        Return a JSON object with "subject" and "body". The body must use newline characters (\\n) for paragraph breaks.
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            subject: { type: Type.STRING, description: "Compelling email subject line" },
            body: { type: Type.STRING, description: "Personalized email body formatted with paragraphs" }
        },
        required: ["subject", "body"],
    };

    try {
        const response = await callWithModelFallback(ai, prompt, responseSchema, 0.7);
        const rawText = response.text || "{}";
        const emailContent: EmailContent = parseJsonObject(rawText);
        return emailContent;
    } catch (error) {
        console.error("Error generating email from Gemini API:", error);
        const detailMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to draft email: ${detailMsg}`);
    }
};
