import { Company, EmailContent, SenderProfile } from "../types";

/**
 * Client service for calling the server-side Gemini API endpoints.
 * All SDK calls and API key management are handled securely on the server.
 */

export const getSenderProfile = async (websiteUrl: string): Promise<SenderProfile> => {
  const response = await fetch("/api/gemini/profile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ websiteUrl }),
  });

  if (!response.ok) {
    let errorMessage = `Server error (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.error) errorMessage = errorJson.error;
    } catch (_) {}
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.profile;
};

export const getSeriesALeads = async (
  icp: string,
  excludedCompanies: string[] = [],
  leadCount: number = 5
): Promise<Company[]> => {
  const response = await fetch("/api/gemini/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      icp,
      excludedCompanies,
      leadCount,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Server error (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.error) errorMessage = errorJson.error;
    } catch (_) {}
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.companies || [];
};

export const generateEmailForCompany = async (
  company: Company,
  senderProfile?: SenderProfile
): Promise<EmailContent> => {
  const response = await fetch("/api/gemini/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      company,
      senderProfile,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Server error (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.error) errorMessage = errorJson.error;
    } catch (_) {}
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.email;
};

/**
 * Client helper to stream Gemini text from the server via SSE.
 */
export const streamGeminiText = async (
  prompt: string,
  onChunk: (text: string) => void
): Promise<string> => {
  const response = await fetch("/api/gemini/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`Failed to initiate stream (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("ReadableStream not supported by browser.");

  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.text) {
            fullText += parsed.text;
            onChunk(parsed.text);
          } else if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          // ignore parsing error for partial chunks
        }
      }
    }
  }

  return fullText;
};

/**
 * Client helper to open a real-time Live API WebSocket connection to the server.
 */
export const createLiveApiWebSocket = (): WebSocket => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/gemini/live`;
  return new WebSocket(wsUrl);
};
