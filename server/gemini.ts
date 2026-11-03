import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";
import type { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Company, EmailContent, SenderProfile } from "../types.ts";

export const getGeminiClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured on the server.");
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
];

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
      console.warn(`[Gemini Server] Model ${model} request failed, trying next candidate:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("All candidate Gemini models failed to generate content.");
}

export async function handleSenderProfile(req: Request, res: Response) {
  const { websiteUrl } = req.body;
  if (!websiteUrl || typeof websiteUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid websiteUrl parameter" });
  }

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
    const ai = getGeminiClient();
    const response = await callWithModelFallback(ai, prompt, responseSchema, 0.2);
    const rawText = response.text || "{}";
    const profile: SenderProfile = parseJsonObject(rawText);
    return res.json({ profile });
  } catch (error) {
    console.warn("[Gemini Server] Failed to get deep sender profile from Gemini, providing fallback:", error);
    const domain = websiteUrl.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "");
    const cleanName = domain.split(".")[0];
    const capitalizedName = cleanName ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1) : "Our Company";
    const fallbackProfile: SenderProfile = {
      companyName: capitalizedName,
      websiteUrl: websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`,
      description: `Tailored strategic solutions and execution provided by ${capitalizedName}.`,
      valueProposition: "Accelerating business growth and delivering measurable industry results.",
      services: ["Strategy & Consulting", "Growth Acceleration", "Custom Solutions", "Brand & Marketing"],
      contactUrl: websiteUrl.startsWith("http") ? `${websiteUrl.replace(/\/+$/, "")}/contact` : `https://${websiteUrl}/contact`,
      suggestedIcp: `High-growth startup and mid-market companies in the United States that are seeking ${capitalizedName}'s specialized services to scale operations, acquire customers, and expand market share.`,
    };
    return res.json({ profile: fallbackProfile });
  }
}

export async function handleSeriesALeads(req: Request, res: Response) {
  const { icp, excludedCompanies = [], leadCount = 5 } = req.body;

  const exclusionPrompt = Array.isArray(excludedCompanies) && excludedCompanies.length > 0
    ? `\n\n**IMPORTANT - DUPLICATE PREVENTION**: Do not include any of the following companies as they already exist in our database: ${excludedCompanies.join(", ")}.`
    : "";

  const prompt = `
    You are an expert market researcher and prospect researcher. Your task is to find real or high-confidence companies matching the following Ideal Client Profile:
    "${icp || "Companies seeking or obtained Series A funding in the United States"}"
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
        "founderEmail",
      ],
    },
  };

  try {
    const ai = getGeminiClient();
    const response = await callWithModelFallback(ai, prompt, responseSchema, 0.7);
    const rawText = response.text || "[]";
    const companies: Company[] = parseJsonArray(rawText);
    return res.json({ companies });
  } catch (error: any) {
    console.error("[Gemini Server] Error generating leads:", error);
    const detailMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Failed to generate company leads: ${detailMsg}` });
  }
}

export async function handleGenerateEmail(req: Request, res: Response) {
  const { company, senderProfile } = req.body;
  if (!company || !company.companyName) {
    return res.status(400).json({ error: "Missing company information" });
  }

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
      body: { type: Type.STRING, description: "Personalized email body formatted with paragraphs" },
    },
    required: ["subject", "body"],
  };

  try {
    const ai = getGeminiClient();
    const response = await callWithModelFallback(ai, prompt, responseSchema, 0.7);
    const rawText = response.text || "{}";
    const emailContent: EmailContent = parseJsonObject(rawText);
    return res.json({ email: emailContent });
  } catch (error: any) {
    console.error("[Gemini Server] Error generating email:", error);
    const detailMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Failed to draft email: ${detailMsg}` });
  }
}

export async function handleStreamingText(req: Request, res: Response) {
  const { prompt, model = "gemini-3.8-flash" } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing or invalid prompt parameter" });
  }

  try {
    const ai = getGeminiClient();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await ai.models.generateContentStream({
      model,
      contents: prompt,
    });

    for await (const chunk of stream) {
      const text = chunk.text || "";
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error: any) {
    console.error("[Gemini Server] Error in streaming Gemini API:", error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || "Failed to stream content" });
    }
    res.write(`data: ${JSON.stringify({ error: error.message || "Streaming error" })}\n\n`);
    res.end();
  }
}

export function setupLiveApiWebSocket(wss: WebSocketServer) {
  wss.on("connection", async (clientWs: WebSocket) => {
    try {
      const ai = getGeminiClient();
      const session = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are a professional assistant for Creative Blue Lead Gen, assisting with B2B lead generation and outreach strategy.",
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            for (const part of message.serverContent?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          },
          onerror: (err) => {
            console.error("[Gemini Live Server] Live session error:", err);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ error: err.message || "Live API error" }));
            }
          },
        },
      });

      clientWs.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.audio) {
            session.sendRealtimeInput({
              audio: { data: parsed.audio, mimeType: "audio/pcm;rate=16000" },
            });
          } else if (parsed.text) {
            session.sendRealtimeInput({
              text: parsed.text,
            });
          }
        } catch (e) {
          console.error("[Gemini Live Server] Failed to parse client WS message:", e);
        }
      });

      clientWs.on("close", () => {
        try {
          session.close();
        } catch (_) {}
      });
    } catch (err: any) {
      console.error("[Gemini Live Server] Failed to establish Live API connection:", err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: err.message || "Failed to initialize Live API" }));
        clientWs.close();
      }
    }
  });
}
