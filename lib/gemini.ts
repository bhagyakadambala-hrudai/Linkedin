
import { GoogleGenerativeAI } from "@google/generative-ai";

// Vite replaces process.env.API_KEY at build time; constructor expects the key string, not an object.
const apiKey =
  (typeof process !== "undefined" &&
    (process.env?.GEMINI_API_KEY || process.env?.API_KEY)) ||
  (typeof import.meta !== "undefined" &&
    ((import.meta as any).env?.VITE_GEMINI_API_KEY ||
      (import.meta as any).env?.VITE_API_KEY)) ||
  "";
const ai = new GoogleGenerativeAI(apiKey);

export const parseResume = async (resumeText: string) => {
  try {
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const response = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{
          text: `Parse the following resume and extract key professional information. 
    Also, suggest 6-8 specific LinkedIn content topics this person could write about based on their expertise.
    Resume Text: ${resumeText}
    
    Return as JSON with structure: { role: string, skills: string[], summary: string, experienceLevel: string, suggestedTopics: string[] }`
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
      },
    });

    const text = response.response.text();
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  } catch (err) {
    console.error("Resume parsing failed:", err);
    // Return mock data for development
    return {
      role: "Software Engineer",
      skills: ["React", "Node.js", "AWS"],
      summary: "Experienced developer",
      experienceLevel: "Senior",
      suggestedTopics: ["Web Development", "Cloud Architecture", "DevOps"]
    };
  }
};

export const generateLinkedInPost = async (userData: {
  role: string;
  skills: string[];
  topic: string;
  tone?: string;
}) => {
  try {
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
    You are an expert LinkedIn ghostwriter. 
    Write a high-impact LinkedIn post for a ${userData.role} specializing in ${userData.skills.join(", ")}.
    Topic: ${userData.topic}
    Tone: ${userData.tone || 'Professional and engaging'}
    Requirements:
    - Catchy first line (hook)
    - Value-driven body with bullet points
    - Strong call to action
    - 3-5 relevant hashtags
  `;

    const response = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
      },
    });

    return response.response.text();
  } catch (err) {
    console.error("Post generation failed:", err);
    // Return mock data for development
    return `🚀 Excited to share insights on ${userData.topic}!\n\nHere are key takeaways:\n• Point 1\n• Point 2\n\nWhat are your thoughts? #${userData.topic.replace(/\s+/g, '')}`;
  }
};
